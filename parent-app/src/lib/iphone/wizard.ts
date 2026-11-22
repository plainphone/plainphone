// SPDX-License-Identifier: Apache-2.0
//
// The guided setup on a child's iPhone (docs/ios/architecture.md, phase 1 and the Apple-settings
// step of phase 5). The current step is derived from facts, never stored, so the wizard resumes
// in the right place after the app is closed, and nobody can skip Screen Time permission.
import type { Authorization } from "../../../modules/plainphone-screentime";
import { getItem, removeItem, setItem } from "../storage";

export const WIZARD_STEPS = ["welcome", "permission", "pair", "appleSettings", "done"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardFacts {
  /** The parent pressed Start on the first screen. */
  started: boolean;
  authorization: Authorization;
  paired: boolean;
  /** The Apple-settings step was answered ("Done" or "Later"). Optional, so it can be skipped. */
  appleSettingsAnswered: boolean;
}

export function currentStep(f: WizardFacts): WizardStep {
  if (!f.started && !f.paired) return "welcome";
  // Permission first: without it the phone cannot keep any rule, so pairing would only put a
  // phone in the dashboard that does nothing.
  if (f.authorization !== "approved") return "permission";
  if (!f.paired) return "pair";
  if (!f.appleSettingsAnswered) return "appleSettings";
  return "done";
}

/** "Step n of total" for the screens between welcome and done. */
export function progress(step: WizardStep): { index: number; total: number } | null {
  const counted = WIZARD_STEPS.slice(1, -1) as readonly WizardStep[];
  const i = counted.indexOf(step);
  return i < 0 ? null : { index: i + 1, total: counted.length };
}

const STARTED_KEY = "pp.iphone.setupStarted";
const APPLE_KEY = "pp.iphone.appleSettings";

export async function loadWizardFlags(): Promise<{ started: boolean; appleSettingsAnswered: boolean }> {
  const [started, apple] = await Promise.all([getItem(STARTED_KEY), getItem(APPLE_KEY)]);
  return { started: started === "1", appleSettingsAnswered: apple === "done" || apple === "later" };
}

export async function markStarted(): Promise<void> {
  await setItem(STARTED_KEY, "1");
}

export async function answerAppleSettings(answer: "done" | "later"): Promise<void> {
  await setItem(APPLE_KEY, answer);
}

/** After a release or removal: the next pairing starts from the first screen again. */
export async function resetWizard(): Promise<void> {
  await Promise.all([removeItem(STARTED_KEY), removeItem(APPLE_KEY)]);
}
