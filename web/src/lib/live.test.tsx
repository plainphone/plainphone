// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveIndicator } from "../components/LiveIndicator";
import { LiveSettings } from "../components/LiveSettings";
import { LiveSosAlert } from "../components/LiveSosAlert";
import { I18nProvider } from "../i18n/I18n";
import { api } from "./api";
import { LIVE_DEBOUNCE_MS, LiveProvider, useLiveRefresh, useLiveStatus } from "./live";
import { LIVE_KEY, SOS_SOUND_KEY } from "./live-settings";
import type { LiveEventType } from "./live-events";

class FakeEventSource {
  static all: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: { data: string; lastEventId: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(name: string, fn: (e: { data: string; lastEventId: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(name: string, data: unknown = {}, id = "") {
    this.listeners.get(name)?.forEach((fn) => fn({ data: JSON.stringify(data), lastEventId: id }));
  }
}
const sources = () => FakeEventSource.all;
const current = () => FakeEventSource.all[FakeEventSource.all.length - 1]!;

let visibility = "visible";
function setVisibility(v: "visible" | "hidden") {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

let root: Root;
let container: HTMLElement;
const refresh = vi.fn();

function Probe({ types = ["sos.created"], phone = "p1", poll = 30_000 }: { types?: LiveEventType[]; phone?: string | null; poll?: number | null }) {
  useLiveRefresh(types, phone ?? undefined, refresh, poll);
  return <span id="status">{useLiveStatus()}</span>;
}
const status = () => container.querySelector("#status")?.textContent;

async function mount(ui: React.ReactNode, signedIn = true) {
  await act(async () => root.render(
    <I18nProvider>
      <MemoryRouter initialEntries={["/settings"]}>
        <LiveProvider signedIn={signedIn}>{ui}</LiveProvider>
      </MemoryRouter>
    </I18nProvider>,
  ));
}
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const goLive = () => act(async () => {
  current().open();
  current().emit("ready", { resumed: false });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"] });
  vi.stubGlobal("EventSource", FakeEventSource);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });
  FakeEventSource.all = [];
  refresh.mockReset();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LiveProvider and useLiveRefresh", () => {
  it("opens one connection for the tab, however many views listen", async () => {
    await mount(<><Probe /><Probe phone="p2" /></>);
    expect(sources()).toHaveLength(1);
    expect(current().url).toBe("/api/events");
    expect(status()).toBe("connecting");
    await goLive();
    expect(status()).toBe("live");
  });

  it("refreshes once for a burst of matching events and ignores other phones and types", async () => {
    await mount(<Probe />);
    await goLive();
    await act(async () => {
      current().emit("sos.created", { phoneId: "p1", id: "a" }, "1");
      current().emit("sos.created", { phoneId: "p1", id: "b" }, "2");
      current().emit("sos.created", { phoneId: "p2", id: "c" }, "3");
      current().emit("location.updated", { phoneId: "p1" }, "4");
    });
    expect(refresh).not.toHaveBeenCalled();
    await advance(LIVE_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a view without a phone takes every phone", async () => {
    await mount(<Probe phone={null} />);
    await goLive();
    await act(async () => current().emit("sos.created", { phoneId: "anyone" }, "1"));
    await advance(LIVE_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on a refetch event", async () => {
    await mount(<Probe />);
    await goLive();
    await act(async () => current().emit("refetch"));
    await advance(LIVE_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("polls as before while not live and only as a slow safety net while live", async () => {
    await mount(<Probe />);
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await goLive();
    refresh.mockClear();
    await advance(60_000);
    expect(refresh).not.toHaveBeenCalled();
    await advance(5 * 60_000);
    expect(refresh).toHaveBeenCalled();
  });

  it("a view that never polled does not start", async () => {
    await mount(<Probe poll={null} />);
    await advance(10 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a hidden tab closes the connection and a visible one reconnects and refreshes", async () => {
    await mount(<Probe />);
    await goLive();
    await act(async () => setVisibility("hidden"));
    expect(current().closed).toBe(true);
    expect(status()).toBe("off");
    refresh.mockClear();
    await advance(60_000);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => setVisibility("visible"));
    expect(sources()).toHaveLength(2);
    expect(current().url).toBe("/api/events");
    await advance(LIVE_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not connect when the setting is off, and polls normally", async () => {
    localStorage.setItem(LIVE_KEY, "off");
    await mount(<Probe />);
    expect(sources()).toHaveLength(0);
    expect(status()).toBe("off");
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not connect when signed out", async () => {
    await mount(<Probe />, false);
    expect(sources()).toHaveLength(0);
  });

  it("closes the connection when the setting is switched off", async () => {
    await mount(<><Probe /><LiveSettings /></>);
    expect(sources()).toHaveLength(1);
    const live = container.querySelector<HTMLInputElement>("input[type=checkbox], [role=switch]")!;
    await act(async () => live.click());
    expect(current().closed).toBe(true);
    expect(localStorage.getItem(LIVE_KEY)).toBe("off");
  });

  it("falls back to polling without EventSource, and does not crash", async () => {
    vi.stubGlobal("EventSource", undefined);
    await mount(<Probe />);
    expect(status()).toBe("fallback");
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("treats a connection that errors before opening as refused", async () => {
    await mount(<Probe />);
    await act(async () => {
      current().readyState = 2;
      current().onerror?.();
    });
    expect(current().closed).toBe(true);
    expect(status()).toBe("fallback");
    await advance(60_000);
    expect(sources()).toHaveLength(1);
  });

  it("closes its own EventSource on a network error and retries with backoff", async () => {
    await mount(<Probe />);
    await goLive();
    await act(async () => {
      current().readyState = 0;
      current().onerror?.();
    });
    expect(sources()[0]!.closed).toBe(true);
    expect(status()).toBe("connecting");
    await advance(1_300);
    expect(sources()).toHaveLength(2);
  });

  it("shows the state in the header indicator, with words", async () => {
    await mount(<LiveIndicator />);
    expect(container.textContent).toBe("Connecting");
    await goLive();
    expect(container.textContent).toBe("Live");
    await act(async () => {
      current().readyState = 0;
      current().onerror?.();
    });
    await advance(1_300);
    await act(async () => {
      current().readyState = 2;
      current().onerror?.();
    });
    expect(container.textContent).toBe("Not live");
  });

  it("shows nothing in the indicator when live updates are off", async () => {
    localStorage.setItem(LIVE_KEY, "off");
    await mount(<LiveIndicator />);
    expect(container.textContent).toBe("");
  });
});

describe("live settings", () => {
  it("default to on, also when storage throws, and are remembered in memory then", async () => {
    const { readLiveSetting, writeLiveSetting } = await import("./live-settings");
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(readLiveSetting(SOS_SOUND_KEY)).toBe(true);
    writeLiveSetting(SOS_SOUND_KEY, false);
    expect(readLiveSetting(SOS_SOUND_KEY)).toBe(false);
    writeLiveSetting(SOS_SOUND_KEY, true);
  });
});

describe("LiveSosAlert", () => {
  let tones: number;
  const unseen = [{ id: "s1", kind: "urgent" }];

  beforeEach(() => {
    tones = 0;
    vi.stubGlobal("AudioContext", class {
      state = "running";
      currentTime = 0;
      destination = {};
      constructor() {
        tones++;
      }
      createOscillator() {
        return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, onended: null };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
      }
      close() {
        return Promise.resolve();
      }
      resume() {
        return Promise.resolve();
      }
    });
    vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path.endsWith("/sos?unseen=1")) return { events: unseen } as never;
      if (path === "/phones/p1") return { id: "p1", name: "Sam" } as never;
      throw new Error(`unexpected ${path}`);
    });
  });

  const sosCreated = (id = "s1") => act(async () => current().emit("sos.created", { phoneId: "p1", id }, id));

  it("shows an accessible alert with a link to the phone, and plays the tone once", async () => {
    await mount(<LiveSosAlert />);
    await goLive();
    await sosCreated();
    const alert = container.querySelector<HTMLElement>("[role=alert]")!;
    expect(alert.textContent).toContain("Sam");
    expect(alert.textContent).toContain("Urgent SOS");
    expect(alert.tabIndex).toBe(-1);
    expect(alert.querySelector("a")!.getAttribute("href")).toBe("/phones/p1");
    expect(api.get).toHaveBeenCalledWith("/phones/p1/sos?unseen=1");
    expect(tones).toBe(1);
    // The same SOS again (a reconnect, a second event) does not repeat the sound.
    await sosCreated();
    expect(tones).toBe(1);
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
  });

  it("stays silent when the SOS sound is switched off, but still shows the alert", async () => {
    localStorage.setItem(SOS_SOUND_KEY, "off");
    await mount(<LiveSosAlert />);
    await goLive();
    await sosCreated();
    expect(tones).toBe(0);
    expect(container.querySelector("[role=alert]")).not.toBeNull();
  });

  it("does not throw when sound is blocked", async () => {
    vi.stubGlobal("AudioContext", class {
      constructor() {
        throw new Error("blocked");
      }
    });
    await mount(<LiveSosAlert />);
    await goLive();
    await sosCreated();
    expect(container.querySelector("[role=alert]")).not.toBeNull();
  });

  it("can be dismissed, and stays dismissed for that SOS", async () => {
    await mount(<LiveSosAlert />);
    await goLive();
    await sosCreated();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector("[role=alert]")).toBeNull();
    await sosCreated();
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("takes the alert down when another parent has seen the SOS", async () => {
    await mount(<LiveSosAlert />);
    await goLive();
    await sosCreated();
    unseen.length = 0;
    await act(async () => current().emit("sos.updated", { phoneId: "p1", id: "s1" }, "2"));
    unseen.push({ id: "s1", kind: "urgent" });
    expect(container.querySelector("[role=alert]")).toBeNull();
  });
});
