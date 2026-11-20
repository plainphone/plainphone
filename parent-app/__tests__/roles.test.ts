// SPDX-License-Identifier: Apache-2.0
import { availableRoles, loadRole, needsRoleChoice, resolveRole, ROLE_FLAGS, saveRole } from "../src/lib/roles";

const ios = { child: true, myself: true };

it("offers only Parent while the iOS roles are switched off", () => {
  expect(ROLE_FLAGS).toEqual({ child: false, myself: false });
  expect(availableRoles()).toEqual(["parent"]);
  expect(resolveRole("child")).toBe("parent");
  expect(resolveRole("myself")).toBe("parent");
  expect(needsRoleChoice(null)).toBe(false);
});

it("keeps Parent reachable whatever the flags say", () => {
  expect(availableRoles({ child: true, myself: false })).toEqual(["parent", "child"]);
  expect(availableRoles(ios)).toEqual(["parent", "child", "myself"]);
  expect(resolveRole("parent", ios)).toBe("parent");
});

it("keeps a saved role the build offers and asks again for one it does not", () => {
  expect(resolveRole("child", ios)).toBe("child");
  expect(resolveRole("myself", { child: true, myself: false })).toBe("parent");
  expect(resolveRole("admin", ios)).toBe("parent");
  expect(needsRoleChoice(null, ios)).toBe(true);
  expect(needsRoleChoice("myself", ios)).toBe(false);
  expect(needsRoleChoice("myself", { child: true, myself: false })).toBe(true);
});

it("saves only a role the build offers", async () => {
  expect(await saveRole("child")).toBe("parent");
  expect(await loadRole()).toBe("parent");
  expect(await saveRole("child", ios)).toBe("child");
  expect(await loadRole(ios)).toBe("child");
  expect(await loadRole()).toBe("parent");
});
