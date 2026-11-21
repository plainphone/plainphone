// SPDX-License-Identifier: Apache-2.0
//
// Rules document -> the plan the stores and the extensions follow (docs/ios/architecture.md,
// "How it talks to the sync API"). Pure: no Apple frameworks, so it is unit tested anywhere.
// The plan is saved in the App Group, where the Device Activity Monitor extension reads it.

import Foundation

public struct CompiledPlan: Codable, Sendable, Equatable {
  public enum AppShield: String, Codable, Sendable {
    /// Every app is shielded except the selection (and Apple's own core apps, which iOS never shields).
    case allowList
    /// Only the selection is shielded (open mode).
    case blockList
  }

  public struct Base: Codable, Sendable, Equatable {
    public var appShield: AppShield
    /// `iosApps.selection.revision`, or nil before anyone picked apps.
    public var selectionRevision: String?
    public var denyAppInstallation: Bool
    public var denyAppRemoval: Bool
    public var lockAccounts: Bool
    public var lockPasscode: Bool
    public var requireAutomaticDateAndTime: Bool
  }

  /// A repeating window for the Device Activity Monitor (school time, bedtime).
  public struct Activity: Codable, Sendable, Equatable {
    /// `<store>.<schedule id>`, unique per phone; the monitor maps it back to its store.
    public var name: String
    public var store: StoreName
    public var weekdays: [Int]
    public var start: ClockTime
    public var end: ClockTime
    /// The window ends on the next day (`end` before `start`).
    public var crossesMidnight: Bool { end < start }
  }

  public var phoneId: String
  public var rulesRevision: Int
  public var released: Bool
  public var base: Base
  public var activities: [Activity]
  /// Today's whole-phone limit in minutes including today's bonuses; nil means no limit.
  public var dailyLimitMinutes: Int?
  public var askMoreTime: Bool
  public var limitWarning: Bool
  /// Parts of the document this build cannot apply, reported as failed policies. Never silent.
  public var skipped: [String]

  /// The stores this plan puts in effect.
  public var stores: [StoreName] { released ? [] : [.base] }
}

public enum RulesCompiler {
  /// Compiles a checked document. `now` picks today's limit in the document's time zone.
  public static func compile(_ doc: IosRulesDocument, now: Date) -> CompiledPlan {
    var skipped: [String] = []
    let zone = TimeZone(identifier: doc.timezone)
    if zone == nil { skipped.append("time zone \(doc.timezone) unknown; using the phone's own") }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone ?? .current

    var activities: [CompiledPlan.Activity] = []
    for s in doc.schedules {
      guard let store = StoreName(rawValue: s.kind), store == .school || store == .bedtime,
            let start = ClockTime(s.start), let end = ClockTime(s.end)
      else {
        skipped.append("schedule \(s.id): kind \(s.kind) unknown")
        continue
      }
      // An empty window (start == end) shields nothing; keep it out rather than guess a full day.
      if start == end { continue }
      activities.append(.init(name: "\(store.rawValue).\(s.id)", store: store, weekdays: s.days.sorted(), start: start, end: end))
    }

    return CompiledPlan(
      phoneId: doc.phoneId,
      rulesRevision: doc.rulesRevision,
      released: doc.release,
      base: .init(
        appShield: doc.iosApps.open ? .blockList : .allowList,
        selectionRevision: doc.iosApps.selection?.revision,
        denyAppInstallation: true,
        denyAppRemoval: true,
        lockAccounts: true,
        lockPasscode: true,
        requireAutomaticDateAndTime: true
      ),
      activities: activities,
      dailyLimitMinutes: dailyLimit(doc.timeLimits, now: now, calendar: calendar),
      askMoreTime: doc.askMoreTimeEnabled,
      limitWarning: doc.limitWarningEnabled,
      skipped: skipped
    )
  }

  /// `days[isoWeekday] ?? minutes` plus today's bonuses (docs/sync-api.md, `timeLimits`).
  static func dailyLimit(_ limits: IosRulesDocument.TimeLimits?, now: Date, calendar: Calendar) -> Int? {
    guard let total = limits?.total else { return nil }
    let parts = calendar.dateComponents([.year, .month, .day, .weekday], from: now)
    // Calendar weekdays: 1 = Sunday. ISO: 1 = Monday ... 7 = Sunday.
    let iso = ((parts.weekday ?? 1) + 5) % 7 + 1
    let base = total.days[String(iso)] ?? total.minutes
    let today = String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    let bonus = (limits?.bonuses ?? []).filter { $0.date == today }.reduce(0) { $0 + $1.minutes }
    return min(1440, base + bonus)
  }
}
