// SPDX-License-Identifier: Apache-2.0
//
// The live provider (foreground/background, the setting), the refresh hook, and the SOS banner.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Text, Vibration } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SosAlert } from "../src/components/SosAlert";
import { I18nProvider } from "../src/i18n/I18n";
import { LIVE_DEBOUNCE_MS, LiveProvider, useLiveRefresh, useLiveStatus } from "../src/lib/live";
import type { Transport, TransportHandlers } from "../src/shared/lib/live-events";
import { fakeApi, PHONE } from "../test/fakeApi";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  // The focus effect only runs while mounted here, which is what a focused screen does.
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual<typeof import("react")>("react").useEffect(cb, [cb]),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../src/lib/session", () => ({
  useSession: () => ({ state: { status: "in" }, serverUrl: "https://pp.example.test" }),
}));

interface Opened { url: string; h: TransportHandlers; closed: boolean }

function fakeTransport() {
  const opened: Opened[] = [];
  const transport: Transport = (url, h) => {
    const o: Opened = { url, h, closed: false };
    opened.push(o);
    return () => { o.closed = true; };
  };
  return { opened, transport };
}

/** The app moves to the background and back. */
function mockAppState() {
  const handlers: ((s: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, fn) => {
    handlers.push(fn as (s: string) => void);
    return { remove: jest.fn() };
  });
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
  return async (s: "active" | "background" | "inactive") => {
    (AppState as { currentState: string }).currentState = s;
    await act(async () => handlers.forEach((fn) => fn(s)));
  };
}

const store = () => (jest.requireMock("expo-secure-store") as { __store: Map<string, string> }).__store;
const SOS_ID = "22222222-2222-4222-8222-222222222222";

async function send(o: Opened, event: string, data: unknown, id?: string) {
  await act(async () => o.h.onMessage(event, JSON.stringify(data), id));
}
async function openStream(o: Opened, resumed = false) {
  await act(async () => o.h.onOpen());
  await send(o, "ready", { resumed }, "boot-1");
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  mockPush.mockClear();
});

describe("live connection", () => {
  function Status() {
    return <Text testID="status">{useLiveStatus()}</Text>;
  }
  const mount = (transport: Transport) => render(<I18nProvider initial="en"><LiveProvider transport={transport}><Status /></LiveProvider></I18nProvider>);

  it("opens in the foreground, closes in the background and resumes with the last event id", async () => {
    const setState = mockAppState();
    const { opened, transport } = fakeTransport();
    await mount(transport);
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]!.url).toBe("https://pp.example.test/api/events");

    await openStream(opened[0]!);
    await send(opened[0]!, "sos.updated", { phoneId: PHONE.id, id: SOS_ID }, "evt-7");

    await setState("background");
    expect(opened[0]!.closed).toBe(true);
    expect(opened).toHaveLength(1);

    await setState("active");
    await waitFor(() => expect(opened).toHaveLength(2));
    expect(opened[1]!.url).toBe("https://pp.example.test/api/events?lastEventId=evt-7");

    // The inactive state (an iOS app switcher) also pauses it.
    await setState("inactive");
    expect(opened[1]!.closed).toBe(true);
  });

  it("never opens when the setting is off", async () => {
    mockAppState();
    store().set("pp.liveUpdates", "off");
    const { opened, transport } = fakeTransport();
    await mount(transport);
    // Give the saved setting time to load; the default (on) must not have started a connection first.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setImmediate(r)); });
    expect(opened).toHaveLength(0);
  });
});

