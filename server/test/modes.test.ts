// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phones } from "../src/db/schema.js";
import { overlaps } from "../src/services/modes.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

// The harness clock is pinned to Monday 2026-11-16 12:00 UTC: 13:00 in Copenhagen.
const h = useHarness();

async function setup(profile: "child" | "self" = "child") {
  const mum = await signIn(h, "mum@example.org");
  const { phoneId, device } = await pairPhone(h, mum, { name: "Alma", profile });
  await h.ctx.db.update(phones).set({ openMode: false }).where(eq(phones.id, phoneId));
  await device.put("/api/device/apps", {
    apps: [
      { packageName: "com.android.dialer", label: "Phone", core: true },
      { packageName: "com.example.maths", label: "Maths" },
      { packageName: "com.example.game", label: "Game" },
    ],
  });
  for (const pkg of ["com.example.maths", "com.example.game"]) {
    await mum.put(`/api/phones/${phoneId}/apps/${pkg}`, { allowed: true });
  }
  return { mum, phoneId, device };
}

async function addContact(mum: Client, phoneId: string, name: string, number: string) {
  await mum.post(`/api/phones/${phoneId}/contacts`, { name, number });
  const list = (await mum.get(`/api/phones/${phoneId}/contacts`)).json.contacts as { id: string; number: string }[];
  return list.find((c) => c.number === number)!.id;
}

const rules = async (device: Client) => (await device.get("/api/device/rules")).json;
const windowShape = (w: Record<string, unknown>) => ({ kind: w.kind, days: w.days, start: w.start, end: w.end, allowedPackages: w.allowedPackages });

