// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { api, type PendingChange } from "../lib/api";
import type { EarlyUnlockOffer, EarlyUnlockPurchase } from "../lib/billing";
import { formatDateTime } from "../lib/format";
import { EarlyUnlock, EarlyUnlockReceipt } from "./EarlyUnlock";

vi.mock("../lib/session", () => ({ useMe: () => ({ user: { email: "me@example.test" }, households: [{ id: "h1" }] }) }));

const t = makeT("en");
const NOW = new Date("2026-11-20T12:00:00Z");
const CID = "11111111-1111-4111-8111-111111111111";
const PURCHASE_ID = "22222222-2222-4222-8222-222222222222";

const offer: EarlyUnlockOffer = {
  available: true,
  reason: null,
  price: 1000,
  currency: "DKK",
  unlockMinutes: 10,
  nextAvailableAt: null,
  purchase: null,
};
const purchase: EarlyUnlockPurchase = {
  id: PURCHASE_ID,
  status: "scheduled",
  channel: "stripe",
  amount: 1000,
  currency: "DKK",
  consentAt: "2026-11-20T11:50:00Z",
  paidAt: "2026-11-20T11:55:00Z",
  unlockAt: "2026-11-20T12:05:00Z",
  deliveredAt: null,
  withdrawnAt: null,
  refundedAt: null,
  canWithdraw: true,
};

const posts: { path: string; body?: unknown }[] = [];
let postResult: unknown;
let getResult: unknown;
let root: Root;
let container: HTMLElement;
const assign = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => "en", setItem: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"] });
  posts.length = 0;
  postResult = undefined;
  getResult = purchase;
  assign.mockReset();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  vi.spyOn(api, "post").mockImplementation((async (path: string, body?: unknown) => {
    posts.push({ path, body });
    return postResult;
  }) as never);
  vi.spyOn(api, "get").mockImplementation((async () => getResult) as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><I18nProvider>{node}</I18nProvider></MemoryRouter>));
  await act(async () => undefined);
}
const change = (earlyUnlock?: EarlyUnlockOffer): Pick<PendingChange, "id" | "earlyUnlock"> => ({ id: CID, ...(earlyUnlock ? { earlyUnlock } : {}) });
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
const consentBox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
}

it("shows nothing when the change has no early unlock offer", async () => {
  await mount(<EarlyUnlock change={change()} onChanged={() => undefined} />);
  expect(container.innerHTML).toBe("");
});

it("shows nothing when unlocking early would save no time", async () => {
  await mount(<EarlyUnlock change={change({ ...offer, available: false, reason: "savesNoTime" })} onChanged={() => undefined} />);
  expect(container.innerHTML).toBe("");
});

it("starts as one quiet line and opens the terms with an unticked consent box", async () => {
  await mount(<EarlyUnlock change={change(offer)} onChanged={() => undefined} />);
  expect(container.textContent).toContain("Waiting is free.");
  expect(consentBox()).toBeNull();
  await click(button(t("early.open"))!);

  const text = container.textContent!;
  expect(text).toContain("including VAT");
  expect(text).toContain(t("early.infoWhen", { minutes: 10 }));
  expect(text).toContain(t("early.infoCap"));
  expect(text).toContain("Withdraw from contract");
  expect(text).toContain(t("early.consent"));
  expect(text).not.toMatch(/charity|donat|good cause/i);
  expect(consentBox().checked).toBe(false);

  const pay = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const keep = button(t("early.keepWaiting"))!;
  expect(pay.disabled).toBe(true);
  expect(keep).toBeTruthy();
  // Keep waiting is exactly as prominent as paying.
  expect(keep.className).toBe(pay.className);
});

it("offers it again after a cancelled checkout instead of asking to withdraw", async () => {
  const unpaid = { ...purchase, status: "created" as const, paidAt: null, unlockAt: null };
  await mount(<EarlyUnlock change={change({ ...offer, purchase: unpaid })} onChanged={() => undefined} />);
  expect(button(t("early.open"))).toBeTruthy();
  expect(button("Withdraw from contract")).toBeUndefined();
});

it("enables paying only after the consent is ticked, then posts it and goes to checkout", async () => {
  postResult = { purchase: { ...purchase, status: "created" }, checkoutUrl: "https://checkout.stripe.test/s/1" };
  await mount(<EarlyUnlock change={change(offer)} onChanged={() => undefined} />);
  await click(button(t("early.open"))!);
  const pay = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  await click(pay);
  expect(posts).toEqual([]);

  await click(consentBox());
  expect(consentBox().checked).toBe(true);
  expect(pay.disabled).toBe(false);
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(posts).toEqual([{ path: `/changes/${CID}/early-unlock`, body: { consent: true, locale: "en" } }]);
  expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/s/1");
});

it("keeps waiting without a request and closes the terms", async () => {
  await mount(<EarlyUnlock change={change(offer)} onChanged={() => undefined} />);
  await click(button(t("early.open"))!);
  await click(button(t("early.keepWaiting"))!);
  expect(consentBox()).toBeNull();
  expect(posts).toEqual([]);
});

it("shows when the weekly cap lifts", async () => {
  const next = "2026-11-25T09:30:00Z";
  await mount(<EarlyUnlock change={change({ ...offer, available: false, reason: "weeklyCap", nextAvailableAt: next })} onChanged={() => undefined} />);
  expect(container.textContent).toBe(t("early.weeklyCap", { time: formatDateTime(next, "en") }));
  expect(button(t("early.open"))).toBeUndefined();
});

it("shows a scheduled unlock with Withdraw from contract, and withdraws with confirm: true", async () => {
  const onChanged = vi.fn();
  postResult = { ...purchase, status: "refund_due", canWithdraw: false, withdrawnAt: NOW.toISOString() };
  await mount(<EarlyUnlock change={change({ ...offer, available: false, reason: "inProgress", purchase })} onChanged={onChanged} />);
  expect(container.textContent).toContain(t("early.scheduled", { time: formatDateTime(purchase.unlockAt!, "en") }));

  await click(button("Withdraw from contract")!);
  expect(container.textContent).toContain(t("early.withdrawContract", { id: PURCHASE_ID }));
  expect(container.textContent).toContain(t("early.withdrawReceipt", { email: "me@example.test" }));
  expect(container.querySelector("input:not([type])")).toBeTruthy();
  expect(button("Confirm withdrawal")).toBeTruthy();
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

  expect(posts[0]).toEqual({ path: `/early-unlocks/${PURCHASE_ID}/withdraw`, body: { confirm: true } });
  expect(container.textContent).toContain(t("early.refundDue"));
  expect(button("Withdraw from contract")).toBeUndefined();
  expect(onChanged).toHaveBeenCalled();
});

it("sends the optional name with the withdrawal", async () => {
  postResult = { ...purchase, status: "refund_due", canWithdraw: false };
  await mount(<EarlyUnlock change={change({ ...offer, available: false, reason: "inProgress", purchase })} onChanged={() => undefined} />);
  await click(button("Withdraw from contract")!);
  const input = container.querySelector<HTMLInputElement>("input:not([type])")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  Alex  ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(posts[0]!.body).toEqual({ confirm: true, name: "Alex" });
});

it("says it waits for payment confirmation after returning from checkout", async () => {
  getResult = { ...purchase, status: "created", paidAt: null, unlockAt: null };
  await mount(<EarlyUnlockReceipt id={PURCHASE_ID} />);
  expect(container.textContent).toContain(t("early.waitingPayment"));
  expect(button("Withdraw from contract")).toBeTruthy();
  expect(button(t("early.checkAgain"))).toBeTruthy();
});
