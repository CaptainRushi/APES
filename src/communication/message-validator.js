/**
 * Message Validator
 *
 * Schema validation for inter-agent messages.
 * Enforces required fields, type correctness, and value constraints.
 */

const VALID_TYPES = [
    // Scientific debate message types (from APES spec)
    'request', 'evidence', 'challenge', 'approval', 'alert', 'shutdown',
    // Task-oriented types
    'task_output', 'task_claim', 'task_delegate',
    'query', 'response', 'broadcast',
    'consensus_request', 'consensus_vote',
    'error', 'heartbeat',
];

const VALID_STATUSES = ['pending', 'delivered', 'read', 'processed', 'failed'];

export class MessageValidator {
    /**
     * Validate a message object.
     * @param {object} msg
     * @returns {{ valid: boolean, errors: string[] }}
     */
    validate(msg) {
        const errors = [];

        if (!msg || typeof msg !== 'object') {
            return { valid: false, errors: ['Message must be an object'] };
        }

        // Required fields
        if (!msg.id || typeof msg.id !== 'string') {
            errors.push('id: required string');
        }
        if (!msg.type || !VALID_TYPES.includes(msg.type)) {
            errors.push(`type: must be one of [${VALID_TYPES.join(', ')}]`);
        }
        if (!msg.channel || typeof msg.channel !== 'string') {
            errors.push('channel: required string');
        }
        if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0) {
            errors.push('timestamp: required positive number');
        }

        // Optional typed fields
        if (msg.confidence !== undefined && (typeof msg.confidence !== 'number' || msg.confidence < 0 || msg.confidence > 1)) {
            errors.push('confidence: must be number 0-1');
        }
        if (msg.status !== undefined && !VALID_STATUSES.includes(msg.status)) {
            errors.push(`status: must be one of [${VALID_STATUSES.join(', ')}]`);
        }
        if (msg.dependencies !== undefined && !Array.isArray(msg.dependencies)) {
            errors.push('dependencies: must be array');
        }
        if (msg.requiresReview !== undefined && typeof msg.requiresReview !== 'boolean') {
            errors.push('requiresReview: must be boolean');
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * Create a valid message with defaults.
     * @param {object} fields
     * @returns {object}
     */
    create(fields) {
        return {
            id: fields.id || this._generateId(),
            type: fields.type || 'broadcast',
            fromAgentId: fields.fromAgentId || null,
            toAgentId: fields.toAgentId || null,
            taskId: fields.taskId || null,
            channel: fields.channel || 'global',
            confidence: fields.confidence ?? 1.0,
            dependencies: fields.dependencies || [],
            output: fields.output ?? null,
            requiresReview: fields.requiresReview ?? false,
            timestamp: fields.timestamp || Date.now(),
            status: fields.status || 'pending',
        };
    }

    _generateId() {
        return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
}
