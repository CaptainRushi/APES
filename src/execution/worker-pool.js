/**
 * Worker Pool
 * 
 * Async task execution pool with concurrency control.
 * Manages parallel agent execution with bounded parallelism.
 * 
 * In production, workers would connect to LLM APIs.
 * Currently implements a simulation layer for architecture validation.
 */

export class WorkerPool {
    constructor(maxWorkers = 16) {
        this.maxWorkers = maxWorkers;
        this.activeWorkers = 0;
        this.queue = [];
        this.stats = {
            totalExecuted: 0,
            totalFailed: 0,
            avgDuration: 0,
        };
    }

    /**
     * Execute a task via the worker pool
     * @param {{ task: object, agentIds: string[], context: object }} job
     * @returns {Promise<{ output: string, metadata: object }>}
     */
    async execute(job) {
        // Wait for available worker slot
        if (this.activeWorkers >= this.maxWorkers) {
            await this.waitForSlot();
        }

        this.activeWorkers++;

        try {
            const result = await this.runWorker(job);
            this.stats.totalExecuted++;
            return result;
        } catch (error) {
            this.stats.totalFailed++;
            throw error;
        } finally {
            this.activeWorkers--;
            this.processQueue();
        }
    }

    /**
     * Run a worker for a specific job
     * 
     * This is the integration point where agents connect to
     * LLM providers (OpenAI, Anthropic, Ollama, etc.)
     * 
     * Currently: simulation mode for architecture validation
     */
    async runWorker(job) {
        const { task, agentIds, context } = job;

        // ── Real LLM execution ────────────────────────────────────────────────
        const providerRegistry = context?.providerRegistry;
        if (providerRegistry?.isReady()) {
            const agentId      = agentIds[0];
            const agentRegistry = context?.agentRegistry;
            const agent        = agentRegistry?.getAgent(agentId) ?? null;

            return await providerRegistry.execute(task, agent, context);
        }

        // ── No provider configured — fail fast ──────────────────────────────
        throw new Error(
            `No LLM provider configured. Cannot execute task "${task.id}".\n` +
            `Set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, or start Ollama.`
        );
    }

    /**
     * Wait for a worker slot to become available
     */
    waitForSlot() {
        return new Promise((resolve) => {
            this.queue.push(resolve);
        });
    }

    /**
     * Process queued tasks when a worker becomes available.
     * Drains as many queued waiters as there are free slots, preventing
     * the race where multiple concurrent slot releases each only unblock
     * one waiter instead of filling all available slots.
     */
    processQueue() {
        while (this.queue.length > 0 && this.activeWorkers < this.maxWorkers) {
            const next = this.queue.shift();
            next();
        }
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            ...this.stats,
            activeWorkers: this.activeWorkers,
            maxWorkers: this.maxWorkers,
            queueLength: this.queue.length,
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
