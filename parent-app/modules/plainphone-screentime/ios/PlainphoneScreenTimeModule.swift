// SPDX-License-Identifier: Apache-2.0
//
// The Expo module the React Native app calls (docs/ios/architecture.md, "The Swift Expo module").
// A thin bridge: every decision lives in Core/, which the xcodegen project in ios/ unit tests.
// Values cross the bridge as JSON strings, decoded on the JS side by modules/plainphone-screentime.
// This file is compiled by the Expo build only (it needs ExpoModulesCore), not by the ios CI job.

import ExpoModulesCore
import UIKit

@MainActor
private enum Shared {
  static let engine = ScreenTimeEngine(
    applier: FamilyControlsApplier(),
    store: FilePlanStore.shared(fallback: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0])
  )

  static func statusJSON() throws -> String {
    String(decoding: try engine.status(iosVersion: UIDevice.current.systemVersion).json(), as: UTF8.self)
  }
}

struct NotYetError: Error, CustomStringConvertible {
  let description: String
}

public class PlainphoneScreenTimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PlainphoneScreenTime")

    AsyncFunction("authorizationStatus") { () async -> String in
      await MainActor.run { Shared.engine.authorization.wireValue }
    }

    AsyncFunction("requestAuthorization") { (kind: String) async throws -> String in
      let member: FamilyMember = kind == "individual" ? .individual : .child
      let state = try await Task { @MainActor in try await Shared.engine.requestAuthorization(for: member) }.value
      return state.wireValue
    }

    // Returns the status report (StatusReport.json) after applying.
    AsyncFunction("applyRules") { (document: String, etag: String, phoneId: String?, selection: String?) async throws -> String in
      try await MainActor.run {
        Shared.engine.apply(
          document: Data(document.utf8),
          etag: etag,
          expectedPhoneId: phoneId,
          selection: selection.flatMap { Data(base64Encoded: $0) }
        )
        return try Shared.statusJSON()
      }
    }

    AsyncFunction("setMaintenance") { (on: Bool, selection: String?) async throws -> String in
      try await MainActor.run {
        Shared.engine.setMaintenance(on, selection: selection.flatMap { Data(base64Encoded: $0) })
        return try Shared.statusJSON()
      }
    }

    AsyncFunction("beginNewPairing") { () async throws -> String in
      try await MainActor.run {
        Shared.engine.beginNewPairing()
        return try Shared.statusJSON()
      }
    }

    AsyncFunction("status") { () async throws -> String in
      try await MainActor.run { try Shared.statusJSON() }
    }

    // TODO(spike a, docs/ios/spikes.md): FamilyActivityPicker as a SwiftUI sheet, returning the
    // encoded selection as base64. Phase 1 picks on the child's phone after the parent PIN.
    AsyncFunction("pickActivities") { () async throws -> String in
      throw NotYetError(description: "picking apps comes with spike (a)")
    }

    // TODO(phase 3): the Location Push Service extension and its APNs token.
    AsyncFunction("startLocationPushes") { () async throws -> String in
      throw NotYetError(description: "location pushes come in phase 3")
    }
  }
}
