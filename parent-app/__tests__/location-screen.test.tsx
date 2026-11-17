// SPDX-License-Identifier: Apache-2.0
//
// The location screen through the real router, against a fake API: the position and the
// map, the route links, Find, "Ring the phone", "Are you okay?" and the location mode.
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { AccessibilityInfo, Linking as NativeLinking, Platform, Share, StyleSheet } from "react-native";
import { checkin, fakeApi, fix, locationState, ME, PHONE, ring } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const LOCATION = `GET /phones/${PHONE.id}/location`;
const CONTACTS = `GET /phones/${PHONE.id}/contacts`;
const SELF = { ...PHONE, id: "22222222-2222-4222-8222-222222222222", name: "Mine", profile: "self" };
const MUM = { id: "k1", name: "Mum", number: "+4512345678" };
const DAD = { id: "k2", name: "Dad", number: "+4587654321" };

/** The routes the location screen loads first. */
function api(extra: Parameters<typeof fakeApi>[0] = {}, phone = PHONE) {
  return fakeApi({
    "GET /me": { body: ME },
    [`GET /phones/${phone.id}`]: { body: phone },
    [`GET /phones/${phone.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${phone.id}/apps`]: { body: { apps: [] } },
    [`GET /phones/${phone.id}/contacts`]: { body: { contacts: [] } },
    ...extra,
  });
}
const open = (phone = PHONE) => renderRouter(routes, { initialUrl: `/phones/${phone.id}/location` });
const reads = (calls: { method: string; path: string }[]) => calls.filter((c) => c.method === "GET" && c.path === `/phones/${PHONE.id}/location`).length;

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("the position", () => {
  it("loads no map tiles until the parent asks for the map", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(80, 5 * 60_000) }) } });
    await open();
    expect(await screen.findByText(/whose servers then see roughly where the phone is/)).toBeTruthy();
    expect(screen.queryByTestId("map-tile")).toBeNull();
    // The facts are there without the map: when, and how accurate.
    expect(screen.getByText("5 minutes ago")).toBeTruthy();
    expect(screen.getAllByText(/within about 80 m/).length).toBeGreaterThan(0);
  });

  it("draws the position on nine tiles with an accuracy circle, zoomed to fit it", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(80) }) } });
    await open();
    await fireEvent.press(await screen.findByTestId("toggle-map"));
    expect(await screen.findByTestId("map")).toBeTruthy();
    const tiles = screen.getAllByTestId("map-tile");
    expect(tiles).toHaveLength(9);
    // 80 m fits at zoom 16; the old fixed zoom 15 would draw it about 30 px across.
    expect(tiles[0].props.source.uri).toMatch(/^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/);
    expect(screen.getByTestId("map-marker")).toBeTruthy();
    expect(screen.getByTestId("map-accuracy")).toBeTruthy();
    expect(screen.getByLabelText("Map with the last position of Alma")).toBeTruthy();
    expect(screen.getByText("Map data © OpenStreetMap contributors")).toBeTruthy();
    expect(screen.getByTestId("toggle-map").props.accessibilityLabel).toBe("Hide map");
  });

  it("zooms out for a rough position and leaves out a circle that is too small or too big to mean anything", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(5000) }) } });
    await open();
    await fireEvent.press(await screen.findByTestId("toggle-map"));
    const tiles = await screen.findAllByTestId("map-tile");
    expect(tiles[0].props.source.uri).toContain("tile.openstreetmap.org/12/");
    expect(screen.queryByTestId("map-accuracy")).toBeNull();
  });

  it("leaves out a circle smaller than the marker", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(3) }) } });
    await open();
    await fireEvent.press(await screen.findByTestId("toggle-map"));
    expect(await screen.findByTestId("map-marker")).toBeTruthy();
    expect(screen.queryByTestId("map-accuracy")).toBeNull();
  });

  it("says so when the tiles cannot load", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(80) }) } });
    await open();
    await fireEvent.press(await screen.findByTestId("toggle-map"));
    const tiles = await screen.findAllByTestId("map-tile");
    expect(screen.queryByText(/The map could not load/)).toBeNull();
    for (const tile of tiles) await fireEvent(tile, "error");
    expect(await screen.findByText(/The map could not load/)).toBeTruthy();
  });

  it("explains what each state of 'no position' means", async () => {
    api({ [LOCATION]: { body: locationState({ mode: "find" }) } });
    await open();
    expect(await screen.findByText("No position yet. Press Find to ask the phone where it is.")).toBeTruthy();
    expect(screen.getByTestId("location-find")).toBeTruthy();
  });

  it("only offers the mode choice when location is off", async () => {
    api({ [LOCATION]: { body: locationState({ enabled: false, mode: "off" }) } });
    await open();
    expect(await screen.findByText("Location is off")).toBeTruthy();
    expect(screen.getByText("Choose when the phone may send its position under Location sharing below.")).toBeTruthy();
    expect(screen.queryByTestId("location-find")).toBeNull();
    expect(screen.getByTestId("mode-off").props.accessibilityState.checked).toBe(true);
  });
});

