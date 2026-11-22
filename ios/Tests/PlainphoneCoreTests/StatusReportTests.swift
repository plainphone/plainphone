// SPDX-License-Identifier: Apache-2.0
import Foundation
import PlainphoneCore
import XCTest

final class StatusReportTests: XCTestCase {
  private func json(_ report: StatusReport) throws -> [String: Any] {
    try XCTUnwrap(try JSONSerialization.jsonObject(with: report.json()) as? [String: Any])
  }

  private let applied = Receipt(rulesEtag: "\"e1\"", rulesAppliedAt: Fixture.monday, rulesReceiptConfirmed: true, effectiveStores: [.base])

  func testAnAppliedLockReportsIntactWithTheIosObject() throws {
    let body = try json(StatusReport(receipt: applied, authorization: .approved, iosVersion: "26.1"))
    XCTAssertEqual(body["lockIntact"] as? Bool, true)
    XCTAssertEqual(body["maintenance"] as? Bool, false)
    XCTAssertEqual(body["failedPolicies"] as? [String], [])
    XCTAssertEqual(body["rulesEtag"] as? String, "\"e1\"")
    XCTAssertEqual(body["rulesAppliedAt"] as? String, "2026-11-16T12:00:00Z")
    XCTAssertEqual(body["rulesReceiptConfirmed"] as? Bool, true)
    let ios = try XCTUnwrap(body["ios"] as? [String: Any])
    XCTAssertEqual(ios["iosVersion"] as? String, "26.1")
    XCTAssertEqual(ios["authorizationStatus"] as? String, "approved")
    XCTAssertEqual(ios["effectiveStores"] as? [String], ["base"])
  }

  func testRequiredNullsAreSentAsNull() throws {
    let body = try json(StatusReport(receipt: Receipt(), authorization: .notDetermined, iosVersion: "26.1"))
    XCTAssertTrue(body["rulesEtag"] is NSNull)
    XCTAssertTrue(body["rulesAppliedAt"] is NSNull)
  }

  func testWithoutScreenTimePermissionTheLockIsNotIntactAndSaysWhy() throws {
    for state in [AuthorizationState.notDetermined, .denied, .other("approvedWithLimits")] {
      let report = StatusReport(receipt: applied, authorization: state, iosVersion: "26.1")
      XCTAssertFalse(report.lockIntact, state.wireValue)
      let body = try json(report)
      XCTAssertEqual(body["failedPolicies"] as? [String], ["Screen Time permission is not given"])
      XCTAssertEqual((body["ios"] as? [String: Any])?["authorizationStatus"] as? String, state.wireValue)
    }
  }

  func testNothingInEffectIsNotIntact() {
    XCTAssertFalse(StatusReport(receipt: Receipt(), authorization: .approved, iosVersion: "26.1").lockIntact)
  }

  func testLongValuesAreCutToWhatTheServerTakes() throws {
    var receipt = applied
    receipt.failedPolicies = (0..<60).map { _ in String(repeating: "x", count: 300) }
    let body = try json(StatusReport(receipt: receipt, authorization: .other(String(repeating: "y", count: 99)), iosVersion: String(repeating: "9", count: 50)))
    let failed = try XCTUnwrap(body["failedPolicies"] as? [String])
    XCTAssertEqual(failed.count, 50)
    XCTAssertTrue(failed.allSatisfy { $0.count <= 200 })
    let ios = try XCTUnwrap(body["ios"] as? [String: Any])
    XCTAssertEqual((ios["iosVersion"] as? String)?.count, 40)
    XCTAssertEqual((ios["authorizationStatus"] as? String)?.count, 40)
  }
}

final class FilePlanStoreTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: dir)
  }

  func testKeepsThePlanAndReceiptForTheExtensions() throws {
    let store = FilePlanStore(directory: dir)
    XCTAssertNil(store.loadPlan())
    let plan = RulesCompiler.compile(try IosRulesDocument.parse(Fixture.data(), expectedPhoneId: nil), now: Fixture.monday)
    try store.savePlan(plan)
    let receipt = Receipt(rulesEtag: "\"e1\"", rulesAppliedAt: Fixture.monday, rulesReceiptConfirmed: true, effectiveStores: [.base])
    try store.saveReceipt(receipt)
    // Another process (an extension) opening the same directory sees the same plan.
    let other = FilePlanStore(directory: dir)
    XCTAssertEqual(other.loadPlan(), plan)
    XCTAssertEqual(other.loadReceipt(), receipt)
  }

  func testEventsAreTakenOnceAndBounded() throws {
    let store = FilePlanStore(directory: dir)
    for i in 0..<105 {
      try store.appendEvent(AppGroupEvent(kind: .moreTimeAsked, at: Fixture.monday.addingTimeInterval(Double(i))))
    }
    let events = try store.takeEvents()
    XCTAssertEqual(events.count, 100)
    XCTAssertEqual(events.first?.at, Fixture.monday.addingTimeInterval(5), "the oldest go first")
    XCTAssertEqual(try store.takeEvents(), [])
  }
}
