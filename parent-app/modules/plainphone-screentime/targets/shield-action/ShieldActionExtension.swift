// SPDX-License-Identifier: Apache-2.0
//
// Shield Action extension (`org.plainphone.app.shield-action`): what the shield's buttons do.
// The primary button closes the app. The secondary one ("Ask for more time", phase 2) records the
// request in the App Group for the app to send; spike (b) decides whether this extension can do more.

import Foundation
import ManagedSettings
#if canImport(PlainphoneCore)
import PlainphoneCore
#endif

final class ShieldActionExtension: ShieldActionDelegate {
  private let plans = FilePlanStore.shared(fallback: FileManager.default.temporaryDirectory)

  override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    completionHandler(respond(to: action))
  }

  override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    completionHandler(respond(to: action))
  }

  override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    completionHandler(respond(to: action))
  }

  private func respond(to action: ShieldAction) -> ShieldActionResponse {
    switch action {
    case .primaryButtonPressed:
      return .close
    case .secondaryButtonPressed:
      // TODO(spike b, docs/ios/spikes.md): post a local notification that opens the app, or send
      // the request from here if the extension may reach the network.
      try? plans.appendEvent(AppGroupEvent(kind: .moreTimeAsked, at: Date()))
      return .defer
    @unknown default:
      return .close
    }
  }
}
