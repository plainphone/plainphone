// SPDX-License-Identifier: Apache-2.0
import Foundation
import PlainphoneCore
import XCTest

/// A fresh engine on a fake Screen Time, an in-memory App Group and a pinned clock.
@MainActor
private final class Rig {
  let screenTime = FakeScreenTime(authorization: .approved)
  let store = MemoryPlanStore()
  var clock = Fixture.monday
  lazy var engine = ScreenTimeEngine(applier: screenTime, store: store, now: { [unowned self] in self.clock })
}

private let selection = Data([1, 2, 3])

/// Runs a test body on the main actor. swift-corelibs-xctest (the Linux check in ios/README.md)
/// crashes on @MainActor test classes and methods, so the isolation lives here instead.
private func onMain(_ body: @escaping @MainActor () async throws -> Void) async throws {
  try await Task { @MainActor in try await body() }.value
}

final class ScreenTimeEngineTests: XCTestCase {
  func testAppliesTheDocumentAndConfirmsIt() async throws {
    try await onMain {
      let rig = Rig()
      let r = rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: Fixture.phoneId, selection: selection)
      XCTAssertEqual(r.rulesEtag, "\"e1\"")
      XCTAssertEqual(r.rulesAppliedAt, Fixture.monday)
      XCTAssertTrue(r.rulesReceiptConfirmed)
      XCTAssertEqual(r.effectiveStores, [.base])
      XCTAssertEqual(r.failedPolicies, [])
      XCTAssertEqual(rig.screenTime.applied.count, 1)
      XCTAssertEqual(rig.screenTime.selections, [selection])
      // Saved for the extensions.
      XCTAssertEqual(rig.store.plan?.phoneId, Fixture.phoneId)
      XCTAssertEqual(rig.store.receipt, r)
    }
  }

  func testKeepsTheFirstApplicationTimeOfTheSameRules() async throws {
    try await onMain {
      let rig = Rig()
      rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: nil, selection: nil)
      rig.clock = rig.clock.addingTimeInterval(600)
      XCTAssertEqual(rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: nil, selection: nil).rulesAppliedAt, Fixture.monday)
      XCTAssertEqual(rig.engine.apply(document: try Fixture.data(), etag: "\"e2\"", expectedPhoneId: nil, selection: nil).rulesAppliedAt, rig.clock)
    }
  }

  func testAnInvalidDocumentLeavesTheOldRulesInPlace() async throws {
    try await onMain {
      let rig = Rig()
      rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: nil, selection: nil)
      let before = rig.store.plan
      let r = rig.engine.apply(document: Data("{\"platform\":\"ios\"}".utf8), etag: "\"e2\"", expectedPhoneId: nil, selection: nil)
      XCTAssertEqual(r.rulesEtag, "\"e1\"", "the receipt still names the rules in effect")
      XCTAssertTrue(r.rulesReceiptConfirmed)
      XCTAssertEqual(r.failedPolicies.count, 1)
      XCTAssertTrue(r.failedPolicies[0].hasPrefix("rules document unreadable"), r.failedPolicies[0])
      XCTAssertEqual(rig.store.plan, before)
      XCTAssertEqual(rig.screenTime.applied.count, 1, "nothing was applied")
      XCTAssertFalse(rig.engine.status(iosVersion: "26.1").lockIntact)
    }
  }

  func testRulesOfAnotherPhoneAreNeverApplied() async throws {
    try await onMain {
      let rig = Rig()
      let r = rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: "00000000-0000-4000-8000-000000000999", selection: nil)
      XCTAssertNil(r.rulesEtag)
      XCTAssertEqual(rig.screenTime.applied.count, 0)
      XCTAssertEqual(r.failedPolicies, ["rules document not for this phone: another phone id"])
    }
  }

  func testAFailedApplyIsReportedAndKeepsTheOldReceipt() async throws {
    try await onMain {
      let rig = Rig()
      rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: nil, selection: nil)
      struct Refused: Error {}
      rig.screenTime.failNextApply = Refused()
      let r = rig.engine.apply(document: try Fixture.data(), etag: "\"e2\"", expectedPhoneId: nil, selection: nil)
      XCTAssertEqual(r.rulesEtag, "\"e1\"")
      XCTAssertEqual(r.failedPolicies, ["rules could not be applied: Refused()"])
    }
  }

  func testStepsThatFailAreReportedWithTheReceipt() async throws {
    try await onMain {
      let rig = Rig()
      rig.screenTime.failedSteps = ["app selection could not be read"]
      let r = rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: nil, selection: selection)
      XCTAssertEqual(r.rulesEtag, "\"e1\"")
      XCTAssertEqual(r.failedPolicies, ["app selection could not be read"])
      XCTAssertFalse(rig.engine.status(iosVersion: "26.1").lockIntact)
    }
  }

  func testAPlanTheExtensionsCannotReadIsReported() async throws {
    try await onMain {
      let rig = Rig()
      rig.store.failSaves = true
      let r = rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: nil, selection: nil)
      XCTAssertEqual(r.failedPolicies, ["rules could not be saved for the extensions"])
    }
  }

  func testAReleasedPhoneNeverLocksAgain() async throws {
    try await onMain {
      let rig = Rig()
      let released = rig.engine.apply(document: try Fixture.edited { $0["release"] = true }, etag: "\"r\"", expectedPhoneId: nil, selection: nil)
      XCTAssertTrue(released.released)
      XCTAssertTrue(rig.screenTime.released)
      XCTAssertEqual(released.effectiveStores, [])
      let later = rig.engine.apply(document: try Fixture.data(), etag: "\"e9\"", expectedPhoneId: nil, selection: nil)
      XCTAssertEqual(later, released)
      XCTAssertEqual(rig.screenTime.applied.count, 0)
    }
  }

  func testMaintenanceLiftsTheLockAndPutsItBack() async throws {
    try await onMain {
      let rig = Rig()
      rig.engine.apply(document: try Fixture.data(), etag: "\"e1\"", expectedPhoneId: nil, selection: nil)
      let on = rig.engine.setMaintenance(true, selection: nil)
      XCTAssertTrue(on.maintenance)
      XCTAssertEqual(on.effectiveStores, [.maintenance])
      XCTAssertFalse(rig.engine.status(iosVersion: "26.1").lockIntact)
      // New rules during maintenance keep it running.
      XCTAssertTrue(rig.engine.apply(document: try Fixture.data(), etag: "\"e2\"", expectedPhoneId: nil, selection: nil).maintenance)
      let off = rig.engine.setMaintenance(false, selection: nil)
      XCTAssertFalse(off.maintenance)
      XCTAssertEqual(off.effectiveStores, [.base])
      XCTAssertTrue(rig.engine.status(iosVersion: "26.1").lockIntact)
    }
  }

  func testAuthorizationGoesThroughTheSeam() async throws {
    try await onMain {
      let fake = FakeScreenTime()
      let e = ScreenTimeEngine(applier: fake, store: MemoryPlanStore())
      XCTAssertEqual(e.authorization, .notDetermined)
      fake.authorizationAnswer = .denied
      let answer = try await e.requestAuthorization(for: .child)
      XCTAssertEqual(answer, .denied)
      XCTAssertEqual(e.authorization, .denied)
    }
  }
}
