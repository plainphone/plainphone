// SPDX-License-Identifier: Apache-2.0
//
// The Modes screen and the contact group picker (docs/modes.md), through the real router against a
// fake API. Nothing here depends on the date: "now" comes from the server's `current`.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const P = `/phones/${PHONE.id}`;
const APPS = [
  { packageName: "com.android.dialer", label: "Phone", allowed: true, core: true },
  { packageName: "com.example.maps", label: "Maps", allowed: true, core: false },
];
const FREE = { id: "m-free", preset: "free", name: null, allApps: true, allowedPackages: [], contactGroups: ["family", "friends", "others"], quiet: false, isDefault: true };
const SCHOOL = { id: "m-school", preset: "school", name: null, allApps: false, allowedPackages: ["com.example.maps"], contactGroups: ["family"], quiet: false, isDefault: false };
const NIGHT = { id: "m-night", preset: "night", name: "Sleep", allApps: true, allowedPackages: [], contactGroups: [], quiet: true, isDefault: false };
const SLOT = { id: "s1", modeId: "m-school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 840 };

function modesBody(patch: Record<string, unknown> = {}) {
  return {
    enabled: true,
    parentsMarked: true,
    timezone: "Europe/Copenhagen",
    modes: [FREE, SCHOOL, NIGHT],
    slots: [SLOT],
    current: { modeId: "m-school", until: "14:00" },
    ...patch,
  };
}

function serve(phone: Record<string, unknown>, extra: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    "GET /me": { body: ME },
    [`GET ${P}`]: { body: phone },
    [`GET ${P}/changes`]: { body: { changes: [] } },
    [`GET ${P}/apps`]: { body: { apps: APPS } },
    [`GET ${P}/sos`]: { body: { events: [], callbackNumber: null } },
    ...extra,
  });
}

