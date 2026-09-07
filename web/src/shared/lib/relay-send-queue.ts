/** Apply relay-requested backpressure to a shared authenticated socket. */
export class RelaySendQueue {
  private pending: Array<() => undefined | boolean> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pausedUntil = 0;
  private closed = false;

  /** Queue work; interactive writes may take precedence over background reads. */
  enqueue(send: () => undefined | boolean, priority = false) {
    if (this.closed) return;
    if (priority) this.pending.unshift(send);
    else this.pending.push(send);
    this.flush();
  }

  /** Respect a relay-provided retry deadline for all queued requests. */
  pause(milliseconds: number) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + milliseconds);
  }

  /** Cancel queued work when the authenticated connection is discarded. */
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.pending = [];
  }

  private flush = () => {
    clearTimeout(this.timer);
    if (this.closed || this.pending.length === 0) return;
    const now = Date.now();
    const delay = this.pausedUntil - now;
    if (delay > 0) {
      this.timer = setTimeout(this.flush, delay);
      return;
    }
    this.pending.shift()?.();
    if (this.pending.length) this.flush();
  };
}
