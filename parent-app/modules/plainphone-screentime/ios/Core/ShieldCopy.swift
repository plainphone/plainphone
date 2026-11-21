// SPDX-License-Identifier: Apache-2.0
//
// The words on a shield. The Shield Configuration extension has no React Native and no i18n
// files, so its copy lives here in the app's five languages (da, en, sv, nb, de). Short and calm:
// the child should know why the app is closed and that the parents decide.

import Foundation

public struct ShieldCopy: Sendable, Equatable {
  public let title: String
  public let subtitle: String
  public let close: String

  static let all: [String: ShieldCopy] = [
    "en": .init(title: "This app is closed for now", subtitle: "Your parents choose which apps are open on this phone.", close: "OK"),
    "da": .init(title: "Appen er lukket lige nu", subtitle: "Dine forældre vælger, hvilke apps der er åbne på denne telefon.", close: "OK"),
    "sv": .init(title: "Appen är stängd just nu", subtitle: "Dina föräldrar väljer vilka appar som är öppna på den här telefonen.", close: "OK"),
    "nb": .init(title: "Appen er stengt akkurat nå", subtitle: "Foreldrene dine velger hvilke apper som er åpne på denne telefonen.", close: "OK"),
    "de": .init(title: "Diese App ist gerade geschlossen", subtitle: "Deine Eltern wählen, welche Apps auf diesem Handy offen sind.", close: "OK"),
  ]

  public static let languages = all.keys.sorted()

  /// The copy for the rules document's `language`, else the phone's preferred languages, else English.
  public static func forLanguage(_ language: String?, preferred: [String] = Locale.preferredLanguages) -> ShieldCopy {
    for tag in [language].compactMap({ $0 }) + preferred {
      let code = String(tag.lowercased().prefix { $0 != "-" && $0 != "_" })
      // Norwegian: "no" and "nn" read Bokmål well enough.
      if let copy = all[code == "no" || code == "nn" ? "nb" : code] { return copy }
    }
    return all["en"]!
  }
}
