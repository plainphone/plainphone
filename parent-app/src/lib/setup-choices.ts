// SPDX-License-Identifier: Apache-2.0
import { client, unwrap } from "../api/client";
import type { AgreementDraft } from "../components/AgeControls";
import { type AgePresetId, parseLines } from "../shared/lib/age";

export interface AgeChoices {
  preset: AgePresetId | null;
  review: boolean;
  months: number;
}

export const DEFAULT_AGE_CHOICES: AgeChoices = { preset: null, review: true, months: 3 };

/** Saves the setup choices (age, review reminder, agreement) on a new Child phone. True when something could not be saved. */
export async function saveSetupChoices(pid: string, age: AgeChoices, agreement: AgreementDraft): Promise<boolean> {
  let failed = false;
  const attempt = async (call: () => Promise<unknown>) => {
    try {
      await call();
    } catch {
      failed = true;
    }
  };
  const params = { params: { path: { pid } } };
  if (age.preset) await attempt(() => unwrap(client.POST("/phones/{pid}/age-preset", { ...params, body: { preset: age.preset! } })));
  if (age.review) await attempt(() => unwrap(client.PUT("/phones/{pid}/review", { ...params, body: { enabled: true, intervalMonths: age.months } as never })));
  const lines = parseLines(agreement.lines);
  const adultLines = parseLines(agreement.adultLines);
  if (lines.length > 0 || adultLines.length > 0) {
    await attempt(() => unwrap(client.PUT("/phones/{pid}/agreement", { ...params, body: { lines, adultLines } as never })));
  }
  return failed;
}
