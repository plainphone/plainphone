// SPDX-License-Identifier: Apache-2.0
//
// What the phone reports back after applying rules (docs/sync-api.md, "Status", and
// docs/ios/architecture.md, "Receipts and status"). The app turns this into `PUT /device/status`;
// the field names match the server's, so the JSON goes through unchanged.

import Foundation

/// Family Controls authorization, as the server's `ios.authorizationStatus` spells it.
public enum AuthorizationState: Sendable, Equatable {
  case notDetermined, denied, approved
  /// A case a newer iOS adds; reported as is and never counted as approved.
  case other(String)

  public var wireValue: String {
    switch self {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .approved: return "approved"
    case .other(let raw): return String(raw.prefix(40))
    }
  }
}

/// Who the authorization is for: `.child` needs a parent's Apple Account on this phone,
/// `.individual` is an adult's own iPhone (the Myself role, later).
public enum FamilyMember: String, Sendable {
  case child, individual
}

public struct Receipt: Codable, Sendable, Equatable {
  /// ETag of the last rules applied successfully, or nil before the first.
  public var rulesEtag: String?
  /// When that ETag was first applied successfully (ISO 8601).
  public var rulesAppliedAt: Date?
  /// True when `rulesEtag` and `rulesAppliedAt` describe a successful application. A newer
  /// document that failed leaves the old ETag here and the reason in `failedPolicies`.
  public var rulesReceiptConfirmed: Bool
  public var failedPolicies: [String]
  public var effectiveStores: [StoreName]
  /// The phone has released itself (rules said `release: true`). It never locks again.
  public var released: Bool
  public var maintenance: Bool

  public init(rulesEtag: String? = nil, rulesAppliedAt: Date? = nil, rulesReceiptConfirmed: Bool = false,
              failedPolicies: [String] = [], effectiveStores: [StoreName] = [], released: Bool = false, maintenance: Bool = false) {
    self.rulesEtag = rulesEtag
    self.rulesAppliedAt = rulesAppliedAt
    self.rulesReceiptConfirmed = rulesReceiptConfirmed
    self.failedPolicies = failedPolicies
    self.effectiveStores = effectiveStores
    self.released = released
    self.maintenance = maintenance
  }
}

/// The phone's own view of its lock, before the server makes it stricter (`iosLockIntact`).
public struct StatusReport: Sendable, Equatable {
  public var receipt: Receipt
  public var authorization: AuthorizationState
  public var iosVersion: String

  public init(receipt: Receipt, authorization: AuthorizationState, iosVersion: String) {
    self.receipt = receipt
    self.authorization = authorization
    self.iosVersion = iosVersion
  }

  /// Intact only while Family Controls is approved, the base store holds, nothing failed and no
  /// maintenance runs.
  public var lockIntact: Bool {
    authorization == .approved && !receipt.released && !receipt.maintenance && receipt.failedPolicies.isEmpty &&
      receipt.effectiveStores.contains(.base)
  }

  /// The JSON the app sends: the receipt's top-level fields plus the `ios` object.
  public func json() throws -> Data {
    var failed = receipt.failedPolicies.map { String($0.prefix(200)) }
    if authorization != .approved { failed.insert("Screen Time permission is not given", at: 0) }
    let body = Body(
      lockIntact: lockIntact,
      maintenance: receipt.maintenance,
      failedPolicies: Array(failed.prefix(50)),
      rulesEtag: receipt.rulesEtag,
      rulesAppliedAt: receipt.rulesAppliedAt,
      rulesReceiptConfirmed: receipt.rulesReceiptConfirmed,
      released: receipt.released,
      ios: .init(iosVersion: String(iosVersion.prefix(40)), authorizationStatus: authorization.wireValue,
                 effectiveStores: receipt.effectiveStores.map(\.rawValue))
    )
    let e = JSONEncoder()
    e.dateEncodingStrategy = .iso8601
    e.outputFormatting = [.sortedKeys]
    return try e.encode(body)
  }

  struct Body: Encodable {
    struct Ios: Encodable {
      let iosVersion: String
      let authorizationStatus: String
      let effectiveStores: [String]
    }

    let lockIntact: Bool
    let maintenance: Bool
    let failedPolicies: [String]
    let rulesEtag: String?
    let rulesAppliedAt: Date?
    let rulesReceiptConfirmed: Bool
    let released: Bool
    let ios: Ios

    enum CodingKeys: String, CodingKey {
      case lockIntact, maintenance, failedPolicies, rulesEtag, rulesAppliedAt, rulesReceiptConfirmed, released, ios
    }

    // Explicit nulls: the server requires `rulesEtag` and `rulesAppliedAt`, null allowed.
    func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(lockIntact, forKey: .lockIntact)
      try c.encode(maintenance, forKey: .maintenance)
      try c.encode(failedPolicies, forKey: .failedPolicies)
      try c.encode(rulesEtag, forKey: .rulesEtag)
      try c.encode(rulesAppliedAt, forKey: .rulesAppliedAt)
      try c.encode(rulesReceiptConfirmed, forKey: .rulesReceiptConfirmed)
      try c.encode(released, forKey: .released)
      try c.encode(ios, forKey: .ios)
    }
  }
}