const sent = (api: ReturnType<typeof fakeApi>, method: string) => api.calls.filter((c) => c.method === method);

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("modes screen", () => {
  it("shows only the switch while modes are off, and turns them on with a PATCH", async () => {
    const api = serve({ ...PHONE, modesEnabled: false }, { [`PATCH ${P}`]: { body: { ...PHONE, modesEnabled: true } }, [`GET ${P}/modes`]: { body: modesBody() } });
    await renderRouter(routes, { initialUrl: `${P}/modes` });
    const sw = await screen.findByRole("switch", { name: "Use modes" });
    expect(sw.props.accessibilityState.checked).toBe(false);
    expect(screen.queryByText("Add a mode")).toBeNull();
    expect(screen.queryByText("Weekly plan")).toBeNull();
    expect(api.calls.some((c) => c.path === `${P}/modes`)).toBe(false);
    await fireEvent.press(sw);
    await waitFor(() => expect(sent(api, "PATCH")[0]?.body).toEqual({ modesEnabled: true }));
    expect(await screen.findByText("Add a mode")).toBeTruthy();
  });

  it("lists the modes with a summary and says which mode is on now", async () => {
    serve({ ...PHONE, modesEnabled: true }, { [`GET ${P}/modes`]: { body: modesBody({ parentsMarked: false }) } });
    await renderRouter(routes, { initialUrl: `${P}/modes` });
    expect(await screen.findByText("Now: School until 14:00")).toBeTruthy();
    expect(screen.getByText("1 app, Family can call")).toBeTruthy();
    expect(screen.getByText("Sleep")).toBeTruthy();
    expect(screen.getByText("All apps, Only parents can call, Quiet")).toBeTruthy();
    // No parent is marked: the notice links to Contacts.
    expect(screen.getByText(/No contact is marked as a parent/)).toBeTruthy();
    expect(screen.getByTestId("modes-to-contacts")).toBeTruthy();
  });

  it("edits the default mode's name only", async () => {
    const api = serve({ ...PHONE, modesEnabled: true }, { [`GET ${P}/modes`]: { body: modesBody() }, [`PUT ${P}/modes/m-free`]: { body: { ...FREE, name: "Weekend" } } });
    await renderRouter(routes, { initialUrl: `${P}/modes` });
    await fireEvent.press(await screen.findByTestId("mode-edit-m-free"));
    expect(screen.getByText("The phone's normal rules. Only the name can change.")).toBeTruthy();
    expect(screen.queryByTestId("mode-apps")).toBeNull();
    expect(screen.queryByTestId("mode-group-family")).toBeNull();
    expect(screen.queryByTestId("mode-quiet")).toBeNull();
    expect(screen.queryByTestId("mode-delete")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("mode-name"), "Weekend");
    await fireEvent.press(screen.getByTestId("mode-save"));
    await waitFor(() => expect(sent(api, "PUT")).toHaveLength(1));
    expect(sent(api, "PUT")[0]).toEqual(expect.objectContaining({ path: `${P}/modes/m-free`, body: { name: "Weekend" } }));
  });

  it("creates a mode with chosen apps and groups", async () => {
    const api = serve({ ...PHONE, modesEnabled: true }, { [`GET ${P}/modes`]: { body: modesBody() }, [`POST ${P}/modes`]: { status: 201, body: { ...SCHOOL, id: "m-new" } } });
    await renderRouter(routes, { initialUrl: `${P}/modes` });
    await fireEvent.press(await screen.findByTestId("mode-add"));
    await fireEvent.changeText(screen.getByTestId("mode-name"), "Homework");
    await fireEvent.press(screen.getByTestId("mode-apps-some"));
    await fireEvent.press(screen.getByTestId("mode-app-com.example.maps"));
    await fireEvent.press(screen.getByTestId("mode-group-friends"));
    await fireEvent.press(screen.getByTestId("mode-save"));
    await waitFor(() => expect(sent(api, "POST")).toHaveLength(1));
    expect(sent(api, "POST")[0]!.body).toEqual({
      preset: "custom",
      name: "Homework",
      allApps: false,
      allowedPackages: ["com.example.maps"],
      contactGroups: ["family", "friends"],
      quiet: false,
    });
  });

  it("refuses an overlapping plan before sending it", async () => {
    const api = serve({ ...PHONE, modesEnabled: true }, { [`GET ${P}/modes`]: { body: modesBody() }, [`PUT ${P}/mode-schedule`]: { body: { slots: [] } } });
    await renderRouter(routes, { initialUrl: `${P}/modes` });
    await fireEvent.press(await screen.findByTestId("slot-add"));
    await fireEvent.press(screen.getByTestId("slot-mode-m-night"));
    await fireEvent.changeText(screen.getByTestId("slot-start"), "13:00");
    await fireEvent.changeText(screen.getByTestId("slot-end"), "15:00");
    await fireEvent.press(screen.getByTestId("slot-done"));
    expect(await screen.findByText("Two times on the plan overlap. Change one of them.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("plan-save"));
    expect(sent(api, "PUT")).toHaveLength(0);
  });

  it("saves a plan and shows the overlap message when the server answers overlap", async () => {
    let answer: { status: number; body: unknown } = { status: 400, body: { error: "overlap" } };
    const api = serve({ ...PHONE, modesEnabled: true }, { [`GET ${P}/modes`]: { body: modesBody() }, [`PUT ${P}/mode-schedule`]: () => answer });
    await renderRouter(routes, { initialUrl: `${P}/modes` });
    await fireEvent.press(await screen.findByTestId("slot-add"));
    await fireEvent.press(screen.getByTestId("slot-mode-m-night"));
    await fireEvent.press(screen.getByTestId("slot-day-6"));
    await fireEvent.press(screen.getByTestId("slot-day-1"));
    await fireEvent.press(screen.getByTestId("slot-day-2"));
    await fireEvent.press(screen.getByTestId("slot-day-3"));
    await fireEvent.press(screen.getByTestId("slot-day-4"));
    await fireEvent.press(screen.getByTestId("slot-day-5"));
    await fireEvent.changeText(screen.getByTestId("slot-start"), "21:00");
    await fireEvent.changeText(screen.getByTestId("slot-end"), "07:00");
    await fireEvent.press(screen.getByTestId("slot-done"));
    expect(screen.queryByText("Two times on the plan overlap. Change one of them.")).toBeNull();
    await fireEvent.press(screen.getByTestId("plan-save"));
    expect(await screen.findByText("Two times on the plan overlap. Change one of them.")).toBeTruthy();
    answer = { status: 200, body: { slots: [] } };
    await fireEvent.press(screen.getByTestId("plan-save"));
    await waitFor(() => expect(sent(api, "PUT")).toHaveLength(2));
    expect(sent(api, "PUT")[1]!.body).toEqual({
      slots: [
        { modeId: "m-school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 840 },
        { modeId: "m-night", days: [6], startMinute: 1260, endMinute: 420 },
      ],
    });
    expect(await screen.findByText("Saved. The phone gets it the next time it is online.")).toBeTruthy();
  });
});

describe("contact groups", () => {
  const contacts = [
    { id: "c1", name: "Grandma", number: "+4511111111", group: "others", sosParent: false },
    { id: "c2", name: "Mum", number: "+4522222222", group: "family", sosParent: true },
  ];

  it("moves a contact to another group and keeps a parent in Family", async () => {
    const api = serve(PHONE, {
      [`GET ${P}/contacts`]: { body: { contacts } },
      [`PATCH ${P}/contacts/c1`]: { body: { ...contacts[0], group: "friends" } },
    });
    await renderRouter(routes, { initialUrl: `${P}/contacts` });
    expect(await screen.findByText("Modes can let some groups call and not others.")).toBeTruthy();
    expect(screen.getByTestId("group-c1-others").props.accessibilityState.checked).toBe(true);
    // A parent has no picker, only the fixed note.
    expect(screen.queryByTestId("group-c2")).toBeNull();
    expect(screen.getByText("Parents are always in Family.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("group-c1-friends"));
    await waitFor(() => expect(sent(api, "PATCH")).toHaveLength(1));
    expect(sent(api, "PATCH")[0]).toEqual(expect.objectContaining({ path: `${P}/contacts/c1`, body: { group: "friends" } }));
    await waitFor(() => expect(screen.getByTestId("group-c1-friends").props.accessibilityState.checked).toBe(true));
  });
});
