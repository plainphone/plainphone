// SPDX-License-Identifier: Apache-2.0
//
// Plainphone Dev: a small native host for the Swift module and its extensions. It is not the
// Plainphone app (that is the Expo app in parent-app/, which embeds the same Swift code). It exists
// so CI can build the extensions for the simulator, and so the spikes in docs/ios/spikes.md can run
// the real code on a test iPhone from Xcode. Never use a real child's Apple Account with it.

import PlainphoneCore
import SwiftUI
import UIKit

@main
struct DevHostApp: App {
  var body: some Scene {
    WindowGroup { DevHostView() }
  }
}

@MainActor
final class DevHostModel: ObservableObject {
  @Published var authorization = "?"
  @Published var report = ""

  let engine: ScreenTimeEngine

  init() {
    #if targetEnvironment(simulator)
    // Family Controls cannot authorize in the simulator.
    let applier: ScreenTimeApplying = FakeScreenTime()
    #else
    let applier: ScreenTimeApplying = FamilyControlsApplier()
    #endif
    let fallback = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    engine = ScreenTimeEngine(applier: applier, store: FilePlanStore.shared(fallback: fallback))
    refresh()
  }

  func refresh() {
    authorization = engine.authorization.wireValue
    report = (try? engine.status(iosVersion: UIDevice.current.systemVersion).json()).map { String(decoding: $0, as: UTF8.self) } ?? ""
  }

  func authorize() async {
    _ = try? await engine.requestAuthorization(for: .child)
    refresh()
  }

  /// Applies the sample document bundled with the app (the same fixture the unit tests use).
  func applySample() {
    guard let url = Bundle.main.url(forResource: "ios-rules", withExtension: "json"), let data = try? Data(contentsOf: url) else {
      report = "ios-rules.json is missing from the app bundle"
      return
    }
    engine.apply(document: data, etag: "\"sample\"", expectedPhoneId: nil, selection: nil)
    refresh()
  }

  func release() {
    let sample = Bundle.main.url(forResource: "ios-rules", withExtension: "json").flatMap { try? Data(contentsOf: $0) }
    guard var doc = sample.flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) else { return }
    doc["release"] = true
    if let data = try? JSONSerialization.data(withJSONObject: doc) {
      engine.apply(document: data, etag: "\"release\"", expectedPhoneId: nil, selection: nil)
    }
    refresh()
  }
}

struct DevHostView: View {
  @StateObject private var model = DevHostModel()

  var body: some View {
    NavigationStack {
      List {
        Section("Screen Time permission") {
          LabeledContent("Status", value: model.authorization)
          Button("Ask for permission") { Task { await model.authorize() } }
        }
        Section("Rules") {
          Button("Apply the sample rules") { model.applySample() }
          Button("Release this phone", role: .destructive) { model.release() }
        }
        Section("Status report") {
          Text(model.report).font(.footnote.monospaced()).textSelection(.enabled)
        }
      }
      .navigationTitle("Plainphone Dev")
      .refreshable { model.refresh() }
    }
  }
}
