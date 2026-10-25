type Read = {
  expired: boolean;
  waiting: Set<(ready: boolean) => void>;
  timer: ReturnType<typeof setTimeout>;
};

/** One in-flight authority read per Session, with no per-request promise handlers. */
export class ApplicationNetworkRefresh {
  #read: Read | null = null;

  authorize(
    refresh: () => Promise<void>,
    decide: () => boolean,
    callback: (allowed: boolean) => void,
  ): void {
    if (this.#read?.expired || (this.#read?.waiting.size ?? 0) >= 256) {
      callback(false);
      return;
    }
    let read = this.#read;
    if (!read) {
      const current: Read = {
        expired: false,
        waiting: new Set(),
        timer: setTimeout(() => this.#expire(current), 10_000),
      };
      current.timer.unref?.();
      this.#read = read = current;
      void Promise.resolve()
        .then(refresh)
        .then(
          () => this.#settle(current, true),
          () => this.#settle(current, false),
        );
    }
    read.waiting.add((ready) => {
      let allowed = false;
      if (ready) {
        try {
          allowed = decide();
        } catch {
          /* Callback must settle closed. */
        }
      }
      callback(allowed);
    });
  }

  invalidate(): void {
    if (this.#read) this.#expire(this.#read);
  }

  #expire(read: Read): void {
    read.expired = true;
    clearTimeout(read.timer);
    for (const finish of [...read.waiting]) finish(false);
    read.waiting.clear();
    // Keep the expired read until its source settles: hostile requests cannot
    // accumulate new continuations on a forever-pending authority promise.
  }

  #settle(read: Read, ready: boolean): void {
    clearTimeout(read.timer);
    if (this.#read === read) this.#read = null;
    for (const finish of [...read.waiting]) finish(ready && !read.expired);
    read.waiting.clear();
  }
}
