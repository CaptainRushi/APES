/**
 * Secure Storage
 *
 * AES-256-GCM encrypted storage for provider API keys.
 *
 * Encryption key is derived from a machine fingerprint (hostname + username)
 * via PBKDF2, making stored keys device-bound without requiring a master password.
 *
 * Storage: ~/.apes/providers.json
 * Format:  { version, providers[], defaultProvider, routing }
 * Keys:    encryptedData + iv + authTag + salt (all hex) stored per provider
 */

import crypto from 'node:crypto';
import fs     from 'node:fs';
import os     from 'node:os';
import { join } from 'node:path';

const APES_DIR       = join(os.homedir(), '.apes');
const PROVIDERS_FILE = join(APES_DIR, 'providers.json');
const PBKDF2_ITERS   = 100_000;
const KEY_LEN        = 32;   // 256-bit
const ALGO           = 'aes-256-gcm';

export class SecureStorage {

    // ─── Encryption ──────────────────────────────────────────────────────────

    /**
     * Encrypt a plaintext string with AES-256-GCM.
     * @param {string} plaintext
     * @returns {{ encryptedData: string, iv: string, authTag: string, salt: string }}
     */
    static encrypt(plaintext) {
        const salt    = crypto.randomBytes(16);
        const iv      = crypto.randomBytes(12);   // 96-bit IV recommended for GCM
        const key     = SecureStorage._deriveKey(salt);
        const cipher  = crypto.createCipheriv(ALGO, key, iv);

        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);

        return {
            encryptedData: encrypted.toString('hex'),
            iv:            iv.toString('hex'),
            authTag:       cipher.getAuthTag().toString('hex'),
            salt:          salt.toString('hex'),
        };
    }

    /**
     * Decrypt a value previously encrypted by encrypt().
     * @param {string} encryptedData  hex
     * @param {string} iv             hex
     * @param {string} authTag        hex
     * @param {string} salt           hex
     * @returns {string} plaintext
     */
    static decrypt(encryptedData, iv, authTag, salt) {
        const key      = SecureStorage._deriveKey(Buffer.from(salt, 'hex'));
        const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(authTag, 'hex'));

        return (
            decipher.update(encryptedData, 'hex', 'utf8') +
            decipher.final('utf8')
        );
    }

    // ─── File I/O ────────────────────────────────────────────────────────────

    /**
     * Load the providers store. Returns a default structure if the file
     * does not exist or cannot be parsed.
     * @returns {object}
     */
    static load() {
        try {
            return JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8'));
        } catch {
            return SecureStorage._defaultStore();
        }
    }

    /**
     * Persist the providers store to ~/.apes/providers.json.
     * Creates the directory if it does not exist.
     * @param {object} data
     */
    static save(data) {
        SecureStorage._ensureDir();
        fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2), 'utf8');
    }

    /** @returns {string} absolute path to the storage file */
    static getStoragePath() {
        return PROVIDERS_FILE;
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    /** Derive a 256-bit key from the machine fingerprint + salt via PBKDF2. */
    static _deriveKey(salt) {
        const fingerprint = `${os.hostname()}\x00${os.userInfo().username}\x00apes-v1`;
        return crypto.pbkdf2Sync(fingerprint, salt, PBKDF2_ITERS, KEY_LEN, 'sha256');
    }

    static _ensureDir() {
        if (!fs.existsSync(APES_DIR)) {
            fs.mkdirSync(APES_DIR, { recursive: true });
        }
    }

    static _defaultStore() {
        return {
            version:         1,
            providers:       [],
            defaultProvider: 'auto',
            routing:         {},
        };
    }
}
