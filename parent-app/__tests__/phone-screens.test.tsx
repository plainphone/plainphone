// SPDX-License-Identifier: Apache-2.0
//
// The phone screens (pairing, overview, the rule screens, household, invitations,
// approvals) through the real router, against a fake API.
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking as NativeLinking, Share } from "react-native";
import { clearPendingInvite } from "../src/lib/pendingInvite";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const SELF_ID = "22222222-2222-4222-8222-222222222222";
const SELF = { ...PHONE, id: SELF_ID, name: "Mine", profile: "self" };
const APPS = [
  { packageName: "com.android.dialer", label: "Phone", allowed: true, core: true },
  { packageName: "com.example.insta", label: "Instagram", allowed: false, core: false },
];
const FUTURE = new Date(Date.now() + 3 * 3_600_000).toISOString();

/** The routes every phone screen loads first. */
function phoneApi(phone: Omit<typeof PHONE, "lastSeenAt" | "pairedAt"> & { pairedAt: string | null; lastSeenAt: string | null; attestation?: unknown; status?: { lockIntact: boolean; failedPolicies: string[]; lateGoogleAccount?: boolean } } = PHONE, extra: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    "GET /me": { body: ME },
    [`GET /phones/${phone.id}`]: { body: phone },
    [`GET /phones/${phone.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${phone.id}/apps`]: { body: { apps: APPS } },
    ...extra,
  });
}
const at = (phone: { id: string }, section = "") => `/phones/${phone.id}${section ? `/${section}` : ""}`;

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("pairing", () => {
  it("saves the strong setup language before opening the QR flow in the browser", async () => {
    const open = jest.spyOn(NativeLinking, "openURL").mockResolvedValue(undefined);
    try {
      const api = phoneApi(PHONE, { "POST /phones/enroll": { status: 201, body: { phone: PHONE } } });
      await renderRouter(routes, { initialUrl: "/strong-setup" });
      await fireEvent.changeText(await screen.findByLabelText("Name"), "Test phone");
      await fireEvent.press(screen.getByRole("radio", { name: "Svenska" }));
      await fireEvent.press(screen.getByRole("button", { name: "Continue in the browser" }));
      await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(`/phones/${PHONE.id}/setup$`)));
      expect(api.calls.find((c) => c.path === "/phones/enroll")?.body).toEqual({ mode: "strong", language: "sv", name: "Test phone", profile: "child" });
    } finally {
      open.mockRestore();
    }
  });

  it("fills the code from a pairing link and adds the phone", async () => {
    const api = phoneApi(PHONE, { "POST /phones/claim": { status: 201, body: PHONE } });
    await renderRouter(routes, { initialUrl: "/pair?code=k7mp4qxr" });
    expect((await screen.findByTestId("pair-code")).props.value).toBe("K7MP-4QXR");
    // The name is required.
    await fireEvent.press(screen.getByTestId("pair-submit"));
    expect(await screen.findByText("Give the phone a name.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/phones/claim")).toBe(false);
    await fireEvent.changeText(screen.getByTestId("pair-name"), " Alma ");
    await fireEvent.press(screen.getByTestId("pair-submit"));
    await waitFor(() => expect(screen).toHavePathname(at(PHONE)));
    const claim = api.calls.find((c) => c.path === "/phones/claim")!;
    expect(claim.body).toMatchObject({ code: "K7MP-4QXR", name: "Alma", profile: "child" });
    expect(typeof (claim.body as { timezone: string }).timezone).toBe("string");
  });

  it("says when the code is unknown", async () => {
    phoneApi(PHONE, { "POST /phones/claim": { status: 404, body: { error: "code not found or expired" } } });
    await renderRouter(routes, { initialUrl: "/pair?code=K7MP4QXR" });
    await fireEvent.changeText(await screen.findByTestId("pair-name"), "Alma");
    await fireEvent.press(screen.getByTestId("pair-submit"));
    expect(await screen.findByText("That code was not found or has expired. Check the code on the phone.")).toBeTruthy();
  });

  it("offers to scan the code on a phone", async () => {
    phoneApi();
    await renderRouter(routes, { initialUrl: "/pair" });
    expect(await screen.findByTestId("scan-start")).toBeTruthy();
  });
});

