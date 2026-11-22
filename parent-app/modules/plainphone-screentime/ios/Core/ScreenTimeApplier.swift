// SPDX-License-Identifier: Apache-2.0
//
// The seam between the plan and Apple's frameworks. `FamilyControlsApplier` is the real one;
// `FakeScreenTime` records what it was asked to do, for unit tests and simulator runs (Family
// Controls cannot authorize in the simulator). Parts that wait for a spike on a real iPhone say
// so with a TODO pointing to docs/ios/spikes.md.

import Foundation

public struct ApplyOutcome: Sendable, Equatable {
  public var effectiveStores: [StoreName]
  /// Steps that could not be applied. Non-empty never means the phone got looser: a failing step
  /// leaves what was in place before.
  public var failed: [String]

  public init(effectiveStores: [StoreName], failed: [String] = []) {
    self.effectiveStores = effectiveStores
    self.failed = failed
  }
}

@MainActor
public protocol ScreenTimeApplying: AnyObject {
  var authorization: AuthorizationState { get }
  func requestAuthorization(for member: FamilyMember) async throws -> AuthorizationState
  /// Puts the plan's stores in effect. `selection` is Apple's encoded FamilyActivitySelection
  /// from `GET /device/ios-selection`, or nil before anyone picked apps.
  func apply(_ plan: CompiledPlan, selection: Data?) throws -> ApplyOutcome
  /// Lifts the base shield for a parent-approved maintenance window, or puts it back.
  func setMaintenance(_ on: Bool, plan: CompiledPlan, selection: Data?) throws -> ApplyOutcome
  /// Clears every store and stops every monitored window. The phone never locks again.
  func releaseAll() throws
}

@MainActor
public final class FakeScreenTime: ScreenTimeApplying {
  public var authorization: AuthorizationState
  public private(set) var applied: [CompiledPlan] = []
  public private(set) var selections: [Data?] = []
  public private(set) var released = false
  public private(set) var maintenance = false
  public private(set) var stores: Set<StoreName> = []
  /// Set to make the next `apply` throw, as if ManagedSettings refused.
  public var failNextApply: Error?
  /// Steps `apply` reports as failed (for example "app selection could not be read").
  public var failedSteps: [String] = []
  public var authorizationAnswer: AuthorizationState = .approved

  public init(authorization: AuthorizationState = .notDetermined) {
    self.authorization = authorization
  }

  public func requestAuthorization(for member: FamilyMember) async throws -> AuthorizationState {
    authorization = authorizationAnswer
    return authorization
  }

  public func apply(_ plan: CompiledPlan, selection: Data?) throws -> ApplyOutcome {
    if let error = failNextApply {
      failNextApply = nil
      throw error
    }
    applied.append(plan)
    selections.append(selection)
    stores = maintenance ? [.maintenance] : Set(plan.stores)
    return ApplyOutcome(effectiveStores: StoreName.allCases.filter(stores.contains), failed: failedSteps)
  }

  public func setMaintenance(_ on: Bool, plan: CompiledPlan, selection: Data?) throws -> ApplyOutcome {
    maintenance = on
    return try apply(plan, selection: selection)
  }

  public func releaseAll() throws {
    released = true
    stores = []
  }
}
