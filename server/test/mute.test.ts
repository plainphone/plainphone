// SPDX-License-Identifier: Apache-2.0
// What a parent's mute for a phone quiets and what it never does (docs/parent-app.md, docs/sos.md).
// The harness clock is fixed.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phones, pushSubscriptions, sessions } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(muted: boolean, familyInbox = true) {
  const parent = await signIn(h, "parent@example.org");
  const paired = await pairPhone(h, parent, { profile: "child", name: "Sam" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/parent" });
  await parent.put(`/api/phones/${paired.phoneId}/sos`, { familyInbox, quickMessagesEnabled: true, checkIns: true });
  if (muted) expect((await parent.put(`/api/phones/${paired.phoneId}/notifications`, { enabled: false })).status).toBe(204);
  return { parent, ...paired };
}

const message = (body: Record<string, unknown> = {}) => ({ id: randomUUID(), text: "Pick me up", inbox: true, ...body });
const thread = async (parent: Awaited<ReturnType<typeof setup>>["parent"], phoneId: string) =>
  (await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages as { text: string; delivered: number | null }[];

describe("quick messages and a mute", () => {
  for (const kind of ["quick", "checkin"] as const) {
    it(`pushes a ${kind} message when the phone is not muted`, async () => {
      const { device } = await setup(false);
      expect((await device.post("/api/device/quick-messages/send", message({ kind }))).json).toEqual({ notified: 1 });
      expect(h.parentPush.sent).toHaveLength(1);
    });

    it(`keeps a ${kind} message out of the push but in the inbox while the phone is muted`, async () => {
      const { parent, phoneId, device } = await setup(true);
      const answer = await device.post("/api/device/quick-messages/send", message({ kind, text: "I'm home" }));
      // Counted as delivered: the phone must not send an SMS to a parent who asked for quiet.
      expect(answer.json).toEqual({ notified: 1 });
      expect(h.parentPush.sent).toHaveLength(0);
      expect(await thread(parent, phoneId)).toMatchObject([{ text: "I'm home" }]);
    });
  }

  it("lets the phone fall back to SMS when every parent muted and the family inbox is off", async () => {
    const { device } = await setup(true, false);
    const answer = await device.post("/api/device/quick-messages/send", message({ inbox: false }));
    expect(answer.json).toEqual({ notified: 0 });
    expect(h.parentPush.sent).toHaveLength(0);
  });

  it("still records a muted message the phone sent without the inbox", async () => {
    const { parent, phoneId, device } = await setup(true);
    await device.post("/api/device/quick-messages/send", message({ inbox: false }));
    expect(h.parentPush.sent).toHaveLength(0);
    expect(await thread(parent, phoneId)).toHaveLength(1);
  });

  it("pushes to the parent who did not mute and stays quiet for the one who did", async () => {
    const { parent, phoneId, device } = await setup(true);
    const { households } = (await parent.get("/api/me")).json;
    const sent = await parent.post(`/api/households/${households[0].id}/invites`, { email: "other@example.org" });
    expect(sent.status).toBe(201);
    const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
    const other = await signIn(h, "other@example.org");
    expect((await other.post("/api/invites/accept", { token })).status).toBe(200);
    const { user } = (await other.get("/api/me")).json;
    await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/other" });
    expect((await device.post("/api/device/quick-messages/send", message())).json).toEqual({ notified: 1 });
    expect(h.parentPush.sent).toHaveLength(1);
    expect(h.parentPush.sent[0]!.endpoint).toBe("https://example.test/other");
    expect(await thread(parent, phoneId)).toHaveLength(1);
  });

  it("keeps a suggestion from the child out of the push while muted", async () => {
    const { device } = await setup(true);
    expect((await device.post("/api/device/quick-messages/suggest", { text: "Can I stay longer?" })).status).toBe(201);
    expect(h.parentPush.sent).toHaveLength(0);
  });

  it("pushes a suggestion when the phone is not muted", async () => {
    const { device } = await setup(false);
    expect((await device.post("/api/device/quick-messages/suggest", { text: "Can I stay longer?" })).status).toBe(201);
    expect(h.parentPush.sent).toHaveLength(1);
  });

  it("never mutes a code word: it goes through SOS, urgent", async () => {
    const { device } = await setup(true);
    const code = { id: randomUUID(), kind: "urgent", trigger: "code", message: "Pick me up" };
    expect((await device.post("/api/device/sos", code)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.parentPush.sent).toHaveLength(1);
    expect(h.parentPush.sent[0]!.urgent).toBe(true);
  });
});

describe("review reminders and a mute", () => {
  async function due(muted: boolean) {
    const s = await setup(muted);
    await s.parent.put(`/api/phones/${s.phoneId}/review`, { enabled: true });
    h.mail.outbox.length = 0;
    h.parentPush.sent.length = 0;
    h.clock.now = new Date("2030-03-01T00:00:00Z");
    await h.ctx.db.update(sessions).set({ expiresAt: new Date("2035-01-01T00:00:00Z") });
    await h.ctx.db.update(phones).set({ reviewDueAt: new Date("2030-02-01T00:00:00Z") }).where(eq(phones.id, s.phoneId));
    await sweep(h.ctx);
    return s;
  }
  const reviewMails = () => h.mail.outbox.filter((m) => m.subject.startsWith("Time to review"));
  const reviewPushes = () => h.parentPush.sent.filter((p) => p.msg.tag?.startsWith("review-"));

  it("sends push and mail when the phone is not muted", async () => {
    await due(false);
    expect(reviewPushes()).toHaveLength(1);
    expect(reviewMails()).toHaveLength(1);
  });

  it("sends neither while the phone is muted, and the dashboard still shows the date", async () => {
    const { parent, phoneId } = await due(true);
    expect(reviewPushes()).toHaveLength(0);
    expect(reviewMails()).toHaveLength(0);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.reviewDue).toBe(true);
  });
});