describe("drive there", () => {
  const apple = "https://maps.apple.com/?daddr=55.676100,12.568300";
  const google = "https://www.google.com/maps/dir/?api=1&destination=55.676100,12.568300";
  const order = () => screen.getAllByTestId(/^route-/).map((n) => n.props.testID);

  afterEach(() => jest.restoreAllMocks());

  it("lists Apple Maps first on iOS and opens it", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(30) }) } });
    const openUrl = jest.spyOn(NativeLinking, "openURL").mockResolvedValue(undefined);
    expect(Platform.OS).toBe("ios");
    await open();
    await screen.findByTestId("position-card");
    expect(order()).toEqual(["route-apple", "route-google"]);
    await fireEvent.press(screen.getByTestId("route-apple"));
    expect(openUrl).toHaveBeenLastCalledWith(apple);
    await fireEvent.press(screen.getByTestId("route-google"));
    expect(openUrl).toHaveBeenLastCalledWith(google);
  });

  it("lists Google Maps first on Android", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(30) }) } });
    const openUrl = jest.spyOn(NativeLinking, "openURL").mockResolvedValue(undefined);
    jest.replaceProperty(Platform, "OS", "android");
    await open();
    await screen.findByTestId("position-card");
    expect(order()).toEqual(["route-google", "route-apple"]);
    await fireEvent.press(screen.getByTestId("route-google"));
    expect(openUrl).toHaveBeenLastCalledWith(google);
  });

  it("names the apps, not the arrow, for screen readers", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(30) }) } });
    await open();
    await screen.findByTestId("position-card");
    expect(screen.getByLabelText("Apple Maps")).toBeTruthy();
    expect(screen.getByLabelText("Google Maps")).toBeTruthy();
  });

  it("tells the parent when no maps app can open the link", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(30) }) } });
    jest.spyOn(NativeLinking, "openURL").mockRejectedValue(new Error("no app"));
    await open();
    await fireEvent.press(await screen.findByTestId("route-google"));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
  });

  it("copies the position as 'lat, lon' with six decimals through the share sheet", async () => {
    api({ [LOCATION]: { body: locationState({ location: fix(30) }) } });
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "dismissedAction", activityType: undefined });
    await open();
    await fireEvent.press(await screen.findByTestId("copy-position"));
    expect(share).toHaveBeenCalledWith({ message: "55.676100, 12.568300" });
    expect(screen.getByTestId("copy-position").props.accessibilityLabel).toBe("Copy position");
  });
});

describe("find", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("asks the phone and shows the new position when it answers", async () => {
    const requestedAt = new Date().toISOString();
    let gets = 0;
    const server = api({
      [LOCATION]: () => {
        gets++;
        // The first read is the screen opening, the second the first poll after Find.
        return { body: locationState(gets >= 2 ? { location: fix(25) } : { location: fix(80, 3_600_000) }) };
      },
      [`POST /phones/${PHONE.id}/locate`]: { status: 202, body: { requestedAt } },
    });
    jest.useFakeTimers({ advanceTimers: true });
    await open();
    await fireEvent.press(await screen.findByTestId("location-find"));
    expect(await screen.findByText("Asking the phone for its position…")).toBeTruthy();
    expect(screen.getByTestId("location-find").props.accessibilityState.busy).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(await screen.findByText("New position received.")).toBeTruthy();
    expect(server.calls.some((c) => c.method === "POST" && c.path === `/phones/${PHONE.id}/locate`)).toBe(true);
    expect(screen.getByTestId("location-find").props.accessibilityState.busy).toBe(false);
  });

  it("says when location is off for the phone", async () => {
    api({
      [LOCATION]: { body: locationState({ location: fix(80) }) },
      [`POST /phones/${PHONE.id}/locate`]: { status: 409, body: { error: "location is off" } },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("location-find"));
    expect(await screen.findByText("Choose when the phone may send its position under Location sharing below.")).toBeTruthy();
  });
});

