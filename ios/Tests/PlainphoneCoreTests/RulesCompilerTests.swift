// SPDX-License-Identifier: Apache-2.0
import Foundation
import PlainphoneCore
import XCTest

final class RulesCompilerTests: XCTestCase {
  private func plan(_ data: Data? = nil, now: Date = Fixture.monday, enforcesSchedules: Bool = true) throws -> CompiledPlan {
    RulesCompiler.compile(try IosRulesDocument.parse(data ?? Fixture.data(), expectedPhoneId: nil), now: now,
                          enforcesSchedules: enforcesSchedules)
  }

  func testPhaseOneDoesNotEnforceSchedules() {
    // Maintainer decision 2026-11-21: school time, bedtime and the daily limit are not enforced on
    // iPhone in phase 1 and not reported either. Phase 2 flips this together with the monitoring.
    XCTAssertFalse(IosEnforcement.enforcesSchedules)
  }

  func testWithoutScheduleEnforcementTheyAreCompiledButNotMonitoredOrReported() throws {
    let data = try Fixture.edited {
      var schedules = $0["schedules"] as? [[String: Any]] ?? []
      schedules.append(["id": "x", "kind": "homework", "days": [1], "start": "16:00", "end": "17:00"])
      $0["schedules"] = schedules
    }
    let p = RulesCompiler.compile(try IosRulesDocument.parse(data, expectedPhoneId: nil), now: Fixture.monday)
    XCTAssertFalse(p.enforcesSchedules)
    // Still in the plan, behind the seam phase 2 switches on.
    XCTAssertEqual(p.activities.count, 2)
    XCTAssertEqual(p.dailyLimitMinutes, 105)
    XCTAssertEqual(p.monitoredActivities, [])
    XCTAssertNil(p.monitoredDailyLimitMinutes)
    XCTAssertEqual(p.skipped, [], "nothing that is not enforced can fail")
    XCTAssertEqual(p.stores, [.base])
  }

  func testWithScheduleEnforcementTheyAreMonitored() throws {
    let p = try plan(enforcesSchedules: true)
    XCTAssertEqual(p.monitoredActivities, p.activities)
    XCTAssertEqual(p.monitoredDailyLimitMinutes, 105)
  }

  func testTheBaseStoreIsTheWholeLock() throws {
    let p = try plan()
    XCTAssertEqual(p.phoneId, Fixture.phoneId)
    XCTAssertEqual(p.base.appShield, .allowList)
    XCTAssertNotNil(p.base.selectionRevision)
    XCTAssertTrue(p.base.denyAppInstallation)
    XCTAssertTrue(p.base.denyAppRemoval)
    XCTAssertTrue(p.base.lockAccounts)
    XCTAssertTrue(p.base.lockPasscode)
    XCTAssertTrue(p.base.requireAutomaticDateAndTime)
    XCTAssertEqual(p.stores, [.base])
    XCTAssertEqual(p.skipped, [])
  }

  func testOpenModeShieldsOnlyTheSelection() throws {
    let data = try Fixture.edited { $0["iosApps"] = ["open": true, "selection": NSNull()] }
    let p = try plan(data)
    XCTAssertEqual(p.base.appShield, .blockList)
    XCTAssertNil(p.base.selectionRevision)
  }

  func testSchedulesBecomeNamedWindows() throws {
    let p = try plan()
    XCTAssertEqual(p.activities.map(\.name), [
      "school.00000000-0000-4000-8000-000000000101",
      "bedtime.00000000-0000-4000-8000-000000000102",
    ])
    let school = p.activities[0]
    XCTAssertEqual(school.store, .school)
    XCTAssertEqual(school.weekdays, [1, 2, 3, 4, 5])
    XCTAssertEqual(school.start, ClockTime(minutes: 480))
    XCTAssertEqual(school.end, ClockTime(minutes: 870))
    XCTAssertFalse(school.crossesMidnight)
    XCTAssertTrue(p.activities[1].crossesMidnight)
  }

  func testAnUnknownScheduleKindIsReportedNotDropped() throws {
    let data = try Fixture.edited {
      $0["schedules"] = [["id": "x", "kind": "homework", "days": [1], "start": "16:00", "end": "17:00"]]
    }
    let p = try plan(data)
    XCTAssertEqual(p.activities, [])
    XCTAssertEqual(p.skipped, ["schedule x: kind homework unknown"])
  }

  func testTodaysLimitIncludesTodaysBonus() throws {
    // The fixture's bonus is for Monday 16 November in Copenhagen.
    XCTAssertEqual(try plan().dailyLimitMinutes, 105)
    let tuesday = Fixture.monday.addingTimeInterval(24 * 3600)
    XCTAssertEqual(try plan(now: tuesday).dailyLimitMinutes, 90)
  }

  func testTheLimitUsesTheDocumentsTimeZone() throws {
    // 23:30 UTC on Sunday 15 November is already Monday 00:30 in Copenhagen.
    let lateSunday = Fixture.monday.addingTimeInterval(-12.5 * 3600)
    XCTAssertEqual(try plan(now: lateSunday).dailyLimitMinutes, 105)
  }

  func testADayOverrideReplacesTheDailyMinutes() throws {
    let data = try Fixture.edited {
      $0["timeLimits"] = ["total": ["minutes": 90, "days": ["1": 30, "6": 180]], "bonuses": [["date": "2026-11-16", "minutes": 10]]]
    }
    XCTAssertEqual(try plan(data).dailyLimitMinutes, 40)
  }

  func testNoLimitMeansNone() throws {
    let data = try Fixture.edited { $0["timeLimits"] = ["total": NSNull(), "bonuses": []] }
    XCTAssertNil(try plan(data).dailyLimitMinutes)
  }

  func testTheFamilysSwitchesReachThePlan() throws {
    let data = try Fixture.edited { $0["askMoreTimeEnabled"] = false; $0["limitWarningEnabled"] = false }
    let p = try plan(data)
    XCTAssertFalse(p.askMoreTime)
    XCTAssertFalse(p.limitWarning)
    XCTAssertTrue(try plan().askMoreTime)
  }

  func testAReleasedPhoneHasNoStores() throws {
    let p = try plan(Fixture.edited { $0["release"] = true })
    XCTAssertTrue(p.released)
    XCTAssertEqual(p.stores, [])
  }

  func testAnUnknownTimeZoneIsReported() throws {
    let p = try plan(Fixture.edited { $0["timezone"] = "Mars/Olympus" })
    XCTAssertEqual(p.skipped, ["time zone Mars/Olympus unknown; using the phone's own"])
  }
}