describe("overview", () => {
  it("saves and shows the selected Plainphone language", async () => {
    const api = phoneApi(PHONE, {
      [`PATCH /phones/${PHONE.id}`]: { body: { ...PHONE, language: "de" } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    await fireEvent.press(await screen.findByRole("button", { name: /Plainphone language/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Deutsch" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Deutsch" })).toBeChecked());
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ language: "de" });
  });

  it.each(["strong", "light"] as const)("opens replacement setup in the browser for an unpaired %s phone", async (mode) => {
    const draft = { ...PHONE, mode, pairedAt: null, setupQrAvailable: true };
    phoneApi(draft, {
      [`PATCH /phones/${PHONE.id}`]: { body: { ...draft, language: "de", setupEnrollmentId: null } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    await fireEvent.press(await screen.findByRole("button", { name: /Plainphone language/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Deutsch" }));
    expect(await screen.findByText("Setup settings changed. If you already made a QR code, make a new one.")).toBeTruthy();
    const open = jest.spyOn(NativeLinking, "openURL").mockResolvedValue(undefined);
    try {
      await fireEvent.press(screen.getByRole("button", { name: "Continue in the browser" }));
      expect(open).toHaveBeenCalledWith(expect.stringMatching(`/phones/${PHONE.id}/setup$`));
    } finally {
      open.mockRestore();
    }
  });

  it("turns off the Android language lock on a strong Child phone", async () => {
    const child = { ...PHONE, mode: "strong" as const, profile: "child" as const, lockSystemLanguage: true };
    const api = phoneApi(child, {
      [`PATCH /phones/${PHONE.id}`]: { body: { ...child, lockSystemLanguage: false } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    const lock = () => screen.getByRole("switch", { name: "Lock Android language" });
    await screen.findByRole("switch", { name: "Lock Android language" });
    expect(lock()).toBeChecked();
    await fireEvent.press(lock());
    await waitFor(() => expect(lock()).not.toBeChecked());
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ lockSystemLanguage: false });
  });

  it("shows the system check's own date even after a newer phone sync", async () => {
    phoneApi({
      ...PHONE,
      lastSeenAt: new Date().toISOString(),
      attestation: {
        state: "verified", checkedAt: new Date(Date.now() - 3_600_000).toISOString(),
      },
    });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    expect(await screen.findByText("System checked 1 hour ago")).toBeTruthy();
  });

  it("shows the sections, with the key only on Self phones", async () => {
    phoneApi();
    await renderRouter(routes, { initialUrl: at(PHONE) });
    expect(await screen.findByTestId("section-apps")).toBeTruthy();
    expect(screen.getByTestId("section-location")).toBeTruthy();
    expect(screen.queryByTestId("section-key")).toBeNull();
    // Child phones have nothing waiting.
    expect(screen.queryByText("Waiting changes")).toBeNull();
  });

  it("shows the installation warning even when the lock is intact", async () => {
    phoneApi({ ...PHONE, status: { lockIntact: true, failedPolicies: ["install window overran: 42s"] } });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    expect(await screen.findByText("App installation stayed open longer than planned during an update.")).toBeTruthy();
    expect(screen.queryByText("42 seconds longer than planned.")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Show technical details" }));
    expect(screen.getByText("42 seconds longer than planned.")).toBeTruthy();
  });

  it("shows the account warning on its own with an intact lock and closed technical details", async () => {
    const failedPolicy = "restriction no_modify_accounts";
    phoneApi({ ...PHONE, status: { lockIntact: true, failedPolicies: [failedPolicy], lateGoogleAccount: true } });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    expect(await screen.findByText("An unexpected account change was detected during or after app installation")).toBeTruthy();
    expect(screen.queryByText("App installation stayed open longer than planned during an update.")).toBeNull();
    expect(screen.getByRole("button", { name: "Show technical details" })).toBeTruthy();
    expect(screen.queryByText(failedPolicy)).toBeNull();
  });

  it("lists waiting changes on a Self phone and cancels one", async () => {
    const api = phoneApi(SELF, {
      [`GET /phones/${SELF_ID}/changes`]: {
        body: { changes: [{ id: "c1", op: { type: "app.set", packageName: "com.example.insta", allowed: true }, keyType: "delay", effectiveAt: FUTURE }] },
      },
      "POST /changes/c1/cancel": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: at(SELF) });
    expect(await screen.findByText("Show Instagram")).toBeTruthy();
    expect(screen.getByTestId("section-key")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Cancel change: Show Instagram"));
    expect(await screen.findByText("The change was cancelled.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/changes/c1/cancel")).toBe(true);
  });

  it("renames the phone", async () => {
    const api = phoneApi(PHONE, { [`PATCH /phones/${PHONE.id}`]: { body: { ...PHONE, name: "Alma M" } } });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    await fireEvent.changeText(await screen.findByTestId("rename-name"), "  ");
    await fireEvent.press(screen.getByTestId("rename-save"));
    expect(await screen.findByText("Give the phone a name.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("rename-name"), "Alma M");
    await fireEvent.press(screen.getByTestId("rename-save"));
    expect(await screen.findByText("The phone is now called Alma M.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "Alma M" });
  });

  it("removes a Child phone after a confirmation and returns to the list", async () => {
    const api = phoneApi(PHONE, {
      [`DELETE /phones/${PHONE.id}`]: { body: { status: "applied" } },
      "GET /phones": { body: { phones: [] } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE) });
    await fireEvent.press(await screen.findByTestId("remove-phone"));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    await fireEvent.press(screen.getByTestId("remove-confirm"));
    await waitFor(() => expect(screen).toHavePathname("/"));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("keeps a Self phone's removal waiting for the key", async () => {
    phoneApi(SELF, {
      [`DELETE /phones/${SELF_ID}`]: {
        status: 202,
        body: { status: "pending", change: { id: "c2", op: { type: "phone.remove", dnsClientId: "d1" }, keyType: "delay", effectiveAt: FUTURE } },
      },
    });
    await renderRouter(routes, { initialUrl: at(SELF) });
    await fireEvent.press(await screen.findByTestId("remove-phone"));
    await fireEvent.press(screen.getByTestId("remove-confirm"));
    const banner = await screen.findByTestId("pending-banner");
    expect(banner).toBeTruthy();
    expect(screen.getByText(/Remove this phone from Plainphone\. This takes effect/)).toBeTruthy();
    expect(screen).toHavePathname(at(SELF));
  });
});

describe("apps", () => {
  it("shows or hides an app and says so", async () => {
    const api = phoneApi(PHONE, { [`PUT /phones/${PHONE.id}/apps/com.example.insta`]: { body: { status: "applied" } } });
    await renderRouter(routes, { initialUrl: at(PHONE, "apps") });
    await fireEvent.press(await screen.findByTestId("app-com.example.insta"));
    expect(await screen.findByText("Instagram is shown.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ allowed: true });
    // Core apps cannot be switched.
    expect(screen.getByTestId("app-com.android.dialer").props.accessibilityState.disabled).toBe(true);
  });

  it("explains a change that waits for the key, and cancels it", async () => {
    const api = phoneApi(SELF, {
      [`PUT /phones/${SELF_ID}/apps/com.example.insta`]: {
        status: 202,
        body: { status: "pending", change: { id: "c3", op: { type: "app.set", packageName: "com.example.insta", allowed: true }, keyType: "delay", effectiveAt: FUTURE } },
      },
      "POST /changes/c3/cancel": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: at(SELF, "apps") });
    await fireEvent.press(await screen.findByTestId("app-com.example.insta"));
    expect(await screen.findByText(/Show Instagram\. This takes effect/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Cancel change"));
    expect(await screen.findByText("The change was cancelled.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/changes/c3/cancel")).toBe(true);
  });
});

describe("contacts", () => {
  it("shows favourites for a Self phone", async () => {
    phoneApi(SELF, { [`GET /phones/${SELF.id}/contacts`]: { body: { contacts: [], selfScheduleContacts: false } } });
    await renderRouter(routes, { initialUrl: at(SELF, "contacts") });
    expect(await screen.findByText("Favourites")).toBeTruthy();
    expect(await screen.findByText(/No favourites yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add favourite" })).toBeTruthy();
  });

  it("reviews suggestions using the IDs from the displayed list", async () => {
    const path = `/phones/${PHONE.id}/contact-suggestions`;
    const alex = { id: "alex", name: "Alex", numbers: ["+4512345678", "+4512345679"] };
    const sam = { id: "sam", name: "Sam", numbers: ["+4512345680"] };
    let suggestions = [alex, sam];
    let contacts: { id: string; name: string; number: string }[] = [];
    const api = phoneApi(PHONE, {
      [`GET /phones/${PHONE.id}/contacts`]: () => ({ body: { contacts, suggestDeviceContacts: true } }),
      [`GET ${path}`]: () => ({ body: { suggestions } }),
      [`POST ${path}`]: ({ body }) => {
        if ((body as { action: string }).action === "reject") {
          suggestions = [alex];
        } else {
          suggestions = [];
          contacts = [{ id: "contact", name: "Alex", number: alex.numbers[0] }];
        }
        return { status: 204 };
      },
    });
    await renderRouter(routes, { initialUrl: at(PHONE, "contacts") });
    expect(await screen.findByText(alex.numbers[1])).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "Dismiss Sam" }));
    await waitFor(() => expect(screen.queryByText("Sam")).toBeNull());
    await fireEvent.press(screen.getByRole("button", { name: "Approve all" }));
    expect(await screen.findByText("No contacts to review.")).toBeTruthy();
    expect(await screen.findByTestId("contact-contact")).toBeTruthy();
    expect(api.calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([
      { action: "reject", id: "sam" },
      { action: "approveAll", suggestionIds: ["alex"] },
    ]);
  });

  it("checks the number, then adds the contact", async () => {
    const api = phoneApi(PHONE, {
      [`GET /phones/${PHONE.id}/contacts`]: { body: { contacts: [{ id: "k1", name: "Mum", number: "+4512345678" }] } },
      [`POST /phones/${PHONE.id}/contacts`]: { body: { status: "applied" } },
      [`DELETE /phones/${PHONE.id}/contacts/k1`]: { body: { status: "applied" } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE, "contacts") });
    expect(await screen.findByText("Mum")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("contact-name"), "Dad");
    await fireEvent.changeText(screen.getByTestId("contact-number"), "12345678");
    await fireEvent.press(screen.getByTestId("contact-add"));
    expect(await screen.findByText(/Use international format with country code/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    await fireEvent.changeText(screen.getByTestId("contact-number"), "+45 12 34 56 79");
    await fireEvent.press(screen.getByTestId("contact-add"));
    expect(await screen.findByText("Dad was added.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Dad", number: "+4512345679" });
    await fireEvent.press(screen.getByLabelText("Remove Mum"));
    expect(await screen.findByText("The contact was removed.")).toBeTruthy();
  });
});

describe("web filter", () => {
  it("keeps the filter limits available when the DNS settings fail to load", async () => {
    phoneApi(PHONE, { [`GET /phones/${PHONE.id}/dns`]: { status: 503, body: {} } });
    await renderRouter(routes, { initialUrl: at(PHONE, "filter") });
    expect(await screen.findByText("Try again")).toBeTruthy();
    const limits = "Useful sites can also be blocked. Helplines and selected health information sites are always available.";
    expect(screen.queryByText(limits)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "What the filter can and can’t do" }));
    expect(screen.getByText(limits)).toBeTruthy();
    expect(screen.queryByTestId("category-social")).toBeNull();
  });

  it("switches a category and adds a website in its clean form", async () => {
    const dns = { host: "abc.dns.plainphone.org", synced: true, blockedCategories: ["social"], allowDomains: [], blockDomains: ["bad.example"] };
    const api = phoneApi(PHONE, {
      [`GET /phones/${PHONE.id}/dns`]: { body: dns },
      [`PUT /phones/${PHONE.id}/dns/categories/adult`]: { body: { status: "applied" } },
      [`POST /phones/${PHONE.id}/dns/allow`]: { body: { status: "applied" } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE, "filter") });
    expect(await screen.findByText("bad.example")).toBeTruthy();
    expect(screen.getByTestId("category-social").props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByTestId("category-adult"));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ blocked: true });
    await fireEvent.changeText(screen.getByTestId("allow-domain"), "not a domain");
    await fireEvent.press(screen.getByTestId("allow-add"));
    expect(await screen.findByText("Write a website address like example.com.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("allow-domain"), "https://School.Example.com/path");
    await fireEvent.press(screen.getByTestId("allow-add"));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ domain: "school.example.com" });
  });
});

describe("school time and bedtime", () => {
  it("validates the times and saves a schedule", async () => {
    const api = phoneApi(PHONE, {
      [`GET /phones/${PHONE.id}/schedules`]: { body: { schedules: [] } },
      [`POST /phones/${PHONE.id}/schedules`]: { body: { status: "applied" } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE, "schedules") });
    await fireEvent.press(await screen.findByTestId("sched-add"));
    await fireEvent.changeText(screen.getByTestId("sched-start"), "25:00");
    await fireEvent.press(screen.getByTestId("sched-save"));
    expect(await screen.findByText("Write a time like 08:00.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("sched-start"), "08:00");
    await fireEvent.changeText(screen.getByTestId("sched-end"), "08:00");
    await fireEvent.press(screen.getByTestId("sched-save"));
    expect(await screen.findByText("Start and end must be different.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    await fireEvent.changeText(screen.getByTestId("sched-end"), "15:30");
    // Days are checkboxes: drop Friday, add Saturday.
    expect(screen.getByTestId("day-5").props.accessibilityRole).toBe("checkbox");
    await fireEvent.press(screen.getByTestId("day-5"));
    await fireEvent.press(screen.getByTestId("day-6"));
    await fireEvent.press(screen.getByTestId("allow-com.example.insta"));
    await fireEvent.press(screen.getByTestId("sched-save"));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      kind: "school",
      days: [1, 2, 3, 4, 6],
      startMinute: 480,
      endMinute: 930,
      allowedPackages: ["com.example.insta"],
    });
  });

  it("lists a schedule and deletes it after a confirmation", async () => {
    const api = phoneApi(PHONE, {
      [`GET /phones/${PHONE.id}/schedules`]: {
        body: { schedules: [{ id: "s1", kind: "bedtime", days: [1, 2, 3, 4, 5, 6, 7], startMinute: 1260, endMinute: 420, allowedPackages: [] }] },
      },
      [`DELETE /phones/${PHONE.id}/schedules/s1`]: { body: { status: "applied" } },
    });
    await renderRouter(routes, { initialUrl: at(PHONE, "schedules") });
    expect(await screen.findByText(/Every day, 21:00 to 07:00 \(ends the next day\)/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Delete: Bedtime/));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    await fireEvent.press(screen.getByText("Yes, delete"));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("key", () => {
  const key = {
    keyType: "delay",
    delayHours: 24,
    trustedEmail: null,
    payUnlockEnabled: false,
    payUnlockAmount: 500,
    payUnlockRecipient: "plainphone",
    trustedAccepted: false,
    payUnlockCurrency: "DKK",
  };

  it("checks the delay, then saves the key and sends the pay-to-unlock values back unchanged", async () => {
    const api = phoneApi(SELF, {
      [`GET /phones/${SELF_ID}/key`]: { body: key },
      [`PUT /phones/${SELF_ID}/key`]: { body: { status: "applied" } },
    });
    await renderRouter(routes, { initialUrl: at(SELF, "key") });
    await fireEvent.changeText(await screen.findByTestId("key-hours"), "99");
    await fireEvent.press(screen.getByTestId("key-save"));
    expect(await screen.findByText("Choose a number from 1 to 72.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    await fireEvent.changeText(screen.getByTestId("key-hours"), "48");
    await fireEvent.press(screen.getByTestId("key-save"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      keyType: "delay",
      delayHours: 48,
      trustedEmail: null,
      payUnlockEnabled: false,
      payUnlockAmount: 500,
      payUnlockRecipient: "plainphone",
    });
  });

  it("is not for Child phones", async () => {
    phoneApi();
    await renderRouter(routes, { initialUrl: at(PHONE, "key") });
    await waitFor(() => expect(screen).toHavePathname(at(PHONE)));
  });
});

describe("approvals", () => {
  it("approves a change that waits for you", async () => {
    const api = phoneApi(PHONE, {
      "GET /approvals": {
        body: {
          approvals: [
            ...[30, 60].map((minutes, index) => ({
              id: `a${index + 1}`,
              phoneName: "Mine",
              requestedBy: "friend@example.org",
              summary: { en: `Instagram: 15 → ${minutes} min a day`, da: `Instagram: 15 → ${minutes} min om dagen` },
              revision: String(minutes).padStart(64, "0"),
              createdAt: new Date().toISOString(),
            })),
          ],
        },
      },
      "POST /changes/a1/approve": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/approvals" });
    expect(await screen.findByText("Instagram: 15 → 30 min a day")).toBeTruthy();
    expect(screen.getByText("Instagram: 15 → 60 min a day")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Approve: Instagram: 15 → 30 min a day"));
    expect(await screen.findByText("Approved. Takes effect the next time the phone is online (usually within a minute).")).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/changes/a1/approve")?.body)
      .toEqual({ revision: "30".padStart(64, "0") });
  });
});

describe("household", () => {
  it("warns before resetting with a pending account and confirms before removing it", async () => {
    const path = `/households/${ME.households[0].id}/reset-protection`;
    const api = fakeApi({
      "GET /me": { body: ME },
      [`GET /households/${ME.households[0].id}/members`]: { body: { members: [], invites: [] } },
      [`GET ${path}`]: { body: { available: true, accounts: [{ userId: "u1", mine: true, activeFrom: FUTURE }] } },
      [`DELETE ${path}/mine`]: { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/household" });
    expect(await screen.findByText(/A new Google account can take up to 72 hours/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("frp-remove"));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    await fireEvent.press(screen.getByText("Cancel"));
    expect(screen.queryByTestId("frp-remove-confirm")).toBeNull();
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    await fireEvent.press(screen.getByTestId("frp-remove"));
    await fireEvent.press(screen.getByTestId("frp-remove-confirm"));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "DELETE")?.path).toBe(`${path}/mine`);
  });

  it("invites another parent and hands over the link when the server cannot send mail", async () => {
    const hid = ME.households[0].id;
    const url = "https://app.plainphone.org/invite#token=pp_i_abcdefghij";
    const api = phoneApi(PHONE, {
      [`GET /households/${hid}/members`]: { body: { members: [{ id: "u1", email: "parent@example.org", role: "owner" }], invites: [] } },
      [`POST /households/${hid}/invites`]: { status: 201, body: { id: "i1", email: "other@example.org", expiresAt: FUTURE, mailed: false, url } },
    });
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction", activityType: undefined });
    await renderRouter(routes, { initialUrl: "/household" });
    expect(await screen.findByText("parent@example.org (you)")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("invite-email"), "nope");
    await fireEvent.press(screen.getByTestId("invite-send"));
    expect(await screen.findByText("Enter a valid email address, like name@example.com.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("invite-email"), "other@example.org");
    await fireEvent.press(screen.getByTestId("invite-send"));
    expect(await screen.findByText(url)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ email: "other@example.org", locale: "en" });
    await fireEvent.press(screen.getByTestId("invite-share"));
    expect(share).toHaveBeenCalledWith({ message: url });
    share.mockRestore();
  });
});

describe("invitations", () => {
  const link = "https://app.plainphone.org/invite#token=pp_i_abcdefghij";

  it("accepts the invitation when you are logged in", async () => {
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(link);
    const api = phoneApi(PHONE, { "POST /invites/accept": { body: { ok: true } }, "GET /phones": { body: { phones: [] } } });
    await renderRouter(routes, { initialUrl: "/invite" });
    expect(await screen.findByText("You are now part of the household and can manage its phones.")).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/invites/accept")!.body).toEqual({ token: "pp_i_abcdefghij" });
    await fireEvent.press(screen.getByTestId("invite-done"));
    await waitFor(() => expect(screen).toHavePathname("/"));
  });

  it("keeps the token while you log in", async () => {
    await SecureStore.deleteItemAsync("pp.session");
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(link);
    fakeApi({ "GET /health": { body: { ok: true, mail: "smtp" } } });
    await renderRouter(routes, { initialUrl: "/invite" });
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(await screen.findByText("Log in to accept the invitation to a household.")).toBeTruthy();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("pp.invite", "pp_i_abcdefghij");
  });

  it("accepts the kept invitation when the app comes back after login", async () => {
    // The app was closed during the mail round trip: nothing in memory, the token in the keychain.
    await clearPendingInvite();
    await SecureStore.setItemAsync("pp.invite", "pp_i_keptinvite1");
    const api = phoneApi(PHONE, { "POST /invites/accept": { body: { ok: true } } });
    await renderRouter(routes, { initialUrl: "/invite" });
    expect(await screen.findByText("You are now part of the household and can manage its phones.")).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/invites/accept")!.body).toEqual({ token: "pp_i_keptinvite1" });
    // Used or failed: forgotten.
    await waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("pp.invite"));
  });

  it("does not take the login link for an invitation", async () => {
    (Linking.useLinkingURL as jest.Mock).mockReturnValue("https://app.plainphone.org/auth/app#token=pp_m_loginlink123");
    const api = phoneApi();
    await renderRouter(routes, { initialUrl: "/invite" });
    expect(await screen.findByText("Open the invitation link you were sent.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/invites/accept")).toBe(false);
    (Linking.useLinkingURL as jest.Mock).mockReturnValue(null);
  });

  it("says when the invitation is used up", async () => {
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce("https://app.plainphone.org/invite#token=pp_i_usedinvite1");
    phoneApi(PHONE, { "POST /invites/accept": { status: 400, body: { error: "invalid or expired invitation" } } });
    await renderRouter(routes, { initialUrl: "/invite" });
    expect(await screen.findByText("This invitation is expired or already used. Ask for a new one.")).toBeTruthy();
  });
});
