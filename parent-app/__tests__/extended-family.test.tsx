// SPDX-License-Identifier: Apache-2.0
//
// Extended family contacts and location snapshots in the family inbox section
// (docs/extended-family.md), through the real router against a fake API.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert, Linking as NativeLinking, Share } from "react-native";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const SOS = `/phones/${PHONE.id}/sos`;
const INBOX = `/phones/${PHONE.id}/inbox`;
const EXT = `/phones/${PHONE.id}/extended`;
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const LINK = "https://plainphone.example/family#invite=pp_fi_secret";
const contact = (n: number, name: string, status: string, group = "others") => ({
  id: ID(n), name, group, status, childApproved: status === "active", contactAccepted: status === "active",
  linkExpiresAt: null, createdAt: "2026-11-01T10:00:00Z",
});
const roster = {
  enabled: true, locationSnapshots: true,
  contacts: [
    contact(1, "Grandma", "waitingForChild"),
    contact(2, "Uncle Joe", "waitingForContact"),
    contact(3, "Cousin Kim", "active", "family"),
    contact(4, "Neighbour", "blocked"),
  ],
};
const thread = (messages: unknown[]) => ({ familyInbox: true, quickMessages: true, checkIns: false, recipients: ["Alex"], messages });

function serve(settings: Record<string, unknown>, extra: Parameters<typeof fakeApi>[0] = {}) {
  const state = { settings: { ...settings } };
  const api = fakeApi({
    "GET /me": { body: ME },
    "GET /phones": { body: { phones: [PHONE] } },
    [`GET /phones/${PHONE.id}`]: { body: PHONE },
    [`GET /phones/${PHONE.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${PHONE.id}/apps`]: { body: { apps: [] } },
    [`GET ${SOS}`]: () => ({ body: { events: [], callbackNumber: null, settings: state.settings } }),
    [`PUT ${SOS}`]: ({ body }) => {
      Object.assign(state.settings, body);
      return { status: 204 };
    },
    [`GET /phones/${PHONE.id}/quick-messages`]: { body: { messages: [], suggestions: [] } },
    [`GET /phones/${PHONE.id}/home`]: { body: {} },
    [`GET /phones/${PHONE.id}/time-limits`]: { body: { total: null, apps: [], bonuses: [], used: null } },
    [`GET /notifications`]: { body: { mutedPhoneIds: [] } },
    [`GET /phones/${PHONE.id}/more-time-requests`]: { body: { requests: [] } },
    [`GET ${INBOX}`]: { body: thread([]) },
    [`GET ${EXT}`]: { body: roster },
    ...extra,
  });
  return { api, state };
}

const checked = (testID: string) => screen.getByTestId(testID).props.accessibilityState.checked;
const sent = (api: ReturnType<typeof fakeApi>, method: string) => api.calls.filter((c) => c.method === method);

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});
afterEach(() => jest.restoreAllMocks());

describe("extended family switches", () => {
  it("start off, say they need the inbox, and save through the settings PUT", async () => {
    const { api } = serve({});
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    await fireEvent.press(await screen.findByTestId("family-inbox-toggle"));
    expect(checked("inbox-extended")).toBe(false);
    expect(checked("inbox-snapshots")).toBe(false);
    expect(screen.getByTestId("inbox-extended").props.accessibilityHint).toContain("Works when the family inbox is on.");
    expect(screen.queryByTestId("extended-name")).toBeNull();
    await fireEvent.press(screen.getByTestId("inbox-extended"));
    await waitFor(() => expect(checked("inbox-extended")).toBe(true));
    await fireEvent.press(screen.getByTestId("inbox-snapshots"));
    await waitFor(() => expect(checked("inbox-snapshots")).toBe(true));
    expect(sent(api, "PUT").map((c) => c.body)).toEqual([{ extendedFamily: true }, { locationSnapshots: true }]);
  });
});

