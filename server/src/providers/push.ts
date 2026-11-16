// SPDX-License-Identifier: Apache-2.0

/**
 * Wakes a phone so it fetches its rules now instead of at the next poll.
 * Polling with ETag is the delivery guarantee; push only shortens the delay.
 */
export interface PushProvider {
  readonly name: string;
  wake(fcmToken: string, reason: "rules" | "locate"): Promise<void>;
}

export class NoPushProvider implements PushProvider {
  readonly name = "none";
  async wake() {}
}

/** Records wake-ups. Used in tests. */
export class RecordingPushProvider implements PushProvider {
  readonly name = "recording";
  readonly sent: { token: string; reason: string }[] = [];
  async wake(token: string, reason: "rules" | "locate") {
    this.sent.push({ token, reason });
  }
}
