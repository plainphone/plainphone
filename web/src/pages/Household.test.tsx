// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { api } from "../lib/api";
import { HouseholdPage } from "./Household";

vi.mock("../components/ResetProtection", () => ({ ResetProtectionSection: () => null }));
vi.mock("../components/HouseholdMove", () => ({ HouseholdMove: () => null }));
const refresh = vi.hoisted(() => vi.fn(async () => null));
vi.mock("../lib/session", () => ({
  useMe: () => ({ user: { id: "u1", email: "me@example.org", locale: "en" }, households: [{ id: "h1", name: "Home", role: "owner" }] }),
  useSession: () => ({ refresh }),
  useActiveHousehold: () => ({ id: "h1", name: "Home", role: "owner" }),
  chooseHousehold: () => undefined,
}));

let root: Root;
let container: HTMLElement;
let removed: string[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  removed = [];
  vi.spyOn(api, "get").mockResolvedValue({
    members: [
      { id: "u1", email: "me@example.org", role: "owner" },
      { id: "u2", email: "co-parent@example.org", role: "parent" },
    ],
    invites: [],
  } as never);
  vi.spyOn(api, "del").mockImplementation((async (path: string) => {
    removed.push(path);
  }) as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><I18nProvider><HouseholdPage /></I18nProvider></MemoryRouter>));
  await act(async () => undefined);
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);

it("asks before removing another parent from the household", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove co-parent@example.org"]')!.click());
  expect(removed).toEqual([]);
  expect(container.textContent).toContain("Remove co-parent@example.org from the household?");

  await act(async () => button("Cancel")!.click());
  expect(removed).toEqual([]);
  expect(container.textContent).not.toContain("from the household?");

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove co-parent@example.org"]')!.click());
  await act(async () => button("Yes, remove")!.click());
  expect(removed).toEqual(["/households/h1/members/u2"]);
});

it("moves focus to the question, and back to the button on Cancel", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove co-parent@example.org"]')!.click());
  expect(document.activeElement?.id).toBe("remove-q-u2");
  await act(async () => button("Cancel")!.click());
  expect(document.activeElement?.id).toBe("remove-btn-u2");
});

it("asks before the parent leaves the household", async () => {
  await mount();
  await act(async () => button("Leave household")!.click());
  expect(removed).toEqual([]);
  expect(container.textContent).toContain("Leave the household?");
  await act(async () => button("Yes, leave")!.click());
  expect(removed).toEqual(["/households/h1/members/u1"]);
});

async function typeName(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[name="household-name"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("lets a new household get a name, with a placeholder while it has none", async () => {
  const patch = vi.spyOn(api, "patch").mockResolvedValue(undefined as never);
  await mount();
  const input = container.querySelector<HTMLInputElement>('input[name="household-name"]')!;
  expect(container.querySelector("h1")?.textContent).toBe("Household");
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("For example: Our family");
  expect(container.textContent).toContain("Shown on the phone when it connects");

  await act(async () => button("Save name")!.click());
  expect(patch).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Write a name of 1 to 60 characters.");

  // "Home" is the unnamed household's marker: saved, the page would show "Household" again.
  await typeName(" Home ");
  await act(async () => button("Save name")!.click());
  expect(patch).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Choose a name other than "Home".');

  await typeName("  Our family  ");
  await act(async () => button("Save name")!.click());
  expect(patch).toHaveBeenCalledWith("/households/h1", { name: "Our family" });
  expect(refresh).toHaveBeenCalled();
  expect(container.textContent).toContain("The name is saved.");
});
