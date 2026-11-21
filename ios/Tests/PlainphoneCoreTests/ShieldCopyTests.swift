// SPDX-License-Identifier: Apache-2.0
import Foundation
import PlainphoneCore
import XCTest

final class ShieldCopyTests: XCTestCase {
  func testEveryAppLanguageHasShieldWords() {
    XCTAssertEqual(ShieldCopy.languages, ["da", "de", "en", "nb", "sv"])
    for code in ShieldCopy.languages {
      let copy = ShieldCopy.forLanguage(code, preferred: [])
      XCTAssertFalse(copy.title.isEmpty, code)
      XCTAssertFalse(copy.subtitle.isEmpty, code)
      XCTAssertFalse(copy.close.isEmpty, code)
      XCTAssertFalse(copy.title.contains("—") || copy.subtitle.contains("—"), "no em dashes in copy (\(code))")
    }
  }

  func testTheDashboardsLanguageWinsOverThePhones() {
    XCTAssertEqual(ShieldCopy.forLanguage("da", preferred: ["de-DE"]), ShieldCopy.forLanguage("da", preferred: []))
    XCTAssertEqual(ShieldCopy.forLanguage(nil, preferred: ["de-DE", "en"]).title, "Diese App ist gerade geschlossen")
    XCTAssertEqual(ShieldCopy.forLanguage(nil, preferred: ["nn_NO"]).title, "Appen er stengt akkurat nå")
    XCTAssertEqual(ShieldCopy.forLanguage("fr", preferred: ["ja"]).title, "This app is closed for now")
  }

  func testThePlanCarriesTheLanguage() throws {
    let doc = try IosRulesDocument.parse(Fixture.edited { $0["language"] = "sv" }, expectedPhoneId: nil)
    XCTAssertEqual(RulesCompiler.compile(doc, now: Fixture.monday).language, "sv")
  }
}