describe("extended family roster", () => {
  it("shows each person in plain words and offers a new link only where it fits", async () => {
    serve({ familyInbox: true, extendedFamily: true });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    expect(await screen.findByText("Waiting for your child to say yes")).toBeTruthy();
    expect(screen.getByText("Waiting for Uncle Joe to accept the link")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Blocked by your child")).toBeTruthy();
    expect(screen.getByTestId(`extended-${ID(1)}-renew`)).toBeTruthy();
    expect(screen.queryByTestId(`extended-${ID(4)}-renew`)).toBeNull();
  });

  it("invites with a name and shows the single-use link once, to share", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction", activityType: undefined });
    const { api } = serve({ familyInbox: true, extendedFamily: true }, {
      [`POST ${EXT}`]: () => ({ status: 201, body: { contact: contact(5, "Aunt May", "waitingForChild"), link: LINK, expiresAt: "2026-11-27T10:00:00Z" } }),
    });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    await fireEvent.changeText(await screen.findByTestId("extended-name"), " Aunt May ");
    await fireEvent.press(screen.getByTestId("extended-invite"));
    expect(await screen.findByText(LINK)).toBeTruthy();
    expect(sent(api, "POST")[0]).toMatchObject({ path: EXT, body: { name: "Aunt May" } });
    expect(screen.getByText(/works once, for 7 days/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("extended-share"));
    expect(share).toHaveBeenCalledWith({ message: LINK });
    await fireEvent.press(screen.getByTestId("extended-done"));
    expect(screen.queryByText(LINK)).toBeNull();
  });

  it("asks for a new link, removes after a confirmation and changes the group", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { api } = serve({ familyInbox: true, extendedFamily: true }, {
      [`POST ${EXT}/${ID(1)}/link`]: () => ({ body: { contact: roster.contacts[0], link: LINK, expiresAt: "2026-11-27T10:00:00Z" } }),
      [`DELETE ${EXT}/${ID(1)}`]: { status: 204 },
      [`PATCH ${EXT}/${ID(1)}`]: ({ body }) => ({ body: { ...roster.contacts[0], ...(body as object) } }),
    });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    await fireEvent.press(await screen.findByTestId(`extended-${ID(1)}-renew`));
    expect(await screen.findByText(LINK)).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`extended-${ID(1)}-family`));
    await waitFor(() => expect(sent(api, "PATCH")).toHaveLength(1));
    expect(sent(api, "PATCH")[0]).toMatchObject({ path: `${EXT}/${ID(1)}`, body: { group: "family" } });

    await fireEvent.press(screen.getByTestId(`extended-${ID(1)}-remove`));
    expect(sent(api, "DELETE")).toHaveLength(0);
    const buttons = alert.mock.calls[0]![2]!;
    buttons.find((b) => b.style === "destructive")!.onPress!();
    await waitFor(() => expect(sent(api, "DELETE")).toHaveLength(1));
    expect(sent(api, "DELETE")[0]!.path).toBe(`${EXT}/${ID(1)}`);
  });
});

describe("a paused roster", () => {
  it("stays visible with the paused line and Remove, without inviting or new links", async () => {
    serve({ familyInbox: true, extendedFamily: false }, { [`GET ${EXT}`]: { body: { ...roster, enabled: false } } });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    expect(await screen.findByText(/^Paused\. Everyone stays on the list/)).toBeTruthy();
    expect(screen.getByTestId(`extended-${ID(4)}-remove`)).toBeTruthy();
    expect(screen.queryByTestId(`extended-${ID(1)}-renew`)).toBeNull();
    expect(screen.queryByTestId("extended-name")).toBeNull();
  });
});

describe("location snapshots in the inbox thread", () => {
  it("links a live one to OpenStreetMap and says a gone one is no longer visible", async () => {
    const open = jest.spyOn(NativeLinking, "openURL").mockResolvedValue(undefined);
    serve({ familyInbox: true }, {
      [`GET ${INBOX}`]: { body: thread([
        { id: ID(1), from: "child", kind: "snapshot", text: "", sentAt: "2026-11-19T15:40:00Z", delivered: 1,
          location: { lat: 55.67594, lon: 12.56553, accuracyM: 20, recordedAt: "2026-11-19T15:40:00Z", expiresAt: "2026-11-19T16:40:00Z" } },
        { id: ID(2), from: "child", kind: "snapshot", text: "", sentAt: "2026-11-19T12:00:00Z", delivered: 1, location: null },
      ]) },
    });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    await fireEvent.press(await screen.findByTestId("snapshot-map"));
    expect(open).toHaveBeenCalledWith("https://www.openstreetmap.org/?mlat=55.67594&mlon=12.56553#map=17/55.67594/12.56553");
    expect(screen.getByText("Shared a location (no longer visible)")).toBeTruthy();
    expect(screen.getAllByTestId("snapshot-map")).toHaveLength(1);
  });
});
