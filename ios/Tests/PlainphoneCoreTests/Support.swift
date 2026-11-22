// SPDX-License-Identifier: Apache-2.0
import Foundation
import XCTest

enum Fixture {
  static let phoneId = "00000000-0000-4000-8000-000000000001"

  /// ios/Tests/Fixtures, read from the source tree (the simulator can read the Mac's files), so the
  /// same file serves the server's contract test (server/test/ios-contract.test.ts).
  static func url(_ name: String) -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("Fixtures").appendingPathComponent(name)
  }

  static func data(_ name: String = "ios-rules.json") throws -> Data {
    try Data(contentsOf: url(name))
  }

  /// The fixture as a dictionary, to change one field and encode it again.
  static func object() throws -> [String: Any] {
    try XCTUnwrap(try JSONSerialization.jsonObject(with: data()) as? [String: Any])
  }

  static func edited(_ change: (inout [String: Any]) -> Void) throws -> Data {
    var doc = try object()
    change(&doc)
    return try JSONSerialization.data(withJSONObject: doc)
  }

  /// Monday 16 November 2026, 12:00 UTC: the date the server's test clock wrote into the fixture.
  static let monday = Date(timeIntervalSince1970: 1_794_830_400)
}
