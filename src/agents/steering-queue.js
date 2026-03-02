/**
 * Steering Queue — Real-Time Agent Control
 *
 * Inspired by Claude Code's h2A queue.
 * Allows the user (or system) to inject messages into a running agent loop:
 *   - Interrupt: pause current execution and redirect
 *   - Append: add new context or constraints mid-run
 *   - Cancel: stop the agent loop entirely
 *   - Steer: redirect the agent's focus without stopping
 *
 * The queue is async-safe and can be consumed by the AgentLoop tick-by-tick.
 */

export class SteeringQueue {
    constructor() {
        /** @type {Array<{ type: string, payload: any, timestamp: number }>} */
        this._queue = [];
        this._paused = false;
        this._cancelled = false;
        this._listeners = new Map();
    }

    // ─── Enqueue Commands ────────────────────────────────────────

    /**
     * Interrupt the current agent — forces it to re-evaluate.
     * @param {string} message — New constraint or redirect instruction
     */
    interrupt(message) {
        this._enqueue('interrupt', { message });
        this._emit('interrupt', { message });
    }

    /**
     * Append additional context without interrupting.
     * @param {string} context — Additional info the agent should consider
     */
    append(context) {
        this._enqueue('append', { context });
    }

    /**
     * Steer the agent's focus to a specific subtask or direction.
     * @param {string} direction — Where to redirect
     */
    steer(direction) {
        this._enqueue('steer', { direction });
        this._emit('steer', { direction });
    }

    /**
     * Pause the agent loop. It will stop consuming after the current step.
     */
    pause() {
        this._paused = true;
        this._enqueue('pause', {});
        this._emit('pause', {});
    }

    /**
     * Resume a paused agent loop.
     */
    resume() {
        this._paused = false;
        this._enqueue('resume', {});
        this._emit('resume', {});
    }

    /**
     * Cancel the agent loop entirely.
     */
    cancel() {
        this._cancelled = true;
        this._enqueue('cancel', {});
        this._emit('cancel', {});
    }

    // ─── Consume ─────────────────────────────────────────────────

    /**
     * Drain all pending messages from the queue.
     * Called by AgentLoop at each tick.
     * @returns {Array<{ type: string, payload: any, timestamp: number }>}
     */
    drain() {
        const messages = [...this._queue];
        this._queue = [];
        return messages;
    }

    /**
     * Peek at the next message without consuming it.
     * @returns {{ type: string, payload: any, timestamp: number } | null}
     */
    peek() {
        return this._queue[0] || null;
    }

    /**
     * Check if the agent loop should be paused.
     * @returns {boolean}
     */
    isPaused() {
        return this._paused;
    }

    /**
     * Check if the agent loop has been cancelled.
     * @returns {boolean}
     */
    isCancelled() {
        return this._cancelled;
    }

    /**
     * Check if there are pending steering messages.
     * @returns {boolean}
     */
    hasPending() {
        return this._queue.length > 0;
    }

    /**
     * Reset the queue state (for reuse).
     */
    reset() {
        this._queue = [];
        this._paused = false;
        this._cancelled = false;
    }

    // ─── Events ──────────────────────────────────────────────────

    /**
     * Register a listener for steering events.
     * @param {string} event
     * @param {function} fn
     */
    on(event, fn) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(fn);
    }

    // ─── Internal ────────────────────────────────────────────────

    /** @private */
    _enqueue(type, payload) {
        this._queue.push({
            type,
            payload,
            timestamp: Date.now(),
        });
    }

    /** @private */
    _emit(event, data) {
        const fns = this._listeners.get(event) || [];
        for (const fn of fns) {
            try { fn(data); } catch { /* swallow */ }
        }
    }
}
