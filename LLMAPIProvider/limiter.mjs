// Per-upstream FIFO queue: max concurrency, max starts per second and per hour, and a pause for 429 backoff.
// Requests are never dropped: they wait.
export class Limiter {
  constructor({ maxConcurrent = 4, maxPerSecond = null, maxPerMinute = null, maxPerHour = null } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxPerSecond = maxPerSecond;
    this.maxPerMinute = maxPerMinute;
    this.maxPerHour = maxPerHour;
    this.queue = [];
    this.active = 0;
    this.starts = [];
    this.pausedUntil = 0;
    this.timer = null;
    this.gate = null; // (job, activeMetas) => {wait, reason}: plan-limit check before a job starts
    this.gateReason = null;
    this.activeMeta = new Set();
  }

  get depth() { return this.queue.length; }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    this.#arm(ms);
  }

  // Seeds the start times (for example from the logs after a restart) so the rate limits survive restarts.
  seed(times) { this.starts = [...this.starts, ...times].sort((a, b) => a - b); }

  // How long a new job with this meta would wait before it could start now (rate limits, 429 pause, plan gate), and why.
  // Jobs already queued are not simulated: the estimate is a lower bound when the queue is not empty.
  estimateWait(meta = null) {
    const saved = this.gateReason;
    const wait = this.#wait({ meta });
    const reason = this.gateReason || (this.pausedUntil > Date.now() ? 'paused after 429' : wait > 0 ? 'queue rate limit' : null);
    this.gateReason = saved;
    return { wait, reason };
  }

  schedule(fn, meta = null) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, meta, queuedAt: Date.now() });
      this.#pump();
    });
  }

  #arm(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#pump(), Math.max(5, ms));
    this.timer.unref?.();
  }

  #wait(job) {
    const now = Date.now();
    this.starts = this.starts.filter((t) => now - t < 3600_000);
    let wait = Math.max(0, this.pausedUntil - now);
    if (this.maxPerSecond) {
      const recent = this.starts.filter((t) => now - t < 1000);
      if (recent.length >= this.maxPerSecond) wait = Math.max(wait, 1000 - (now - recent[recent.length - this.maxPerSecond]));
    }
    if (this.maxPerMinute) {
      const recent = this.starts.filter((t) => now - t < 60_000);
      if (recent.length >= this.maxPerMinute) wait = Math.max(wait, 60_000 - (now - recent[recent.length - this.maxPerMinute]));
    }
    if (this.maxPerHour && this.starts.length >= this.maxPerHour) {
      wait = Math.max(wait, 3600_000 - (now - this.starts[this.starts.length - this.maxPerHour]));
    }
    this.gateReason = null;
    if (this.gate) {
      const g = this.gate(job, [...this.activeMeta]);
      if (g.wait > wait) { wait = g.wait; this.gateReason = g.reason; }
    }
    return wait;
  }

  #pump() {
    while (this.queue.length && this.active < this.maxConcurrent) {
      const wait = this.#wait(this.queue[0]);
      if (wait > 0) { this.#arm(wait); return; }
      const job = this.queue.shift();
      this.active += 1;
      this.activeMeta.add(job.meta);
      this.starts.push(Date.now());
      const queueWaitMs = Date.now() - job.queuedAt;
      Promise.resolve().then(() => job.fn({ queueWaitMs })).then(job.resolve, job.reject).finally(() => {
        this.active -= 1;
        this.activeMeta.delete(job.meta);
        this.#pump();
      });
    }
  }
}
