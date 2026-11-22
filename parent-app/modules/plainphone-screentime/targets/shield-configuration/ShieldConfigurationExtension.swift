// SPDX-License-Identifier: Apache-2.0
//
// Shield Configuration extension (`org.plainphone.app.shield-configuration`): what a shielded app
// shows instead of itself. Plainphone's calm style, in the phone's language from the plan.
// Runs in a sandbox without network access.

import Foundation
import ManagedSettings
import ManagedSettingsUI
import UIKit
#if canImport(PlainphoneCore)
import PlainphoneCore
#endif

final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
  private let plans = FilePlanStore.shared(fallback: FileManager.default.temporaryDirectory)

  override func configuration(shielding application: Application) -> ShieldConfiguration {
    shield()
  }

  override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
    shield()
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    shield()
  }

  override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
    shield()
  }

  private func shield() -> ShieldConfiguration {
    let copy = ShieldCopy.forLanguage(plans.loadPlan()?.language)
    // TODO(spike b, docs/ios/spikes.md): a secondary "Ask for more time" button on limit shields,
    // shown only while the plan's `askMoreTime` is on. Phase 1 only shields apps that are not allowed.
    return ShieldConfiguration(
      backgroundBlurStyle: .systemThickMaterial,
      backgroundColor: .systemBackground,
      icon: UIImage(systemName: "pause.circle"),
      title: ShieldConfiguration.Label(text: copy.title, color: .label),
      subtitle: ShieldConfiguration.Label(text: copy.subtitle, color: .secondaryLabel),
      primaryButtonLabel: ShieldConfiguration.Label(text: copy.close, color: .systemBackground),
      primaryButtonBackgroundColor: .label
    )
  }
}
