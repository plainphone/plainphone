// SPDX-License-Identifier: Apache-2.0
import Foundation
import PlainphoneCore
import XCTest

final class RulesDocumentTests: XCTestCase {
  func testDecodesTheServersDocument() throws {
    let doc = try IosRulesDocument.parse(Fixture.data(), expectedPhoneId: Fixture.phoneId)
    XCTAssertEqual(doc.platform, "ios")
    XCTAssertEqual(doc.tier, "family_controls")
    XCTAssertEqual(doc.profile, "child")
    XCTAssertEqual(doc.timezone, "Europe/Copenhagen")
    XCTAssertEqual(doc.pollSeconds, 60)
    XCTAssertFalse(doc.release)
    XCTAssertFalse(doc.iosApps.open)
    XCTAssertEqual(doc.iosApps.selection?.source, "phone")
    XCTAssertEqual(doc.schedules.map(\.kind), ["school", "bedtime"])
    XCTAssertEqual(doc.timeLimits?.total, .init(minutes: 90))
    XCTAssertEqual(doc.timeLimits?.bonuses.map(\.minutes), [15])
    XCTAssertEqual(doc.capabilities["pickAppsOnPhone"], "yes")
  }

  func testMissingSwitchesMeanOnLikeTheServerSays() throws {
    let data = try Fixture.edited { doc in
      for key in ["askMoreTimeEnabled", "limitWarningEnabled", "pinApprovalEnabled", "silentBedtime", "changeReceiptsEnabled"] {
        doc.removeValue(forKey: key)
      }
    }
    let doc = try IosRulesDocument.parse(data, expectedPhoneId: nil)
    XCTAssertTrue(doc.askMoreTimeEnabled)
    XCTAssertTrue(doc.limitWarningEnabled)
    XCTAssertTrue(doc.pinApprovalEnabled)
    XCTAssertTrue(doc.silentBedtime)
    XCTAssertTrue(doc.changeReceiptsEnabled)
  }

  func testSwitchesTurnedOffStayOff() throws {
    let data = try Fixture.edited { $0["askMoreTimeEnabled"] = false; $0["limitWarningEnabled"] = false }
    let doc = try IosRulesDocument.parse(data, expectedPhoneId: nil)
    XCTAssertFalse(doc.askMoreTimeEnabled)
    XCTAssertFalse(doc.limitWarningEnabled)
  }

  func testIgnoresFieldsANewerServerAdds() throws {
    let data = try Fixture.edited { $0["somethingNew"] = ["nested": true]; $0["schedules"] = [] }
    XCTAssertNoThrow(try IosRulesDocument.parse(data, expectedPhoneId: nil))
  }

  func testRefusesAnAndroidDocument() throws {
    let data = try Fixture.edited { $0["platform"] = "android" }
    XCTAssertThrowsError(try IosRulesDocument.parse(data, expectedPhoneId: nil)) { error in
      XCTAssertEqual(error as? RulesError, .notForThisPhone("platform android"))
    }
  }

  func testRefusesRulesOfAnotherPhone() throws {
    XCTAssertThrowsError(try IosRulesDocument.parse(Fixture.data(), expectedPhoneId: "00000000-0000-4000-8000-000000000999")) { error in
      XCTAssertEqual(error as? RulesError, .notForThisPhone("another phone id"))
    }
  }

  func testRefusesMissingRequiredFields() throws {
    for key in ["phoneId", "platform", "iosApps", "rulesRevision"] {
      let data = try Fixture.edited { $0.removeValue(forKey: key) }
      XCTAssertThrowsError(try IosRulesDocument.parse(data, expectedPhoneId: nil), key) { error in
        guard case .unreadable = error as? RulesError else { return XCTFail("\(key): \(error)") }
      }
    }
  }

  func testRefusesBadTimesAndWeekdays() throws {
    let bad: [[String: Any]] = [
      ["id": "a", "kind": "school", "days": [0], "start": "08:00", "end": "14:00"],
      ["id": "b", "kind": "school", "days": [8], "start": "08:00", "end": "14:00"],
      ["id": "c", "kind": "school", "days": [1], "start": "8:00", "end": "14:00"],
      ["id": "d", "kind": "school", "days": [1], "start": "08:00", "end": "24:00"],
      ["id": "e", "kind": "school", "days": [], "start": "08:00", "end": "14:00"],
    ]
    for schedule in bad {
      let data = try Fixture.edited { $0["schedules"] = [schedule] }
      XCTAssertThrowsError(try IosRulesDocument.parse(data, expectedPhoneId: nil), "\(schedule["id"]!)")
    }
  }

  func testRefusesALimitOutOfRange() throws {
    let data = try Fixture.edited { $0["timeLimits"] = ["total": ["minutes": 2000, "days": [:]], "bonuses": []] }
    XCTAssertThrowsError(try IosRulesDocument.parse(data, expectedPhoneId: nil))
    let day = try Fixture.edited { $0["timeLimits"] = ["total": ["minutes": 60, "days": ["9": 30]], "bonuses": []] }
    XCTAssertThrowsError(try IosRulesDocument.parse(day, expectedPhoneId: nil))
  }

  func testRefusesSomethingThatIsNotJSON() {
    XCTAssertThrowsError(try IosRulesDocument.parse(Data("<html>".utf8), expectedPhoneId: nil))
  }

  func testClockTime() {
    XCTAssertEqual(ClockTime("00:00")?.minutes, 0)
    XCTAssertEqual(ClockTime("21:30")?.minutes, 1290)
    XCTAssertEqual(ClockTime("23:59")?.hour, 23)
    XCTAssertNil(ClockTime("24:00"))
    XCTAssertNil(ClockTime("12:60"))
    XCTAssertNil(ClockTime("1230"))
    XCTAssertNil(ClockTime("ab:cd"))
  }
}
