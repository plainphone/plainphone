// SPDX-License-Identifier: Apache-2.0

/** One bounded HTTP waiter per phone. The database timestamp is the source of truth. */
export class UpdateWake {
  private readonly listeners = new Map<string, (requestedAtMs: number) => void>();

  notify(phoneId: string, requestedAtMs: number) {
    this.listeners.get(phoneId)?.(requestedAtMs);
  }

  listen(phoneId: string, signal: AbortSignal) {
    if (this.listeners.has(phoneId)) return null;
    let resolve!: (requestedAtMs: number | null) => void;
    const result = new Promise<number | null>((done) => { resolve = done; });
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (this.listeners.get(phoneId) === resolve) this.listeners.delete(phoneId);
      resolve(null);
    };
    const timer = setTimeout(cancel, 55_000);
    this.listeners.set(phoneId, resolve);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    return { result, cancel };
  }
}