describe("modes: the switch", () => {
  it("is off by default and leaves the rules document as it was", async () => {
    const { mum, phoneId, device } = await setup();
    await addContact(mum, phoneId, "Gran", "+4512345678");
    expect((await mum.get(`/api/phones/${phoneId}`)).json.modesEnabled).toBe(false);
    const doc = await rules(device);
    expect(doc.modes).toBeUndefined();
    expect(doc.contacts).toEqual([{ name: "Gran", number: "+4512345678" }]);
    expect((await mum.get(`/api/phones/${phoneId}/modes`)).json).toMatchObject({ enabled: false, modes: [], slots: [], current: null });
  });

  it("turning it on makes modes from school time and bedtime without changing what the phone does", async () => {
    const { mum, phoneId, device } = await setup();
    await mum.post(`/api/phones/${phoneId}/schedules`, {
      kind: "school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 840, allowedPackages: ["com.example.maths"],
    });
    await mum.post(`/api/phones/${phoneId}/schedules`, { kind: "bedtime", days: [1, 2, 3, 4, 5, 6, 7], startMinute: 1260, endMinute: 420 });
    const before = await rules(device);

    const res = await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true });
    expect(res.status).toBe(200);
    expect(res.json.modesEnabled).toBe(true);
    const after = await rules(device);
    expect(after.rulesRevision).toBeGreaterThan(before.rulesRevision);
    expect(after.schedules.map(windowShape)).toEqual(before.schedules.map(windowShape));
    expect(after.modes.enabled).toBe(true);

    const view = (await mum.get(`/api/phones/${phoneId}/modes`)).json;
    expect(view.modes.map((m: { preset: string }) => m.preset)).toEqual(["free", "school", "night", "homework"]);
    const school = view.modes.find((m: { preset: string }) => m.preset === "school");
    expect(school).toMatchObject({ allApps: false, allowedPackages: ["com.example.maths"], contactGroups: ["family", "friends", "others"], quiet: false });
    expect(view.modes.find((m: { preset: string }) => m.preset === "night")).toMatchObject({ quiet: true, contactGroups: ["family", "friends", "others"] });
    expect(view.modes[0]).toMatchObject({ isDefault: true, allApps: true });
    expect(view.slots).toHaveLength(2);
    // Monday 13:00 in Copenhagen: school until 14:00.
    expect(view.current).toEqual({ modeId: school.id, until: "14:00" });
  });

  it("turning it off brings back the old windows, and on again does not make the modes twice", async () => {
    const { mum, phoneId, device } = await setup();
    await mum.post(`/api/phones/${phoneId}/schedules`, { kind: "school", days: [1], startMinute: 480, endMinute: 840 });
    const before = await rules(device);
    await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true });
    await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: false });
    const off = await rules(device);
    expect(off.modes).toBeUndefined();
    expect(off.schedules).toEqual(before.schedules);
    await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true });
    expect((await mum.get(`/api/phones/${phoneId}/modes`)).json.modes).toHaveLength(4);
  });

  it("still makes the modes from school time when a mode was added through the API while modes were off", async () => {
    const { mum, phoneId, device } = await setup();
    await mum.post(`/api/phones/${phoneId}/schedules`, { kind: "school", days: [1], startMinute: 480, endMinute: 840 });
    const before = await rules(device);
    expect((await mum.post(`/api/phones/${phoneId}/modes`, { preset: "custom", allApps: true, contactGroups: [] })).status).toBe(201);
    await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true });
    const view = (await mum.get(`/api/phones/${phoneId}/modes`)).json;
    expect(view.modes.filter((m: { isDefault: boolean }) => m.isDefault)).toHaveLength(1);
    expect((await rules(device)).schedules.map(windowShape)).toEqual(before.schedules.map(windowShape));
  });

  it("does not switch modes when the same request has a bad time zone", async () => {
    const { mum, phoneId } = await setup();
    expect((await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true, timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await mum.get(`/api/phones/${phoneId}`)).json.modesEnabled).toBe(false);
  });

  it("is only for child phones", async () => {
    const { mum, phoneId } = await setup("self");
    expect((await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true })).status).toBe(409);
    expect((await mum.get(`/api/phones/${phoneId}/modes`)).status).toBe(404);
    expect((await mum.put(`/api/phones/${phoneId}/mode-schedule`, { slots: [] })).status).toBe(404);
  });

  it("keeps other households out", async () => {
    const { mum, phoneId } = await setup();
    await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true });
    const modeId = (await mum.get(`/api/phones/${phoneId}/modes`)).json.modes[1].id as string;
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get(`/api/phones/${phoneId}/modes`)).status).toBe(404);
    expect((await stranger.patch(`/api/phones/${phoneId}`, { modesEnabled: false })).status).toBe(404);
    expect((await stranger.put(`/api/phones/${phoneId}/modes/${modeId}`, { name: "x" })).status).toBe(404);
    expect((await stranger.del(`/api/phones/${phoneId}/modes/${modeId}`)).status).toBe(404);
    expect((await stranger.put(`/api/phones/${phoneId}/mode-schedule`, { slots: [] })).status).toBe(404);
    // A mode of another phone cannot be scheduled on this one.
    const other = await pairPhone(h, stranger, { name: "Bo", profile: "child" });
    await stranger.patch(`/api/phones/${other.phoneId}`, { modesEnabled: true });
    expect((await stranger.put(`/api/phones/${other.phoneId}/mode-schedule`, {
      slots: [{ modeId, days: [1], startMinute: 60, endMinute: 120 }],
    })).status).toBe(400);
  });
});

