// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { api, type Phone } from "../lib/api";
import { req } from "../lib/more-time-fixtures";
import { MoreTimeRequests } from "./MoreTimeRequests";
import { MoreTimeSection } from "./MoreTimeSection";

const t = makeT("en");
const phone = { id: "p1", name: "Alma's phone", profile: "child" } as Phone;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function markup(requests = [req()], busy: string | null = null, lost: string[] = []) {
  return renderToStaticMarkup(
    <I18nProvider>
      <MoreTimeRequests phoneName="Alma's phone" requests={requests} busy={busy} alreadyAnswered={new Set(lost)} onAnswer={() => undefined} />
    </I18nProvider>,
  );
}

it("shows an open app request with four answers and the reason", () => {
  const html = markup([req({ reason: "Homework video" })]);
  expect(html).toContain("Alma&#x27;s phone asks for more time on Video");
  expect(html).toContain("Homework video");
  for (const k of ["moreTime.a15", "moreTime.a60", "moreTime.aDay", "moreTime.aNo"] as const) expect(html).toContain(`>${t(k)}<`);
});

it("words the daily cap differently from an app", () => {
  const html = markup([req({ packageName: "*", appLabel: null })]);
  expect(html).toContain("asks for more time on the daily limit");
  expect(html).not.toContain("on Video");
});

it("shows who answered and what was given, with no buttons left", () => {
  const byYou = markup([req({ status: "approved", answer: "15", grantedMinutes: 15, answeredByYou: true })]);
  expect(byYou).toContain("15 more minutes given");
  expect(byYou).toContain("Answered by you");
  expect(byYou).not.toContain("<button");
  const other = markup([req({ status: "approved", answer: "day", grantedMinutes: 140, answeredByYou: false })]);
  expect(other).toContain("Given the rest of the day");
  expect(other).toContain("Answered by another parent");
});

it("shows declined and expired results calmly", () => {
  expect(markup([req({ status: "declined", answer: "no", answeredByYou: true })])).toContain("Declined");
  const expired = markup([req({ status: "expired" })]);
  expect(expired).toContain("Expired, nobody answered before midnight");
  expect(expired).not.toContain("Answered by");
});

it("turns every answer button off while one is on its way", () => {
  expect(markup([req()], "r1").match(/disabled=""/g)).toHaveLength(4);
});

it("notes that a lost answer was already answered", () => {
  const html = markup([req({ status: "declined", answer: "no", answeredByYou: false })], null, ["r1"]);
  expect(html).toContain("This was already answered.");
  expect(html).toContain("Answered by another parent");
});

async function mount(list: ReturnType<typeof req>[], post: ReturnType<typeof vi.fn>) {
  vi.spyOn(api, "get").mockImplementation(async (p: string) => (p.endsWith("/more-time-requests") ? { requests: list } : phone) as never);
  vi.spyOn(api, "post").mockImplementation(post as never);
  const notify = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<I18nProvider><MoreTimeSection phone={phone} setPhone={() => undefined} notify={notify} /></I18nProvider>),
  );
  return { container, notify, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const click = (c: HTMLElement, label: string) =>
  act(async () => (Array.from(c.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement).click());

it("sends the answer and shows the decided result at once", async () => {
  const post = vi.fn(async () => ({ ...req({ status: "approved", answer: "60", grantedMinutes: 60, answeredByYou: true }), won: true }));
  const m = await mount([req()], post);
  await click(m.container, t("moreTime.a60"));
  expect(post).toHaveBeenCalledWith("/phones/p1/more-time-requests/r1/answer", { answer: "60" });
  // The reloaded list still says pending in this mock, but the merged state is what the parent just did.
  expect(m.notify).not.toHaveBeenCalled();
  await m.unmount();
});

it("shows the other parent's answer when ours lost", async () => {
  const lostAnswer = { ...req({ status: "declined", answer: "no", answeredByYou: false }), won: false };
  const list = [req()];
  const post = vi.fn(async () => {
    list[0] = req({ status: "declined", answer: "no", answeredByYou: false });
    return lostAnswer;
  });
  const m = await mount(list, post);
  await click(m.container, t("moreTime.a15"));
  expect(m.container.textContent).toContain(t("moreTime.alreadyAnswered"));
  expect(m.container.textContent).toContain(t("moreTime.byOther"));
  expect(m.container.querySelectorAll("button")).toHaveLength(0);
  await m.unmount();
});

it("keeps the request open and says so when the answer cannot be sent", async () => {
  const post = vi.fn(async () => { throw new Error("offline"); });
  const m = await mount([req()], post);
  await click(m.container, t("moreTime.a15"));
  expect(m.notify).toHaveBeenCalledWith({ tone: "error", text: t("moreTime.answerFailed") });
  expect(m.container.querySelectorAll("button")).toHaveLength(4);
  await m.unmount();
});
