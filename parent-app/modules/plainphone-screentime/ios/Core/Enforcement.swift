// SPDX-License-Identifier: Apache-2.0
//
// What this build of the iPhone app enforces beyond the base store (docs/ios/architecture.md,
// "Phase 1: what the iPhone does not enforce yet"). One switch, so phase 2 turns schedules on in
// one place instead of hunting for special cases.

public enum IosEnforcement {
  /// School time, bedtime and the daily limit. Phase 1 still compiles them from the rules document,
  /// but does not monitor them and does not report them as failed policies, so the dashboard shows
  /// the base lock as intact without them (maintainer decision 2026-11-21). Phase 2 sets this to
  /// true together with the DeviceActivity monitoring in FamilyControlsApplier.
  public static let enforcesSchedules = false
}