describe("modes: editing", () => {
  async function withModes() {
    const s = await setup();
    await s.mum.patch(`/api/phones/${s.phoneId}`, { modesEnabled: true });
    const view = (await s.mum.get(`/api/phones/${s.phoneId}/modes`)).json;
    const byPreset = (p: string) => view.modes.find((m: { preset: string }) => m.preset === p) as { id: string };
    return { ...s, free: byPreset("free"), school: byPreset("school"), homework: byPreset("homework"), night: byPreset("night") };
  }

  it("puts slots on the schedule and turns them into windows the old phone app understands", async () => {
    const { mum, phoneId, device, school, homework, night } = await withModes();
    await mum.put(`/api/phones/${phoneId}/modes/${homework.id}`, {
      preset: "homework", allApps: true, contactGroups: ["family"],
    });
    await mum.put(`/api/phones/${phoneId}/modes/${night.id}`, {
      preset: "night", allApps: true, contactGroups: ["family"], quiet: true,
    });
    await mum.put(`/api/phones/${phoneId}/modes/${school.id}`, {
      preset: "school", name: "Skole", allApps: false, allowedPackages: ["com.example.maths"], contactGroups: ["family", "friends"],
    });
    const res = await mum.put(`/api/phones/${phoneId}/mode-schedule`, {
      slots: [
        { modeId: school.id, days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 840 },
        { modeId: homework.id, days: [1, 2, 3, 4], startMinute: 960, endMinute: 1020 },
        { modeId: night.id, days: [7, 1, 2, 3, 4], startMinute: 1260, endMinute: 420 },
      ],
    });
    expect(res.status).toBe(200);
    const doc = await rules(device);
    // Homework allows every app and is not quiet: no window, only a mode.
    expect(doc.schedules.map(windowShape)).toEqual([
      { kind: "school", days: [1, 2, 3, 4, 5], start: "08:00", end: "14:00", allowedPackages: ["com.example.maths"] },
      { kind: "bedtime", days: [1, 2, 3, 4, 7], start: "21:00", end: "07:00", allowedPackages: ["com.android.dialer", "com.example.game", "com.example.maths"] },
    ]);
    expect(doc.modes.slots).toHaveLength(3);
    expect(doc.modes.list.find((m: { id: string }) => m.id === school.id)).toMatchObject({
      preset: "school", name: "Skole", contactGroups: ["family", "friends"],
    });
  });

  it("refuses overlapping slots and slots of the default mode", async () => {
    const { mum, phoneId, school, homework, free } = await withModes();
    const overlap = await mum.put(`/api/phones/${phoneId}/mode-schedule`, {
      slots: [
        { modeId: school.id, days: [1], startMinute: 480, endMinute: 840 },
        { modeId: homework.id, days: [1], startMinute: 800, endMinute: 900 },
      ],
    });
    expect(overlap.status).toBe(400);
    // Across midnight into the next day counts too.
    expect((await mum.put(`/api/phones/${phoneId}/mode-schedule`, {
      slots: [
        { modeId: school.id, days: [7], startMinute: 1260, endMinute: 60 },
        { modeId: homework.id, days: [1], startMinute: 0, endMinute: 30 },
      ],
    })).status).toBe(400);
    expect((await mum.put(`/api/phones/${phoneId}/mode-schedule`, {
      slots: [{ modeId: free.id, days: [1], startMinute: 480, endMinute: 840 }],
    })).status).toBe(400);
    expect((await mum.put(`/api/phones/${phoneId}/mode-schedule`, {
      slots: [{ modeId: school.id, days: [1], startMinute: 480, endMinute: 480 }],
    })).status).toBe(400);
  });

  it("keeps the default mode: only its name changes and it cannot be deleted", async () => {
    const { mum, phoneId, device, free } = await withModes();
    expect((await mum.del(`/api/phones/${phoneId}/modes/${free.id}`)).status).toBe(409);
    expect((await mum.put(`/api/phones/${phoneId}/modes/${free.id}`, { preset: "free", allApps: false, contactGroups: [] })).status).toBe(400);
    const renamed = await mum.put(`/api/phones/${phoneId}/modes/${free.id}`, { name: "Fri" });
    expect(renamed.json).toMatchObject({ name: "Fri", allApps: true, isDefault: true });
    expect((await rules(device)).modes).toMatchObject({ defaultModeId: free.id });
  });

  it("adds and deletes a mode, and deleting it takes its slots", async () => {
    const { mum, phoneId, device } = await withModes();
    const created = await mum.post(`/api/phones/${phoneId}/modes`, {
      preset: "custom", name: "Football", allApps: false, allowedPackages: ["com.example.game", "com.example.game"], contactGroups: ["friends", "family"],
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ allowedPackages: ["com.example.game"], contactGroups: ["family", "friends"], quiet: false });
    await mum.put(`/api/phones/${phoneId}/mode-schedule`, {
      slots: [{ modeId: created.json.id, days: [3], startMinute: 1020, endMinute: 1140 }],
    });
    expect((await rules(device)).schedules).toHaveLength(1);
    expect((await mum.del(`/api/phones/${phoneId}/modes/${created.json.id}`)).status).toBe(204);
    expect((await rules(device)).schedules).toEqual([]);
    expect((await mum.get(`/api/phones/${phoneId}/modes`)).json.slots).toEqual([]);
    expect((await mum.post(`/api/phones/${phoneId}/modes`, { preset: "custom", allApps: true, contactGroups: ["enemies"] })).status).toBe(400);
  });
});

