// SPDX-License-Identifier: Apache-2.0
//
// The iPhone rules document from `GET /device/rules` (`IosRules` in server/openapi.yaml,
// docs/ios/architecture.md "iOS rules document"). Decoding is lenient where the server may grow
// (unknown keys are ignored, optional keys have the server's documented defaults) and strict
// where a wrong value would make the phone looser (platform, ids, times, weekdays).

import Foundation

public enum RulesError: Error, Equatable, CustomStringConvertible {
  /// The bytes are not a JSON object of the expected shape.
  case unreadable(String)
  /// The document is for another platform or another phone.
  case notForThisPhone(String)
  /// A value is outside what the server promises.
  case invalid(String)

  public var description: String {
    switch self {
    case .unreadable(let why): return "rules document unreadable: \(why)"
    case .notForThisPhone(let why): return "rules document not for this phone: \(why)"
    case .invalid(let why): return "rules document invalid: \(why)"
    }
  }
}

/// A time of day as minutes after local midnight, parsed from the server's "HH:MM".
public struct ClockTime: Codable, Sendable, Equatable, Comparable {
  public let minutes: Int

  public init(minutes: Int) { self.minutes = minutes }

  public init?(_ text: String) {
    let parts = text.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
          let h = Int(parts[0]), let m = Int(parts[1]), (0..<24).contains(h), (0..<60).contains(m)
    else { return nil }
    minutes = h * 60 + m
  }

  public var hour: Int { minutes / 60 }
  public var minute: Int { minutes % 60 }

  public static func < (a: ClockTime, b: ClockTime) -> Bool { a.minutes < b.minutes }
}

public struct IosRulesDocument: Decodable, Sendable, Equatable {
  public struct Selection: Decodable, Sendable, Equatable {
    public let revision: String
    public let source: String
    public let updatedAt: String
  }

  public struct IosApps: Decodable, Sendable, Equatable {
    /// True: the selection is the block list. False: the apps allowed besides Apple's own.
    public let open: Bool
    public let selection: Selection?
  }

  public struct Schedule: Decodable, Sendable, Equatable {
    public let id: String
    public let kind: String
    /// ISO weekdays of the window's start, 1 = Monday ... 7 = Sunday.
    public let days: [Int]
    public let start: String
    public let end: String
  }

  public struct Limit: Decodable, Sendable, Equatable {
    public let minutes: Int
    /// ISO weekday ("1" ... "7") to minutes; overrides `minutes` on that day.
    public let days: [String: Int]

    enum CodingKeys: String, CodingKey { case minutes, days }

    public init(minutes: Int, days: [String: Int] = [:]) {
      self.minutes = minutes
      self.days = days
    }

