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
  }

  get depth() { return this.queue.length; }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    this.#arm(ms);
  }

  schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, queuedAt: Date.now() });
      this.#pump();
    });
  }

  #arm(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#pump(), Math.max(5, ms));
    this.timer.unref?.();
  }

  #wait() {
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
    return wait;
  }

  #pump() {
    while (this.queue.length && this.active < this.maxConcurrent) {
      const wait = this.#wait();
      if (wait > 0) { this.#arm(wait); return; }
      const job = this.queue.shift();
      this.active += 1;
      this.starts.push(Date.now());
      const queueWaitMs = Date.now() - job.queuedAt;
      Promise.resolve().then(() => job.fn({ queueWaitMs })).then(job.resolve, job.reject).finally(() => {
        this.active -= 1;
        this.#pump();
      });
    }
  }
}
