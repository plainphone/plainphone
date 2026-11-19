// SPDX-License-Identifier: Apache-2.0
import type { MoreTimeRequest } from "./more-time";

export const req = (over: Partial<MoreTimeRequest> = {}): MoreTimeRequest => ({
  id: "r1", phoneId: "p1", packageName: "com.example.video", appLabel: "Video", reason: null, day: "2026-11-19",
  status: "pending", answer: null, grantedMinutes: null, createdAt: "2026-11-19T08:00:00Z", decidedAt: null, answeredByYou: null,
  ...over,
});
