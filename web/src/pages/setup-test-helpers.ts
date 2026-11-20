// SPDX-License-Identifier: Apache-2.0
//
// Tests of /add that are about the code and the link walk past the two optional Child-phone steps
// (age and family agreement) the way a parent who skips them does.
import type { act as reactAct } from "react";

const press = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click();

export async function skipAgeSteps(container: HTMLElement, act: typeof reactAct, lastLabel = "Create setup link") {
  // The review reminder is on by default; switching it off keeps the walk to the code free of extra calls.
  await act(async () => container.querySelector<HTMLButtonElement>('button[role="switch"]')!.click());
  await act(async () => press(container, "Continue"));
  await act(async () => press(container, lastLabel));
  // The phone is created, then the code is built: let both finish.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
