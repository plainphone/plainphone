// SPDX-License-Identifier: Apache-2.0
//
// The named ManagedSettings stores (docs/ios/architecture.md, "The Swift Expo module"). Each rule
// kind owns one store, so lifting one (bedtime ends) never touches another (the base lock).
// The raw values are what the phone reports in `ios.effectiveStores` (IOS_STORES on the server).

public enum StoreName: String, Codable, Sendable, CaseIterable {
  /// The lock itself: the app shield, no installs or removals, locked accounts, passcode and date.
  case base
  /// School time windows (phase 2).
  case school
  /// Bedtime windows for apps (phase 2).
  case bedtime
  /// The daily limit once it is used up (phase 2).
  case limits
  /// A parent-approved maintenance unlock on the phone (parent PIN).
  case maintenance
}
