// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { householdOptionLabel, pickHousehold } from "./household";

const households = [{ id: "a", name: "Home" }, { id: "b", name: "Home" }];

it("picks the saved household, and the first one when none is saved or it was left", () => {
  expect(pickHousehold(households, "b")?.id).toBe("b");
  expect(pickHousehold(households, null)?.id).toBe("a");
  expect(pickHousehold(households, "gone")?.id).toBe("a");
  expect(pickHousehold([], "a")).toBeUndefined();
});

it("tells two households with the same name apart by the role", () => {
  expect(householdOptionLabel("Home", "Owner")).not.toBe(householdOptionLabel("Home", "Parent"));
});
