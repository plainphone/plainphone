// SPDX-License-Identifier: Apache-2.0
//
// Sign-in for app store review (docs/store-review.md). Store reviewers cannot open a login link,
// so one address, set by the operator, may sign in with a fixed code instead. Unset, none of this
// exists: no address is a review address and the route answers 404.
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config.js";
import { sha256 } from "../lib/crypto.js";

type ReviewConfig = Pick<Config, "REVIEW_LOGIN_EMAIL" | "REVIEW_LOGIN_CODE">;

export function reviewLoginEnabled(cfg: ReviewConfig): boolean {
  return Boolean(cfg.REVIEW_LOGIN_EMAIL && cfg.REVIEW_LOGIN_CODE);
}

/** `email` as stored (trimmed, lower case; `email` in lib/validation.ts). */
export function isReviewAddress(cfg: ReviewConfig, email: string): boolean {
  return reviewLoginEnabled(cfg) && email === cfg.REVIEW_LOGIN_EMAIL;
}

/**
 * True only for the review address together with the review code. Both are compared in constant
 * time (as hashes, so the lengths match), and both comparisons always run.
 */
export function reviewCodeMatches(cfg: ReviewConfig, email: string, code: string): boolean {
  if (!cfg.REVIEW_LOGIN_EMAIL || !cfg.REVIEW_LOGIN_CODE) return false;
  const address = timingSafeEqual(Buffer.from(sha256(email), "hex"), Buffer.from(sha256(cfg.REVIEW_LOGIN_EMAIL), "hex"));
  const secret = timingSafeEqual(Buffer.from(sha256(code), "hex"), Buffer.from(sha256(cfg.REVIEW_LOGIN_CODE), "hex"));
  return address && secret;
}