describe("useLiveRefresh", () => {
  function Screen({ refresh, poll }: { refresh: () => void; poll: number }) {
    useLiveRefresh(["inbox.message"], PHONE.id, refresh, poll);
    return null;
  }

  it("refetches once, debounced, on a matching event only, and on refetch", async () => {
    mockAppState();
    const { opened, transport } = fakeTransport();
    const refresh = jest.fn();
    await render(<I18nProvider initial="en"><LiveProvider transport={transport}><Screen refresh={refresh} poll={0} /></LiveProvider></I18nProvider>);
    await waitFor(() => expect(opened).toHaveLength(1));
    await openStream(opened[0]!);
    jest.useFakeTimers();

    await send(opened[0]!, "inbox.message", { phoneId: "another-phone", id: "m0" }, "e1");
    await send(opened[0]!, "location.updated", { phoneId: PHONE.id }, "e2");
    await act(async () => { jest.advanceTimersByTime(LIVE_DEBOUNCE_MS * 2); });
    expect(refresh).not.toHaveBeenCalled();

    await send(opened[0]!, "inbox.message", { phoneId: PHONE.id, id: "m1" }, "e3");
    await send(opened[0]!, "inbox.message", { phoneId: PHONE.id, id: "m2" }, "e4");
    await act(async () => { jest.advanceTimersByTime(LIVE_DEBOUNCE_MS - 1); });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(refresh).toHaveBeenCalledTimes(1);

    await send(opened[0]!, "refetch", {}, "e5");
    await act(async () => { jest.advanceTimersByTime(LIVE_DEBOUNCE_MS); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps polling while not live, and only slowly while live", async () => {
    mockAppState();
    store().set("pp.liveUpdates", "off");
    jest.useFakeTimers();
    const refresh = jest.fn();
    const { transport } = fakeTransport();
    await render(<I18nProvider initial="en"><LiveProvider transport={transport}><Screen refresh={refresh} poll={10_000} /></LiveProvider></I18nProvider>);
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("polls only as a safety net once live", async () => {
    mockAppState();
    const { opened, transport } = fakeTransport();
    const refresh = jest.fn();
    await render(<I18nProvider initial="en"><LiveProvider transport={transport}><Screen refresh={refresh} poll={10_000} /></LiveProvider></I18nProvider>);
    await waitFor(() => expect(opened).toHaveLength(1));
    await openStream(opened[0]!);
    jest.useFakeTimers();
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SOS banner", () => {
  function mountAlert(transport: Transport) {
    return render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <I18nProvider initial="en"><LiveProvider transport={transport}><SosAlert /></LiveProvider></I18nProvider>
      </SafeAreaProvider>,
    );
  }
  const api = () => fakeApi({
    [`GET /phones/${PHONE.id}`]: { body: PHONE },
    [`GET /phones/${PHONE.id}/sos`]: { body: { events: [{ id: SOS_ID, kind: "urgent", createdAt: "2026-11-16T10:00:00Z" }], callbackNumber: null } },
  });

  it("shows on sos.created, vibrates once, and opens the phone", async () => {
    mockAppState();
    const vibrate = jest.spyOn(Vibration, "vibrate").mockImplementation(() => undefined);
    vibrate.mockClear(); // the spy outlives restoreAllMocks, with its old calls
    api();
    const { opened, transport } = fakeTransport();
    await mountAlert(transport);
    await waitFor(() => expect(opened).toHaveLength(1));
    await openStream(opened[0]!);

    await send(opened[0]!, "sos.created", { phoneId: PHONE.id, id: SOS_ID }, "e1");
    const banner = await screen.findByTestId("sos-alert");
    expect(banner.props.accessibilityRole).toBe("alert");
    expect(await screen.findByText("SOS from Alma")).toBeTruthy();
    expect(screen.getByText("Urgent SOS")).toBeTruthy();
    expect(vibrate).toHaveBeenCalledTimes(1);

    // The same SOS again (a replay after a reconnect) does not alert twice.
    await send(opened[0]!, "sos.created", { phoneId: PHONE.id, id: SOS_ID }, "e1b");
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("sos-alert")).toHaveLength(1);

    await fireEvent.press(screen.getByTestId("sos-alert-open"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/phones/[pid]", params: { pid: PHONE.id } });
    expect(screen.queryByTestId("sos-alert")).toBeNull();
  });

  it("can be dismissed, and stays silent when the alert setting is off", async () => {
    mockAppState();
    store().set("pp.sosAlert", "off");
    const vibrate = jest.spyOn(Vibration, "vibrate").mockImplementation(() => undefined);
    vibrate.mockClear(); // the spy outlives restoreAllMocks, with its old calls
    api();
    const { opened, transport } = fakeTransport();
    await mountAlert(transport);
    await waitFor(() => expect(opened).toHaveLength(1));
    await openStream(opened[0]!);

    await send(opened[0]!, "sos.created", { phoneId: PHONE.id, id: SOS_ID }, "e1");
    expect(await screen.findByTestId("sos-alert")).toBeTruthy();
    expect(vibrate).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("sos-alert-close"));
    expect(screen.queryByTestId("sos-alert")).toBeNull();
  });

  it("still shows a banner when the phone cannot be looked up", async () => {
    mockAppState();
    jest.spyOn(Vibration, "vibrate").mockImplementation(() => undefined);
    fakeApi({});
    const { opened, transport } = fakeTransport();
    await mountAlert(transport);
    await waitFor(() => expect(opened).toHaveLength(1));
    await openStream(opened[0]!);
    await send(opened[0]!, "sos.created", { phoneId: PHONE.id, id: SOS_ID }, "e1");
    expect(await screen.findByText("SOS from a phone")).toBeTruthy();
  });
});
