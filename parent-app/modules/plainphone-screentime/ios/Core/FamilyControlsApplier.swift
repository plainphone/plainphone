// SPDX-License-Identifier: Apache-2.0
//
// The plan applied with Family Controls, ManagedSettings and DeviceActivity (iOS 26). Phase 1
// applies the base store: the app shield, no installs or removals, locked accounts, passcode and
// date (docs/ios/architecture.md, "Phases"). Schedules and limits come in phase 2
// (`IosEnforcement.enforcesSchedules`).

#if canImport(FamilyControls) && canImport(ManagedSettings)
@preconcurrency import DeviceActivity
@preconcurrency import FamilyControls
import Foundation
@preconcurrency import ManagedSettings

@MainActor
public final class FamilyControlsApplier: ScreenTimeApplying {
  public init() {}

  public var authorization: AuthorizationState {
    switch AuthorizationCenter.shared.authorizationStatus {
    case .notDetermined: return .notDetermined
    case .denied: return .denied
    case .approved: return .approved
    @unknown default: return .other(String(describing: AuthorizationCenter.shared.authorizationStatus))
    }
  }

  public func requestAuthorization(for member: FamilyMember) async throws -> AuthorizationState {
    // `.child` asks for the parent's Apple Account on this phone; iOS shows its own sheet.
    try await AuthorizationCenter.shared.requestAuthorization(for: member == .child ? .child : .individual)
    return authorization
  }

  private func store(_ name: StoreName) -> ManagedSettingsStore {
    ManagedSettingsStore(named: ManagedSettingsStore.Name(name.rawValue))
  }

  public func apply(_ plan: CompiledPlan, selection: Data?) throws -> ApplyOutcome {
    if plan.released {
      try releaseAll()
      return ApplyOutcome(effectiveStores: [])
    }
    var failed: [String] = []
    let base = store(.base)
    base.application.denyAppInstallation = plan.base.denyAppInstallation
    base.application.denyAppRemoval = plan.base.denyAppRemoval
    base.account.lockAccounts = plan.base.lockAccounts
    base.passcode.lockPasscode = plan.base.lockPasscode
    base.dateAndTime.requireAutomaticDateAndTime = plan.base.requireAutomaticDateAndTime

    // TODO(spike a, docs/ios/spikes.md): whether a selection picked on the parent's iPhone
    // decodes here and shields the same apps. Until then a phone-side pick is the safe source.
    var tokens: Set<ApplicationToken>?
    if let selection {
      tokens = try? JSONDecoder().decode(FamilyActivitySelection.self, from: selection).applicationTokens
      if tokens == nil { failed.append("app selection could not be read") }
    } else {
      tokens = []
    }
    switch (plan.base.appShield, tokens) {
    case (.allowList, let allowed?):
      base.shield.applications = nil
      base.shield.applicationCategories = .all(except: allowed)
    case (.allowList, nil):
      // Unreadable allow list: shield every app rather than guess (never looser on error).
      base.shield.applications = nil
      base.shield.applicationCategories = .all(except: [])
    case (.blockList, let blocked?):
      base.shield.applicationCategories = nil
      base.shield.applications = blocked.isEmpty ? nil : blocked
    case (.blockList, nil):
      // Unreadable block list: keep the shield that is in place.
      break
    }

    // TODO(phase 2, spike d): start DeviceActivity monitoring for `plan.monitoredActivities` and
    // `plan.monitoredDailyLimitMinutes`. iOS monitors at most 20 activities, so windows are merged
    // per store first. Both are empty while `IosEnforcement.enforcesSchedules` is off (phase 1),
    // so nothing is reported; turning the switch on before this is built reports them as failed.
    if !plan.monitoredActivities.isEmpty { failed.append("school time and bedtime could not be started") }
    if plan.monitoredDailyLimitMinutes != nil { failed.append("the daily limit could not be started") }
    return ApplyOutcome(effectiveStores: [.base], failed: failed)
  }

  public func setMaintenance(_ on: Bool, plan: CompiledPlan, selection: Data?) throws -> ApplyOutcome {
    guard on else { return try apply(plan, selection: selection) }
    store(.base).clearAllSettings()
    return ApplyOutcome(effectiveStores: [.maintenance])
  }

  public func releaseAll() throws {
    for name in StoreName.allCases { store(name).clearAllSettings() }
    let center = DeviceActivityCenter()
    center.stopMonitoring(center.activities)
  }
}
#endif
