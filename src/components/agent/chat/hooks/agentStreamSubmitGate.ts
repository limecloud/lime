export class AgentStreamSubmitGate {
  private tail: Promise<void> = Promise.resolve();

  private pendingCount = 0;

  hasPending() {
    return this.pendingCount > 0;
  }

  getPendingCount() {
    return this.pendingCount;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    this.pendingCount += 1;
    this.tail = previous.then(() => current);

    await previous;

    try {
      return await task();
    } finally {
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      releaseCurrent();
    }
  }
}
