/**
 * Vector Store — Lightweight Semantic Memory with Vector Search
 *
 * Provides embedding storage and retrieval for APES agents.
 *
 * Features:
 *   - In-memory vector index with cosine similarity search
 *   - Namespace isolation (per-session, per-agent, global)
 *   - Automatic memory compression (LRU eviction of low-relevance entries)
 *   - Persistent save/load to disk (JSON serialization)
 *   - Cascade fallback: session → project → global memory
 *
 * For production, this can be swapped with HNSW/FAISS or pgvector.
 * The interface remains the same.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';

/**
 * @typedef {object} VectorEntry
 * @property {string}   id
 * @property {string}   namespace
 * @property {number[]} embedding
 * @property {object}   metadata    - Arbitrary metadata (text, source, agent, etc.)
 * @property {number}   timestamp
 * @property {number}   accessCount
 * @property {number}   relevanceScore - Decayed relevance
 */

export class VectorStore extends EventEmitter {
    /**
     * @param {object} [opts]
     * @param {string} [opts.storagePath] - Disk persistence path
     * @param {number} [opts.maxEntries=5000] - Max entries before compression
     * @param {number} [opts.dimensions=384] - Embedding dimensionality
     */
    constructor({ storagePath, maxEntries = 5000, dimensions = 384 } = {}) {
        super();
        this.storagePath = storagePath || join(homedir(), '.apes', 'memory', 'vectors');
        this.maxEntries = maxEntries;
        this.dimensions = dimensions;

        /** @type {Map<string, VectorEntry>} */
        this.entries = new Map();

        /** @type {Map<string, Set<string>>} namespace → entry IDs */
        this.namespaceIndex = new Map();
    }

    // ─── Storage ──────────────────────────────────────────────────

    /**
     * Store an embedding with associated metadata.
     *
     * @param {object} opts
     * @param {string}   opts.id        - Unique identifier
     * @param {number[]} opts.embedding  - Dense vector
     * @param {object}   opts.metadata   - Arbitrary payload
     * @param {string}   [opts.namespace='global']
     * @returns {VectorEntry}
     */
    store({ id, embedding, metadata, namespace = 'global' }) {
        // Compress if at capacity
        if (this.entries.size >= this.maxEntries) {
            this._compress();
        }

        const entry = {
            id,
            namespace,
            embedding,
            metadata,
            timestamp: Date.now(),
            accessCount: 0,
            relevanceScore: 1.0,
        };

        this.entries.set(id, entry);

        if (!this.namespaceIndex.has(namespace)) {
            this.namespaceIndex.set(namespace, new Set());
        }
        this.namespaceIndex.get(namespace).add(id);

        this.emit('vector:stored', { id, namespace });
        return entry;
    }

    /**
     * Retrieve an entry by ID.
     * @param {string} id
     * @returns {VectorEntry|null}
     */
    get(id) {
        const entry = this.entries.get(id);
        if (entry) {
            entry.accessCount++;
            entry.relevanceScore = Math.min(1.0, entry.relevanceScore + 0.05);
        }
        return entry || null;
    }

    /**
     * Delete an entry.
     * @param {string} id
     */
    delete(id) {
        const entry = this.entries.get(id);
        if (!entry) return;
        this.namespaceIndex.get(entry.namespace)?.delete(id);
        this.entries.delete(id);
    }

    // ─── Search ───────────────────────────────────────────────────

