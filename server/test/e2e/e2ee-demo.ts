// SPDX-License-Identifier: Apache-2.0
//
// E2EE phase 0 prototype demo (docs/e2ee-prototype.md), run by scripts/e2ee-prototype-demo.sh.
// It starts the real server over HTTP with E2EE_PROTOTYPE_ENABLED, signs in two parents, pairs
// a child phone and drives four OpenMLS clients (the `pp-mls` CLI from e2ee/mls-core, one
// process per device) through the delivery-service routes: a household group of two parents
// and the child, adding and removing a parent's tablet, key rotation, a commit race, a stale
// send and a few texts end to end. Every identity and text is synthetic.
//
// It prints step names and counts only: no texts, keys or message sizes. At the end it checks
// that no text reached the database or the server's console in clear.
//
// Usage: node --import tsx test/e2e/e2ee-demo.ts <path to pp-mls>

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createDb, runMigrations } from "../../src/db/client.js";
import { MockDnsProvider } from "../../src/providers/dns.js";
import { MemoryMailProvider } from "../../src/providers/mail.js";
import { MemoryParentPushProvider } from "../../src/providers/parent-push.js";
import { NoPushProvider } from "../../src/providers/push.js";
import type { Ctx } from "../../src/services/context.js";

const cli = process.argv[2];
if (!cli) throw new Error("usage: e2ee-demo.ts <path to pp-mls>");
const CANARY = "SYNTH-CANARY";

// --- What the server process prints must never contain a text --------------------------------
const consoleOut: string[] = [];
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    consoleOut.push(args.map(String).join(" "));
    original(...args);
  };
}

let step = 0;
function ok(what: string) {
  step += 1;
  process.stdout.write(`ok ${step} - ${what}\n`);
}
function check(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${what}`);
}

// --- Database and server ------------------------------------------------------------------------
let databaseUrl = process.env.DATABASE_URL;
let stopPg = async () => {};
if (!databaseUrl) {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = await mkdtemp(join(tmpdir(), "plainphone-e2ee-pg-"));
  const pgPort = 20_000 + Math.floor(Math.random() * 20_000);
  const pg = new EmbeddedPostgres({ databaseDir: dir, port: pgPort, user: "plainphone", password: "plainphone", persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("plainphone_e2ee");
  databaseUrl = `postgres://plainphone:plainphone@127.0.0.1:${pgPort}/plainphone_e2ee`;
  stopPg = async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}
const { db, sql: pgClient } = createDb(databaseUrl);
await runMigrations(db);
const mail = new MemoryMailProvider();
const ctx: Ctx = {
  db,
  cfg: loadConfig({ DATABASE_URL: databaseUrl, PUBLIC_URL: "http://127.0.0.1", NODE_ENV: "test", E2EE_PROTOTYPE_ENABLED: "true" }),
  mail,
  dns: new MockDnsProvider(),
  push: new NoPushProvider(),
  parentPush: new MemoryParentPushProvider(),
  now: () => new Date(),
};
check(ctx.cfg.E2EE_PROTOTYPE_ENABLED, "the prototype is switched on for the demo");
const server = serve({ fetch: createApp(ctx).fetch, hostname: "127.0.0.1", port: 0 });
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("no TCP address");
const base = `http://127.0.0.1:${address.port}/api`;

