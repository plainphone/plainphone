// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useLoad } from "./ui";

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => (resolve = r));
  return { promise, resolve };
}

it("keeps the newest answer when an older request finishes last", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending: Record<string, ReturnType<typeof deferred>> = { A: deferred(), B: deferred() };
  let shown: string | undefined;
  let reload!: () => Promise<void>;
  function View({ pid }: { pid: string }) {
    const res = useLoad(() => pending[pid]!.promise, [pid]);
    shown = res.data;
    reload = res.reload;
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<View pid="A" />));
    // The parent moves on to phone B before phone A has answered.
    await act(async () => root.render(<View pid="B" />));
    await act(async () => pending.B!.resolve("B"));
    expect(shown).toBe("B");
    await act(async () => pending.A!.resolve("A"));
    expect(shown).toBe("B");

    // Two overlapping reloads: the one started last decides.
    const first = deferred();
    const second = deferred();
    pending.B = first;
    let r1!: Promise<void>;
    await act(async () => { r1 = reload(); });
    pending.B = second;
    let r2!: Promise<void>;
    await act(async () => { r2 = reload(); });
    await act(async () => { second.resolve("new"); await r2; });
    await act(async () => { first.resolve("old"); await r1; });
    expect(shown).toBe("new");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
