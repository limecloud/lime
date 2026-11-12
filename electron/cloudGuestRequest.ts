/** Stop local waiting without treating a submitted cloud operation as cancelled. */
export async function waitForCloudGuestRequest<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let cancel!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    const result = Promise.race([pending, cancelled]);
    if (signal.aborted) cancel();
    const value = await result;
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