describe("contact groups", () => {
  it("start in Others, parents are always Family, and the phone sees groups only with modes on", async () => {
    const { mum, phoneId, device } = await setup();
    const gran = await addContact(mum, phoneId, "Gran", "+4512345678");
    const dad = await addContact(mum, phoneId, "Dad", "+4587654321");
    let list = (await mum.get(`/api/phones/${phoneId}/contacts`)).json.contacts;
    expect(list.map((c: { group: string }) => c.group)).toEqual(["others", "others"]);

    const moved = await mum.patch(`/api/phones/${phoneId}/contacts/${gran}`, { group: "family" });
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ id: gran, group: "family" });
    expect((await mum.patch(`/api/phones/${phoneId}/contacts/${gran}`, { group: "cousins" })).status).toBe(400);

    await mum.put(`/api/phones/${phoneId}/contacts/${dad}/sos-parent`, { enabled: true });
    list = (await mum.get(`/api/phones/${phoneId}/contacts`)).json.contacts;
    expect(list.find((c: { id: string }) => c.id === dad)).toMatchObject({ group: "family", sosParent: true });
    expect((await mum.patch(`/api/phones/${phoneId}/contacts/${dad}`, { group: "others" })).status).toBe(400);

    expect((await rules(device)).contacts[0].group).toBeUndefined();
    await mum.patch(`/api/phones/${phoneId}`, { modesEnabled: true });
    expect((await rules(device)).contacts).toEqual([
      { name: "Dad", number: "+4587654321", group: "family" },
      { name: "Gran", number: "+4512345678", group: "family" },
    ]);
    expect((await mum.get(`/api/phones/${phoneId}/modes`)).json.parentsMarked).toBe(true);
  });

  it("keep other households out", async () => {
    const { mum, phoneId } = await setup();
    const gran = await addContact(mum, phoneId, "Gran", "+4512345678");
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.patch(`/api/phones/${phoneId}/contacts/${gran}`, { group: "family" })).status).toBe(404);
  });
});

describe("overlaps", () => {
  it("finds shared minutes, also across midnight and the end of the week", () => {
    expect(overlaps([{ days: [1], startMinute: 480, endMinute: 840 }, { days: [1], startMinute: 840, endMinute: 900 }])).toBe(false);
    expect(overlaps([{ days: [1], startMinute: 480, endMinute: 840 }, { days: [1], startMinute: 839, endMinute: 900 }])).toBe(true);
    expect(overlaps([{ days: [7], startMinute: 1380, endMinute: 60 }, { days: [1], startMinute: 30, endMinute: 45 }])).toBe(true);
    expect(overlaps([{ days: [7], startMinute: 1380, endMinute: 60 }, { days: [1], startMinute: 60, endMinute: 90 }])).toBe(false);
  });
});