async function http(token: string | undefined, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function signIn(email: string): Promise<string> {
  check((await http(undefined, "POST", "/auth/request", { email, locale: "en" })).status === 202, "login request");
  const token = decodeURIComponent(/#token=([^\s"&<]+)/.exec(mail.outbox.at(-1)!.text)![1]!);
  const v = await http(undefined, "POST", "/auth/verify", { token, locale: "en", client: "native" });
  check(v.status === 200, "login verify");
  return v.json.sessionToken;
}

// --- One pp-mls process per device -----------------------------------------------------------
class Mls {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly lines: AsyncIterator<string>;
  constructor() {
    this.proc = spawn(cli!, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.proc.stdout })[Symbol.asyncIterator]();
  }
  async call(req: Record<string, unknown>): Promise<Record<string, any>> {
    this.proc.stdin.write(`${JSON.stringify(req)}\n`);
    const next = await this.lines.next();
    check(!next.done, "pp-mls answered");
    return JSON.parse(next.value);
  }
  async ok(req: Record<string, unknown>) {
    const r = await this.call(req);
    check(r.ok === true, `${String(req.op)}: ${r.error ?? ""} ${r.detail ?? ""}`);
    return r;
  }
  close() {
    this.proc.stdin.end();
  }
}

type Role = "admin" | "child";
class Device {
  mls = new Mls();
  handle = 0;
  mlsSignPub = "";
  deviceId = "";
  cursor = 0;
  log = generateKeyPairSync("ed25519");
  groups = new Map<string, string>(); // server group id -> MLS group id
  inbox: { sender: string; messageId: string; text: string }[] = [];
  constructor(readonly name: string, readonly role: Role, readonly token: string, readonly householdId?: string) {}

  async register() {
    // The device picks a random ID, which its MLS credential carries, then registers it.
    this.deviceId = randomUUID();
    const c = await this.mls.ok({ op: "new_client", deviceId: this.deviceId });
    this.handle = c.handle;
    this.mlsSignPub = c.mlsSignPub;
    const r = await http(this.token, "POST", "/e2ee/devices", { deviceId: this.deviceId, householdId: this.householdId, mlsSignPub: this.mlsSignPub });
    check(r.status === 201 && r.json.role === this.role && r.json.deviceId === this.deviceId, `${this.name} registers as ${this.role}`);
  }

  /** The household-log entry: the log key signs D("mls-leaf", {deviceId, mlsSignPub}). */
  async logEntry() {
    const { input } = await this.mls.ok({ op: "binding_input", deviceId: this.deviceId, mlsSignPub: this.mlsSignPub });
    const binding = sign(null, Buffer.from(input, "base64url"), this.log.privateKey).toString("base64url");
    const logSignPub = this.log.publicKey.export({ format: "jwk" }).x!;
    return { deviceId: this.deviceId, role: this.role, logSignPub, mlsSignPub: this.mlsSignPub, binding };
  }

  async publishKeyPackages(count: number) {
    const kp = await this.mls.ok({ op: "key_packages", handle: this.handle, count, lastResort: true });
    const r = await http(this.token, "POST", "/e2ee/key-packages", { deviceId: this.deviceId, keyPackages: kp.keyPackages, lastResort: kp.lastResort });
    check(r.status === 201, `${this.name} publishes key packages`);
  }

  /** Fetch, process in delivery order, acknowledge. Returns the events. */
  async sync() {
    const r = await http(this.token, "GET", `/e2ee/inbox?deviceId=${this.deviceId}&after=${this.cursor}`);
    if (r.status !== 200) return { status: r.status, events: [] as Record<string, any>[] };
    const events: Record<string, any>[] = [];
    for (const item of r.json.items) {
      const e = await this.mls.call({ op: "process", handle: this.handle, message: item.payload });
      check(e.ok === true, `${this.name} processes a ${item.kind}: ${e.error ?? ""} ${e.detail ?? ""}`);
      if (e.kind === "joined") this.groups.set(item.groupId, e.groupId);
      if (e.kind === "text") this.inbox.push({ sender: e.sender, messageId: e.messageId, text: e.text });
      if (e.kind === "removed") this.groups.delete(item.groupId);
      events.push(e);
      this.cursor = item.cursor;
    }
    if (r.json.items.length) {
      check((await http(this.token, "POST", "/e2ee/inbox/ack", { deviceId: this.deviceId, upTo: this.cursor })).status === 204, "ack");
    }
    return { status: 200, events };
  }

  /** Make a commit locally, post it, then merge (201) or clear it (409). */
  async commit(gid: string, req: Record<string, unknown>) {
    const p = await this.mls.ok({ ...req, handle: this.handle, groupId: this.groups.get(gid) });
    const r = await http(this.token, "POST", `/e2ee/groups/${gid}/commits`, {
      deviceId: this.deviceId, commit: p.commit, welcome: p.welcome ?? undefined, members: p.members,
    });
    if (r.status === 201) await this.mls.ok({ op: "merge_pending", handle: this.handle, groupId: this.groups.get(gid) });
    else await this.mls.ok({ op: "clear_pending", handle: this.handle, groupId: this.groups.get(gid) });
    return r.status;
  }

  async send(gid: string, text: string, messageId = randomUUID()) {
    const e = await this.mls.call({ op: "encrypt", handle: this.handle, groupId: this.groups.get(gid), messageId, text });
    if (!e.ok) return { status: 0, error: e.error as string, messageId };
    const r = await http(this.token, "POST", `/e2ee/groups/${gid}/messages`, { deviceId: this.deviceId, message: e.message });
    return { status: r.status, error: undefined, messageId };
  }
}

const devices: Device[] = [];
try {
  // --- Household: two parents and a child phone ----------------------------------------------
  const mumToken = await signIn("parent-a@example.test");
  const pairing = await http(undefined, "POST", "/device/pairings", { mode: "strong", deviceInfo: { model: "Synthetic" } });
  const claim = await http(mumToken, "POST", "/phones/claim", { code: pairing.json.code, name: "Test child", profile: "child" });
  check(claim.status === 201, "pair the child phone");
  const poll = await http(undefined, "GET", `/device/pairings/${pairing.json.pairingId}`, undefined, { "x-poll-secret": pairing.json.pollSecret });
  const phoneToken = poll.json.deviceToken as string;
  const hid = (await http(mumToken, "GET", "/me")).json.households[0].id as string;
  await http(mumToken, "POST", `/households/${hid}/invites`, { email: "parent-b@example.test" });
  const invite = decodeURIComponent(/invite#token=(\S+)/.exec(mail.outbox.at(-1)!.text)![1]!);
  const dadToken = await signIn("parent-b@example.test");
  check((await http(dadToken, "POST", "/invites/accept", { token: invite })).status === 200, "second parent joins");
  ok("household with two parents and a paired child phone (synthetic)");

  const mum = new Device("parent A phone", "admin", mumToken, hid);
  const dad = new Device("parent B phone", "admin", dadToken, hid);
  const child = new Device("child phone", "child", phoneToken);
  const tablet = new Device("parent A tablet", "admin", mumToken, hid);
  devices.push(mum, dad, child, tablet);
  for (const d of devices) await d.register();
  ok("four MLS devices registered: two admin parents, one child, one extra parent tablet");

  let rosterVersion = 0;
  const setRoster = async (members: Device[]) => {
    rosterVersion += 1;
    const roster = await Promise.all(members.map((d) => d.logEntry()));
    for (const d of devices) {
      if (!members.includes(d)) continue;
      const r = await d.mls.ok({ op: "set_roster", handle: d.handle, version: rosterVersion, roster });
      check(r.accepted === members.length, "roster accepted");
    }
  };
  await setRoster([mum, dad, child]);
  for (const d of [dad, child, tablet]) await d.publishKeyPackages(2);
  ok("household log v1 (both parents and the child) verified on every device; key packages published");

  // --- Create the conversation -----------------------------------------------------------------
  const created = await mum.mls.ok({ op: "create_group", handle: mum.handle });
  const g = await http(mumToken, "POST", "/e2ee/groups", { deviceId: mum.deviceId, mlsGroupId: created.groupId });
  check(g.status === 201, "conversation created");
  const gid = g.json.groupId as string;
  mum.groups.set(gid, created.groupId);
  const kps = await http(mumToken, "POST", "/e2ee/key-packages/claim", { deviceId: mum.deviceId, deviceIds: [dad.deviceId, child.deviceId] });
  check(kps.status === 200, "claim key packages");
  check((await mum.commit(gid, { op: "add_members", keyPackages: kps.json.keyPackages.map((k: { keyPackage: string }) => k.keyPackage) })) === 201, "add commit accepted");
  for (const d of [dad, child]) {
    const { events } = await d.sync();
    check(events.length === 1 && events[0]!.kind === "joined" && events[0]!.by === mum.deviceId, `${d.name} joins from the Welcome`);
  }
  ok("parent A creates the household group and adds parent B and the child (one commit, one Welcome)");

  const everyoneReads = async (sender: Device, readers: Device[], label: string) => {
    const text = `${CANARY} ${label} ${randomUUID()}`;
    const sent = await sender.send(gid, text);
    check(sent.status === 201, `${sender.name} sends (${sent.error ?? sent.status})`);
    for (const r of readers) {
      await r.sync();
      const got = r.inbox.at(-1);
      check(got?.text === text && got.sender === sender.deviceId && got.messageId === sent.messageId, `${r.name} reads ${sender.name}'s text`);
    }
    return text;
  };
  await everyoneReads(mum, [dad, child], "hello from parent A");
  await everyoneReads(child, [mum, dad], "hello from the child");
  await everyoneReads(dad, [mum, child], "hello from parent B");
  ok("three texts end to end: each read by both other members, sender and message ID verified");

  // --- Add a member -----------------------------------------------------------------------------
  await setRoster([mum, dad, child, tablet]);
  const tkp = await http(mumToken, "POST", "/e2ee/key-packages/claim", { deviceId: mum.deviceId, deviceIds: [tablet.deviceId] });
  check((await mum.commit(gid, { op: "add_members", keyPackages: [tkp.json.keyPackages[0].keyPackage] })) === 201, "add tablet");
  for (const d of [dad, child]) {
    const { events } = await d.sync();
    check(events[0]?.kind === "commit" && events[0].added[0] === tablet.deviceId, `${d.name} sees the tablet added`);
  }
  check((await tablet.sync()).events[0]?.kind === "joined", "tablet joins");
  await everyoneReads(tablet, [mum, dad, child], "hello from the tablet");
  ok("household log v2 adds parent A's tablet; parent A adds it; it joins and its text is read by all");

  // --- Remove a member --------------------------------------------------------------------------
  await setRoster([mum, dad, child]);
  const refused = await child.send(gid, `${CANARY} must not be sent`);
  check(refused.error === "stale_members", "the child refuses to send while the removed tablet is still in the group");
  check((await dad.commit(gid, { op: "remove_members", deviceIds: [tablet.deviceId] })) === 201, "remove commit accepted");
  for (const d of [mum, child]) {
    const { events } = await d.sync();
    check(events[0]?.kind === "commit" && events[0].removed[0] === tablet.deviceId, `${d.name} sees the tablet removed`);
  }
  const { events: gone } = await tablet.sync();
  check(gone.at(-1)?.kind === "removed" && tablet.groups.size === 0, "the tablet learns it was removed and deletes the conversation");
  check((await http(dadToken, "DELETE", `/e2ee/devices/${tablet.deviceId}`)).status === 204, "server revokes the tablet");
  const afterRemoval = await everyoneReads(child, [mum, dad], "after the removal");
  check((await tablet.sync()).status === 404, "the revoked tablet can no longer fetch anything");
  // A dishonest server that still forwards the new text: the tablet has no keys for it.
  const forwarded = await child.send(gid, `${CANARY} forwarded to the tablet`);
  const [stolen] = await db.execute<{ payload: string }>(sql`select payload from e2ee_messages where kind = 'application' order by created_at desc limit 1`);
  const attempt = await tablet.mls.call({ op: "process", handle: tablet.handle, message: stolen!.payload });
  check(forwarded.status === 201 && attempt.ok === false && attempt.error === "group_unknown", "the removed tablet cannot decrypt a forwarded text");
  check(!tablet.inbox.some((m) => m.text === afterRemoval), "the tablet did not read the text sent after its removal");
  for (const d of [mum, dad]) await d.sync();
  ok("log v3 removes the tablet: the child refuses to send until parent B commits the removal; the tablet cannot read anything after it");

  // --- Key rotation -----------------------------------------------------------------------------
  const before = (await http(phoneToken, "GET", `/e2ee/groups/${gid}?deviceId=${child.deviceId}`)).json.epoch as number;
  check((await child.commit(gid, { op: "update" })) === 201, "child rotates its leaf key");
  for (const d of [mum, dad]) check((await d.sync()).events[0]?.kind === "commit", `${d.name} applies the rotation`);
  const after = (await http(phoneToken, "GET", `/e2ee/groups/${gid}?deviceId=${child.deviceId}`)).json.epoch as number;
  check(after === before + 1, "epoch advanced by one");
  await everyoneReads(mum, [dad, child], "after the rotation");
  ok("the child rotates its keys (update commit); everyone moves to the next epoch and keeps reading");

  // --- A commit race and a stale send -----------------------------------------------------------
  const pa = await mum.mls.ok({ op: "update", handle: mum.handle, groupId: mum.groups.get(gid) });
  const pb = await dad.mls.ok({ op: "update", handle: dad.handle, groupId: dad.groups.get(gid) });
  const postCommit = (d: Device, p: Record<string, any>) => http(d.token, "POST", `/e2ee/groups/${gid}/commits`, { deviceId: d.deviceId, commit: p.commit, members: p.members });
  const [ra, rb] = [await postCommit(mum, pa), await postCommit(dad, pb)];
  check(ra.status === 201 && rb.status === 409, "one commit per epoch: the second gets 409");
  await mum.mls.ok({ op: "merge_pending", handle: mum.handle, groupId: mum.groups.get(gid) });
  await dad.mls.ok({ op: "clear_pending", handle: dad.handle, groupId: dad.groups.get(gid) });
  // Parent B has not synced: its text is for the old epoch, and the server refuses it.
  const stale = await dad.send(gid, `${CANARY} stale`);
  check(stale.status === 409, "a text for the old epoch is refused by the server");
  for (const d of [mum, dad]) await d.sync();
  await child.sync();
  check((await dad.commit(gid, { op: "update" })) === 201, "parent B retries its rotation after syncing");
  for (const d of [mum, child]) await d.sync();
  await everyoneReads(dad, [mum, child], "after the race");
  ok("two parents rotate at once: the server takes one, the other gets 409, syncs and retries; a stale text is refused");

  // --- What the server saw ----------------------------------------------------------------------
  const rows = await db.execute<{ kind: string; payload: string }>(sql`select kind, payload from e2ee_messages`);
  const kps2 = await db.execute<{ key_package: string }>(sql`select key_package from e2ee_key_packages`);
  const seen = [...rows.map((r) => r.payload), ...kps2.map((r) => r.key_package)].map((p) => Buffer.from(p, "base64url").toString("latin1"));
  check(!seen.some((s) => s.includes(CANARY) || s.includes("SYNTH")), "no plaintext in any stored blob");
  check(!consoleOut.some((s) => s.includes(CANARY)), "no plaintext in the server's console output");
  const columns = await db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_name = 'e2ee_messages'`);
  check(!columns.some((c) => /sender/.test(c.column_name)), "the server stores no sender for messages");
  ok(`server-side check: ${seen.length} stored blobs, none with plaintext; no sender column; nothing in the console`);
  process.stdout.write(`e2ee prototype demo passed (${step} steps)\n`);
} finally {
  for (const d of devices) d.mls.close();
  server.close();
  await pgClient.end();
  await stopPg();
}