    /**
     * Semantic search: find the k most similar entries to a query embedding.
     *
     * Uses cosine similarity. Searches within the specified namespace(s).
     * Falls back through namespace cascade: session → project → global.
     *
     * @param {object} opts
     * @param {number[]} opts.queryEmbedding
     * @param {number}   [opts.topK=5]
     * @param {string[]} [opts.namespaces=['global']]
     * @param {number}   [opts.minScore=0.3] - Minimum similarity threshold
     * @returns {{ id: string, score: number, metadata: object }[]}
     */
    search({ queryEmbedding, topK = 5, namespaces = ['global'], minScore = 0.3 }) {
        const candidateIds = new Set();

        for (const ns of namespaces) {
            const ids = this.namespaceIndex.get(ns);
            if (ids) for (const id of ids) candidateIds.add(id);
        }

        if (candidateIds.size === 0 && !namespaces.includes('global')) {
            // Cascade fallback to global
            const globalIds = this.namespaceIndex.get('global');
            if (globalIds) for (const id of globalIds) candidateIds.add(id);
        }

        const results = [];

        for (const id of candidateIds) {
            const entry = this.entries.get(id);
            if (!entry) continue;
            const score = this._cosineSimilarity(queryEmbedding, entry.embedding);
            if (score >= minScore) {
                results.push({ id, score, metadata: entry.metadata });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /**
     * Simple text-based similarity search using token overlap (bag-of-words).
     * Used when embeddings are not available.
     *
     * @param {string}   queryText
     * @param {string[]} [namespaces]
     * @param {number}   [topK=5]
     * @returns {{ id: string, score: number, metadata: object }[]}
     */
    textSearch(queryText, namespaces = ['global'], topK = 5) {
        const queryTokens = new Set(queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2));
        const candidateIds = new Set();

        for (const ns of namespaces) {
            const ids = this.namespaceIndex.get(ns);
            if (ids) for (const id of ids) candidateIds.add(id);
        }

        const results = [];

        for (const id of candidateIds) {
            const entry = this.entries.get(id);
            if (!entry || !entry.metadata?.text) continue;
            const docTokens = new Set(entry.metadata.text.toLowerCase().split(/\s+/).filter(t => t.length > 2));

            // Count intersection without array spread — O(min(|q|, |d|))
            let intersection = 0;
            for (const t of queryTokens) {
                if (docTokens.has(t)) intersection++;
            }

            // Union = |A| + |B| - |A ∩ B|, no Set spread needed
            const union = queryTokens.size + docTokens.size - intersection;
            const score = union > 0 ? intersection / union : 0;
            if (score > 0) results.push({ id, score, metadata: entry.metadata });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    // ─── Compression ──────────────────────────────────────────────

    /**
     * Evict lowest-relevance entries to free 20% capacity.
     * @private
     */
    _compress() {
        const all = [...this.entries.values()];

        // Decay relevance by age
        const now = Date.now();
        for (const entry of all) {
            const ageHours = (now - entry.timestamp) / (1000 * 60 * 60);
            entry.relevanceScore *= Math.exp(-0.01 * ageHours);
        }

        // Sort ascending by relevance
        all.sort((a, b) => a.relevanceScore - b.relevanceScore);

        const evictCount = Math.floor(this.maxEntries * 0.2);
        for (let i = 0; i < evictCount && i < all.length; i++) {
            this.delete(all[i].id);
        }

        this.emit('vector:compressed', { evicted: evictCount, remaining: this.entries.size });
    }

    // ─── Math ─────────────────────────────────────────────────────

    /**
     * Cosine similarity between two vectors.
     *
     * Optimised: single sqrt call instead of two — Math.sqrt(magA * magB)
     * is algebraically identical to Math.sqrt(magA) * Math.sqrt(magB) but
     * performs one fewer transcendental function call per comparison.
     *
     * @param {number[]} a
     * @param {number[]} b
     * @returns {number} -1..1
     */
    _cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot  += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        const denom = Math.sqrt(magA * magB); // one sqrt instead of two
        return denom === 0 ? 0 : dot / denom;
    }

    // ─── Persistence ──────────────────────────────────────────────

    async save() {
        try {
            await mkdir(this.storagePath, { recursive: true });
            const data = {
                entries: [...this.entries.entries()],
                savedAt: new Date().toISOString(),
            };
            await writeFile(
                join(this.storagePath, 'vectors.json'),
                JSON.stringify(data),
                'utf-8'
            );
        } catch { /* non-critical */ }
    }

    async load() {
        try {
            const raw = await readFile(join(this.storagePath, 'vectors.json'), 'utf-8');
            const data = JSON.parse(raw);
            this.entries = new Map(data.entries || []);
            // Rebuild namespace index
            this.namespaceIndex.clear();
            for (const [id, entry] of this.entries) {
                if (!this.namespaceIndex.has(entry.namespace)) {
                    this.namespaceIndex.set(entry.namespace, new Set());
                }
                this.namespaceIndex.get(entry.namespace).add(id);
            }
        } catch { /* no prior data, start fresh */ }
    }

    // ─── Status ───────────────────────────────────────────────────

    getStatus() {
        return {
            totalEntries: this.entries.size,
            maxEntries: this.maxEntries,
            namespaces: [...this.namespaceIndex.keys()],
            namespaceSizes: Object.fromEntries(
                [...this.namespaceIndex.entries()].map(([k, v]) => [k, v.size])
            ),
        };
    }
}