describe("ring the phone", () => {
  it("rings until 'I'm here' by default, and shows the countdown while it waits", async () => {
    const server = api({
      [LOCATION]: { body: locationState() },
      [`POST /phones/${PHONE.id}/ring`]: { status: 202, body: { ring: ring() } },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("ring-start"));
    expect(await screen.findByText(/Waiting for the phone\. It rings as soon as it gets the message \(\d:\d\d left\)\./)).toBeTruthy();
    expect(server.calls.find((c) => c.method === "POST" && c.path.endsWith("/ring"))!.body).toEqual({ stopOnAnswer: true });
    // While it rings there is a stop button, and no way to start another one.
    expect(screen.getByTestId("ring-stop")).toBeTruthy();
    expect(screen.queryByTestId("ring-start")).toBeNull();
  });

  it("rings the full five minutes when asked to", async () => {
    const server = api({
      [LOCATION]: { body: locationState() },
      [`POST /phones/${PHONE.id}/ring`]: { status: 202, body: { ring: ring({ stopOnAnswer: false }) } },
    });
    await open();
    const keep = await screen.findByTestId("ring-keep");
    expect(keep.props.accessibilityRole).toBe("checkbox");
    expect(keep.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(keep);
    expect(screen.getByTestId("ring-keep").props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByTestId("ring-start"));
    await screen.findByTestId("ring-stop");
    expect(server.calls.find((c) => c.method === "POST" && c.path.endsWith("/ring"))!.body).toEqual({ stopOnAnswer: false });
  });

  it("stops the sound", async () => {
    const server = api({
      [LOCATION]: { body: locationState({ ring: ring({ shownAt: new Date().toISOString() }) }) },
      [`DELETE /phones/${PHONE.id}/ring`]: { body: { ring: ring({ active: false, stoppedAt: new Date().toISOString() }) } },
    });
    await open();
    expect(await screen.findByText(/The phone is ringing now \(\d:\d\d left\)\./)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("ring-stop"));
    expect(await screen.findByText("The sound is stopped.")).toBeTruthy();
    expect(server.calls.some((c) => c.method === "DELETE" && c.path === `/phones/${PHONE.id}/ring`)).toBe(true);
    expect(screen.getByText(/^Stopped at /)).toBeTruthy();
    expect(screen.getByTestId("ring-start")).toBeTruthy();
  });

  it("says when the child pressed 'I'm here'", async () => {
    api({ [LOCATION]: { body: locationState({ ring: ring({ active: false, answeredAt: new Date().toISOString() }) }) } });
    await open();
    expect(await screen.findByText(/^“I'm here” was pressed at /)).toBeTruthy();
  });

  it("says when nobody answered", async () => {
    api({ [LOCATION]: { body: locationState({ ring: ring({ active: false }, -1000) }) } });
    await open();
    expect(await screen.findByText("Nobody pressed “I'm here” within 5 minutes.")).toBeTruthy();
  });

  it("shows the server's refusal when there are too many rings", async () => {
    api({ [LOCATION]: { body: locationState() }, [`POST /phones/${PHONE.id}/ring`]: { status: 429, body: { error: "too many" } } });
    await open();
    await fireEvent.press(await screen.findByTestId("ring-start"));
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
  });
});

describe("are you okay", () => {
  const post = (server: { calls: { method: string; path: string; body: unknown }[] }) =>
    server.calls.find((c) => c.method === "POST" && c.path === `/phones/${PHONE.id}/checkin`)!;

  it("asks with the first contact and ten minutes unless told otherwise", async () => {
    const server = api({
      [LOCATION]: { body: locationState({ mode: "checkin" }) },
      [CONTACTS]: { body: { contacts: [MUM, DAD] } },
      [`POST /phones/${PHONE.id}/checkin`]: { status: 202, body: { checkin: checkin({ callNumber: MUM.number }) } },
    });
    await open();
    expect((await screen.findByTestId("checkin-call-+4512345678")).props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("checkin-minutes-10").props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByTestId("checkin-send"));
    expect(await screen.findByText(/Waiting for the phone to show the question \(\d+:\d\d left\)\./)).toBeTruthy();
    expect(post(server).body).toEqual({ minutes: 10, callNumber: "+4512345678" });
  });

  it("sends the chosen time and the chosen contact for the Call me button", async () => {
    const server = api({
      [LOCATION]: { body: locationState({ mode: "checkin" }) },
      [CONTACTS]: { body: { contacts: [MUM, DAD] } },
      [`POST /phones/${PHONE.id}/checkin`]: { status: 202, body: { checkin: checkin({ callNumber: DAD.number, shownAt: new Date().toISOString() }) } },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("checkin-minutes-15"));
    await fireEvent.press(screen.getByTestId("checkin-call-+4587654321"));
    expect(screen.getByTestId("checkin-minutes-15").props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("checkin-minutes-10").props.accessibilityState.checked).toBe(false);
    await fireEvent.press(screen.getByTestId("checkin-send"));
    expect(await screen.findByText(/The question is on the phone\. Waiting for an answer/)).toBeTruthy();
    expect(post(server).body).toEqual({ minutes: 15, callNumber: "+4587654321" });
  });

  it("can ask without a call button", async () => {
    const server = api({
      [LOCATION]: { body: locationState({ mode: "checkin" }) },
      [CONTACTS]: { body: { contacts: [MUM] } },
      [`POST /phones/${PHONE.id}/checkin`]: { status: 202, body: { checkin: checkin() } },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("checkin-minutes-5"));
    await fireEvent.press(screen.getByTestId("checkin-call-none"));
    await fireEvent.press(screen.getByTestId("checkin-send"));
    await screen.findByTestId("checkin-cancel");
    expect(post(server).body).toEqual({ minutes: 5, callNumber: null });
  });

  it("offers the four times as radio buttons with at least 48 dp to press", async () => {
    api({ [LOCATION]: { body: locationState() }, [CONTACTS]: { body: { contacts: [MUM] } } });
    await open();
    await screen.findByTestId("checkin-minutes");
    for (const m of [5, 10, 15, 30]) {
      const radio = screen.getByTestId(`checkin-minutes-${m}`);
      expect(radio.props.accessibilityRole).toBe("radio");
      expect(radio.props.accessibilityLabel).toBe(`${m} min`);
      expect(StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(48);
    }
    expect(screen.getByLabelText("Time to answer").props.accessibilityRole).toBe("radiogroup");
  });

  it("says there is no Call me button to show when the phone has no contacts", async () => {
    const server = api({
      [LOCATION]: { body: locationState({ mode: "checkin" }) },
      [`POST /phones/${PHONE.id}/checkin`]: { status: 202, body: { checkin: checkin() } },
    });
    await open();
    expect(await screen.findByText("Add yourself as a contact to show a “Call me” button.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("checkin-send"));
    await screen.findByTestId("checkin-cancel");
    expect(post(server).body).toEqual({ minutes: 10, callNumber: null });
  });

  it("explains that no position follows when the location mode does not send one", async () => {
    api({ [LOCATION]: { body: locationState({ mode: "find" }) } });
    await open();
    expect(await screen.findByText(/With the current location setting no position is sent if nobody answers\./)).toBeTruthy();
  });

  it("cancels a question that is waiting", async () => {
    const server = api({
      [LOCATION]: { body: locationState({ checkin: checkin() }) },
      [`DELETE /phones/${PHONE.id}/checkin`]: { body: { checkin: checkin({ status: "cancelled", stoppedAt: new Date().toISOString() }) } },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("checkin-cancel"));
    expect(await screen.findByText("The question is cancelled.")).toBeTruthy();
    expect(server.calls.some((c) => c.method === "DELETE" && c.path === `/phones/${PHONE.id}/checkin`)).toBe(true);
    expect(screen.getByText(/^Cancelled at /)).toBeTruthy();
    expect(screen.getByTestId("checkin-send")).toBeTruthy();
  });

  it("shows what happened when nobody answered, with and without a position", async () => {
    api({ [LOCATION]: { body: locationState({ checkin: checkin({ status: "noReply", locatedAt: new Date().toISOString() }) }) } });
    await open();
    expect(await screen.findByText(/^No answer in time\. The phone sent its position at /)).toBeTruthy();
  });

  it("shows the server's message when the contact is not approved", async () => {
    api({
      [LOCATION]: { body: locationState() },
      [CONTACTS]: { body: { contacts: [MUM] } },
      [`POST /phones/${PHONE.id}/checkin`]: { status: 400, body: { error: "callNumber is not an approved contact" } },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("checkin-send"));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
  });
});

describe("polling and announcements", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("polls every 5 seconds while a ring is waiting and announces when the phone starts ringing", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    let n = 0;
    const server = api({
      [LOCATION]: () => {
        n++;
        return { body: locationState({ ring: ring(n >= 2 ? { shownAt: new Date().toISOString() } : {}) }) };
      },
    });
    jest.useFakeTimers({ advanceTimers: true });
    await open();
    expect(await screen.findByText(/Waiting for the phone\. It rings as soon as it gets the message/)).toBeTruthy();
    expect(reads(server.calls)).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(reads(server.calls)).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(await screen.findByText(/The phone is ringing now/)).toBeTruthy();
    expect(reads(server.calls)).toBe(2);
    // The change is spoken once; the ticking countdown is not.
    await waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^The phone is ringing now/)));
    const announced = announce.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(announce.mock.calls.length).toBe(announced);
  });

  it("polls while a question waits and stops when it is answered", async () => {
    let n = 0;
    const server = api({
      [LOCATION]: () => {
        n++;
        return {
          body: locationState({
            checkin: n >= 2 ? checkin({ status: "answered", answer: "ok", answeredAt: new Date().toISOString() }) : checkin({ shownAt: new Date().toISOString() }),
          }),
        };
      },
    });
    jest.useFakeTimers({ advanceTimers: true });
    await open();
    expect(await screen.findByText(/The question is on the phone/)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(5500);
    });
    expect(await screen.findByText(/^“Yes, I'm okay” at /)).toBeTruthy();
    const after = reads(server.calls);
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(reads(server.calls)).toBe(after);
  });

  it("does not poll when nothing is open on the phone", async () => {
    const server = api({ [LOCATION]: { body: locationState({ location: fix(80) }) } });
    jest.useFakeTimers({ advanceTimers: true });
    await open();
    await screen.findByTestId("position-card");
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(reads(server.calls)).toBe(1);
  });
});

describe("location sharing", () => {
  it("shows the four modes with their explanations and marks the current one", async () => {
    api({ [LOCATION]: { body: locationState({ mode: "checkin" }) } });
    await open();
    expect(await screen.findByText("Location sharing")).toBeTruthy();
    expect(screen.getByText("Choose when the phone sends its position. The child's phone always shows when it does.")).toBeTruthy();
    expect(screen.getByText("Only when I press Find")).toBeTruthy();
    expect(screen.getByText("One position each time you press Find.")).toBeTruthy();
    expect(screen.getByText("Always on (every 5 minutes)")).toBeTruthy();
    const checked = (["off", "find", "checkin", "always"] as const).map((m) => screen.getByTestId(`mode-${m}`).props.accessibilityState.checked);
    expect(checked).toEqual([false, false, true, false]);
    expect(screen.getByTestId("mode-always").props.accessibilityRole).toBe("radio");
  });

  it("says 'your phone' on a Self phone", async () => {
    api({ [`GET /phones/${SELF.id}/location`]: { body: locationState() } }, SELF);
    await open(SELF);
    expect(await screen.findByText("Choose when your phone sends its position. Turning it on applies at once.")).toBeTruthy();
  });

  it("changes the mode at once and says what the phone does now", async () => {
    const server = api({
      [LOCATION]: { body: locationState({ mode: "find" }) },
      [`PUT /phones/${PHONE.id}/location/mode`]: { body: locationState({ mode: "always" }) },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("mode-always"));
    expect(await screen.findByText("The phone now shares its position every 5 minutes, and shows it on the phone.")).toBeTruthy();
    expect(server.calls.find((c) => c.method === "PUT")!.body).toEqual({ mode: "always" });
    expect(screen.getByTestId("mode-always").props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("mode-find").props.accessibilityState.checked).toBe(false);
    // The position of an "always on" phone is expected, so the empty text no longer says to press Find.
    expect(screen.getByText("The phone has not sent a position yet.")).toBeTruthy();
  });

  it("does not ask the server again for the mode that is already chosen", async () => {
    const server = api({ [LOCATION]: { body: locationState({ mode: "find" }) } });
    await open();
    await fireEvent.press(await screen.findByTestId("mode-find"));
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("turning location off hides the position and the Find button", async () => {
    api({
      [LOCATION]: { body: locationState({ location: fix(80) }) },
      [`PUT /phones/${PHONE.id}/location/mode`]: { body: locationState({ enabled: false, mode: "off", location: null }) },
    });
    await open();
    await screen.findByTestId("position-card");
    await fireEvent.press(screen.getByTestId("mode-off"));
    expect(await screen.findByText("Location is off, and the stored position was deleted.")).toBeTruthy();
    expect(screen.queryByTestId("position-card")).toBeNull();
    expect(screen.queryByTestId("location-find")).toBeNull();
    expect(screen.getByText("Location is off")).toBeTruthy();
  });

  it("keeps the old choice and says so when the change fails", async () => {
    api({
      [LOCATION]: { body: locationState({ mode: "find" }) },
      [`PUT /phones/${PHONE.id}/location/mode`]: { status: 500, body: { error: "boom" } },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("mode-always"));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
    expect(screen.getByTestId("mode-find").props.accessibilityState.checked).toBe(true);
  });
});