    public init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      minutes = try c.decode(Int.self, forKey: .minutes)
      days = try c.decodeIfPresent([String: Int].self, forKey: .days) ?? [:]
    }
  }

  public struct Bonus: Decodable, Sendable, Equatable {
    /// Local date in the phone's time zone, "YYYY-MM-DD".
    public let date: String
    public let minutes: Int
  }

  public struct TimeLimits: Decodable, Sendable, Equatable {
    public let total: Limit?
    public let bonuses: [Bonus]

    enum CodingKeys: String, CodingKey { case total, bonuses }

    public init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      total = try c.decodeIfPresent(Limit.self, forKey: .total)
      bonuses = try c.decodeIfPresent([Bonus].self, forKey: .bonuses) ?? []
    }
  }

  public struct PendingChange: Decodable, Sendable, Equatable {
    public let id: String
    public let type: String
    public let effectiveAt: String?
  }

  public let phoneId: String
  public let platform: String
  public let tier: String
  public let profile: String
  public let timezone: String
  public let language: String?
  public let rulesRevision: Int
  public let pollSeconds: Int
  public let release: Bool
  /// Feature to "yes", "partial" or "no" (`Capabilities` in openapi.yaml).
  public let capabilities: [String: String]
  public let iosApps: IosApps
  public let schedules: [Schedule]
  public let timeLimits: TimeLimits?
  public let pendingChanges: [PendingChange]
  // Switches the family controls in the dashboard. Missing means on (the server's default).
  public let askMoreTimeEnabled: Bool
  public let limitWarningEnabled: Bool
  public let pinApprovalEnabled: Bool
  public let silentBedtime: Bool
  public let changeReceiptsEnabled: Bool

  enum CodingKeys: String, CodingKey {
    case phoneId, platform, tier, profile, timezone, language, rulesRevision, pollSeconds, release
    case capabilities, iosApps, schedules, timeLimits, pendingChanges
    case askMoreTimeEnabled, limitWarningEnabled, pinApprovalEnabled, silentBedtime, changeReceiptsEnabled
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    phoneId = try c.decode(String.self, forKey: .phoneId)
    platform = try c.decode(String.self, forKey: .platform)
    tier = try c.decode(String.self, forKey: .tier)
    profile = try c.decode(String.self, forKey: .profile)
    timezone = try c.decode(String.self, forKey: .timezone)
    language = try c.decodeIfPresent(String.self, forKey: .language)
    rulesRevision = try c.decode(Int.self, forKey: .rulesRevision)
    pollSeconds = try c.decode(Int.self, forKey: .pollSeconds)
    release = try c.decodeIfPresent(Bool.self, forKey: .release) ?? false
    capabilities = try c.decodeIfPresent([String: String].self, forKey: .capabilities) ?? [:]
    iosApps = try c.decode(IosApps.self, forKey: .iosApps)
    schedules = try c.decodeIfPresent([Schedule].self, forKey: .schedules) ?? []
    timeLimits = try c.decodeIfPresent(TimeLimits.self, forKey: .timeLimits)
    pendingChanges = try c.decodeIfPresent([PendingChange].self, forKey: .pendingChanges) ?? []
    askMoreTimeEnabled = try c.decodeIfPresent(Bool.self, forKey: .askMoreTimeEnabled) ?? true
    limitWarningEnabled = try c.decodeIfPresent(Bool.self, forKey: .limitWarningEnabled) ?? true
    pinApprovalEnabled = try c.decodeIfPresent(Bool.self, forKey: .pinApprovalEnabled) ?? true
    silentBedtime = try c.decodeIfPresent(Bool.self, forKey: .silentBedtime) ?? true
    changeReceiptsEnabled = try c.decodeIfPresent(Bool.self, forKey: .changeReceiptsEnabled) ?? true
  }

  /// Decodes and checks a document. `expectedPhoneId` is the phone this app paired as; rules kept
  /// from an earlier pairing must never act on this one (docs/sync-api.md, "Releasing the phone").
  public static func parse(_ data: Data, expectedPhoneId: String?) throws -> IosRulesDocument {
    let doc: IosRulesDocument
    do {
      doc = try JSONDecoder().decode(IosRulesDocument.self, from: data)
    } catch let error as DecodingError {
      throw RulesError.unreadable(Self.describe(error))
    } catch {
      throw RulesError.unreadable(String(describing: error))
    }
    try doc.validate(expectedPhoneId: expectedPhoneId)
    return doc
  }

  func validate(expectedPhoneId: String?) throws {
    guard platform == "ios" else { throw RulesError.notForThisPhone("platform \(platform)") }
    if let expectedPhoneId, expectedPhoneId != phoneId { throw RulesError.notForThisPhone("another phone id") }
    guard !phoneId.isEmpty else { throw RulesError.invalid("empty phone id") }
    guard pollSeconds > 0 else { throw RulesError.invalid("pollSeconds \(pollSeconds)") }
    for s in schedules {
      guard !s.days.isEmpty, s.days.allSatisfy({ (1...7).contains($0) }) else {
        throw RulesError.invalid("schedule \(s.id) days")
      }
      guard ClockTime(s.start) != nil, ClockTime(s.end) != nil else {
        throw RulesError.invalid("schedule \(s.id) times")
      }
    }
    if let limits = timeLimits {
      if let total = limits.total {
        guard (0...1440).contains(total.minutes) else { throw RulesError.invalid("daily limit") }
        for (day, minutes) in total.days {
          guard let d = Int(day), (1...7).contains(d), (0...1440).contains(minutes) else {
            throw RulesError.invalid("daily limit for day \(day)")
          }
        }
      }
      for b in limits.bonuses where b.minutes < 0 || b.minutes > 1440 {
        throw RulesError.invalid("bonus on \(b.date)")
      }
    }
  }

  private static func describe(_ error: DecodingError) -> String {
    switch error {
    case .keyNotFound(let key, _): return "missing \(key.stringValue)"
    case .typeMismatch(_, let ctx), .valueNotFound(_, let ctx), .dataCorrupted(let ctx):
      let path = ctx.codingPath.map(\.stringValue).joined(separator: ".")
      return path.isEmpty ? "not a rules document" : "bad value at \(path)"
    @unknown default: return "not a rules document"
    }
  }
}
