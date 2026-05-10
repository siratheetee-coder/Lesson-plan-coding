// In-process semaphore — caps simultaneous heavy operations (e.g. unit outliner).
// When at capacity, callers wait in a FIFO queue. If the queue is full or the
// caller waits too long, acquire() rejects so the route can return 503.
//
// All state is per-process (Node single-thread) — sufficient for a single
// Render dyno. If we ever scale to multiple dynos, swap this for Redis-backed.

export class Semaphore {
  constructor({ name = 'sem', maxConcurrent = 3, maxQueue = 10, queueTimeoutMs = 120000 } = {}) {
    this.name = name;
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.maxQueue = Math.max(0, maxQueue);
    this.queueTimeoutMs = queueTimeoutMs;
    this.active = 0;
    this.queue = []; // array of { resolve, reject, timer, enqueuedAt }
  }

  // Snapshot for logging / health endpoint.
  stats() {
    return {
      name: this.name,
      active: this.active,
      max_concurrent: this.maxConcurrent,
      queued: this.queue.length,
      max_queue: this.maxQueue,
    };
  }

  // Returns a `release()` function that the caller MUST invoke (use try/finally).
  // Rejects with { code } if the queue is full or wait time exceeds queueTimeoutMs.
  acquire() {
    return new Promise((resolve, reject) => {
      // Fast path — slot available
      if (this.active < this.maxConcurrent) {
        this.active++;
        resolve(this._makeRelease());
        return;
      }
      // Queue full — fail fast so client can retry later
      if (this.queue.length >= this.maxQueue) {
        const err = new Error('queue_full');
        err.code = 'queue_full';
        return reject(err);
      }
      // Otherwise enqueue with timeout
      const entry = { resolve: null, reject: null, timer: null, enqueuedAt: Date.now() };
      entry.timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx >= 0) this.queue.splice(idx, 1);
        const err = new Error('queue_timeout');
        err.code = 'queue_timeout';
        reject(err);
      }, this.queueTimeoutMs);
      entry.resolve = () => {
        clearTimeout(entry.timer);
        this.active++;
        resolve(this._makeRelease());
      };
      entry.reject = (e) => {
        clearTimeout(entry.timer);
        reject(e);
      };
      this.queue.push(entry);
    });
  }

  _makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      // Promote next queued caller
      const next = this.queue.shift();
      if (next) next.resolve();
    };
  }
}

// ─── Outline semaphore (the only heavy AI endpoint right now) ───
// Tunable via env so we can adjust without redeploying code:
//   OUTLINE_MAX_CONCURRENT  — # of in-flight outline calls (default 3)
//   OUTLINE_MAX_QUEUE       — # of waiters allowed (default 8)
//   OUTLINE_QUEUE_TIMEOUT_MS — max wait time before reject (default 90s)
export const outlineSemaphore = new Semaphore({
  name: 'unit_outline',
  maxConcurrent: parseInt(process.env.OUTLINE_MAX_CONCURRENT) || 3,
  maxQueue:      parseInt(process.env.OUTLINE_MAX_QUEUE)      || 8,
  queueTimeoutMs: parseInt(process.env.OUTLINE_QUEUE_TIMEOUT_MS) || 90000,
});
