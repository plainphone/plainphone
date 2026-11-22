// SPDX-License-Identifier: Apache-2.0
//
// One rules sync on the phone: check the document, compile it, apply it, save the plan for the
// extensions and keep the receipt. The rule from docs/ios/architecture.md: an invalid document or
// a failed apply leaves the old stores in place, so an error never makes the phone looser, and the
// receipt says what failed instead of claiming success.

import Foundation

@MainActor
public final class ScreenTimeEngine {
  private let applier: ScreenTimeApplying
  private let store: PlanStoring
  private let now: () -> Date

  public init(applier: ScreenTimeApplying, store: PlanStoring, now: @escaping () -> Date = Date.init) {
    self.applier = applier
    self.store = store
    self.now = now
  }

  public var authorization: AuthorizationState { applier.authorization }

  public func requestAuthorization(for member: FamilyMember) async throws -> AuthorizationState {
    try await applier.requestAuthorization(for: member)
  }

  /// The receipt so far (nothing applied yet: an empty one).
  public var receipt: Receipt { store.loadReceipt() ?? Receipt() }

  public var plan: CompiledPlan? { store.loadPlan() }

  /// Applies a document fetched with `etag`. `expectedPhoneId` is the phone this app paired as.
  @discardableResult
  public func apply(document: Data, etag: String, expectedPhoneId: String?, selection: Data?) -> Receipt {
    var receipt = self.receipt
    // A released phone never locks again, whatever a later document says.
    if receipt.released { return receipt }

    let doc: IosRulesDocument
    do {
      doc = try IosRulesDocument.parse(document, expectedPhoneId: expectedPhoneId)
    } catch {
      return keepOld(&receipt, failure: String(describing: error))
    }
    let plan = RulesCompiler.compile(doc, now: now())

    let outcome: ApplyOutcome
    do {
      if plan.released {
        try applier.releaseAll()
        outcome = ApplyOutcome(effectiveStores: [])
      } else if receipt.maintenance {
        outcome = try applier.setMaintenance(true, plan: plan, selection: selection)
      } else {
        outcome = try applier.apply(plan, selection: selection)
      }
    } catch {
      return keepOld(&receipt, failure: "rules could not be applied: \(error)")
    }

    var failed = plan.skipped + outcome.failed
    do {
      try store.savePlan(plan)
    } catch {
      failed.append("rules could not be saved for the extensions")
    }
    // The first time this ETag applied, kept across re-applies of the same document.
    let appliedAt = receipt.rulesEtag == etag && receipt.rulesReceiptConfirmed ? (receipt.rulesAppliedAt ?? now()) : now()
    receipt = Receipt(
      rulesEtag: etag,
      rulesAppliedAt: appliedAt,
      rulesReceiptConfirmed: true,
      failedPolicies: failed,
      effectiveStores: outcome.effectiveStores,
      released: plan.released,
      maintenance: receipt.maintenance && !plan.released
    )
    try? store.saveReceipt(receipt)
    return receipt
  }

  /// Starts or ends a parent-approved maintenance window. The parent PIN is checked before this.
  @discardableResult
  public func setMaintenance(_ on: Bool, selection: Data?) -> Receipt {
    var receipt = self.receipt
    guard !receipt.released, let plan = store.loadPlan() else { return receipt }
    do {
      let outcome = try applier.setMaintenance(on, plan: plan, selection: selection)
      receipt.maintenance = on
      receipt.effectiveStores = outcome.effectiveStores
      receipt.failedPolicies = plan.skipped + outcome.failed
    } catch {
      receipt.failedPolicies = ["maintenance could not \(on ? "start" : "end"): \(error)"]
    }
    try? store.saveReceipt(receipt)
    return receipt
  }

  /// A new pairing succeeded (after a release, or after the phone was removed from the dashboard).
  /// Forgets the old receipt, so the new rules apply; stores in effect stay until they do.
  public func beginNewPairing() {
    try? store.saveReceipt(Receipt())
  }

  public func status(iosVersion: String) -> StatusReport {
    StatusReport(receipt: receipt, authorization: applier.authorization, iosVersion: iosVersion)
  }

  /// The old ETag stays: it still names the rules in effect, and the server sees it is not the newest.
  private func keepOld(_ receipt: inout Receipt, failure: String) -> Receipt {
    receipt.failedPolicies = [failure]
    try? store.saveReceipt(receipt)
    return receipt
  }
}
