// SPDX-License-Identifier: Apache-2.0
//
// Device Activity Monitor extension (`org.plainphone.app.activity-monitor`). iOS wakes it at the
// start and end of a monitored window and when a threshold is reached, even while the app is not
// running. It reads the plan from the App Group and flips stores; no networking, and it must stay
// far below the extension's memory limit (about 6 MB).

import DeviceActivity
import Foundation
import ManagedSettings
#if canImport(PlainphoneCore)
import PlainphoneCore
#endif

final class ActivityMonitorExtension: DeviceActivityMonitor {
  private let plans = FilePlanStore.shared(fallback: FileManager.default.temporaryDirectory)

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    // TODO(phase 2): put the window's store (school, bedtime) in effect from `plans.loadPlan()`.
    // TODO(spike d, docs/ios/spikes.md): decide whether a plan that is old and was never
    // confirmed needs a time-based fallback here.
    try? plans.appendEvent(AppGroupEvent(kind: .intervalStarted, at: Date(), detail: activity.rawValue))
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    // TODO(phase 2): lift the window's store; the base store is never touched here.
    try? plans.appendEvent(AppGroupEvent(kind: .intervalEnded, at: Date(), detail: activity.rawValue))
  }

  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    super.eventDidReachThreshold(event, activity: activity)
    // TODO(phase 2): the daily limit is used up; put the `limits` store in effect.
  }
}
