// SPDX-License-Identifier: Apache-2.0
//
// The shared container of the app and its extensions (`group.org.plainphone.app`). The app
// writes the compiled plan and the last receipt; the extensions read the plan and append events
// (a shield's "Ask for more time", a monitor's interval start) that the app reads on its next
// run. Extensions never talk to the network (docs/ios/architecture.md, "Targets").

import Foundation

public enum AppGroup {
  /// Must match the App Group entitlement of every target.
  public static let identifier = "group.org.plainphone.app"

  /// The shared container, or nil when the entitlement is missing (unsigned simulator builds).
  public static func containerURL() -> URL? {
    #if canImport(Darwin)
    return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    #else
    return nil
    #endif
  }
}

/// Something an extension recorded for the app to act on.
public struct AppGroupEvent: Codable, Sendable, Equatable {
  public enum Kind: String, Codable, Sendable {
    /// The child tapped "Ask for more time" on a shield (spike (b) in docs/ios/spikes.md).
    case moreTimeAsked
    /// The monitor started or ended a window.
    case intervalStarted, intervalEnded
    /// An extension could not apply what the plan says.
    case failed
  }

  public var kind: Kind
  public var at: Date
  public var detail: String?

  public init(kind: Kind, at: Date, detail: String? = nil) {
    self.kind = kind
    self.at = at
    self.detail = detail
  }
}

public protocol PlanStoring: AnyObject {
  func loadPlan() -> CompiledPlan?
  func savePlan(_ plan: CompiledPlan) throws
  func loadReceipt() -> Receipt?
  func saveReceipt(_ receipt: Receipt) throws
  func appendEvent(_ event: AppGroupEvent) throws
  /// Returns the events recorded so far and removes them.
  func takeEvents() throws -> [AppGroupEvent]
}

/// Plan, receipt and events as JSON files in one directory (the App Group container in the app).
public final class FilePlanStore: PlanStoring {
  private let directory: URL
  private let fm = FileManager.default

  public init(directory: URL) {
    self.directory = directory
  }

  /// The store in the App Group, or in `fallback` when the container is not available.
  public static func shared(fallback: URL) -> FilePlanStore {
    FilePlanStore(directory: (AppGroup.containerURL() ?? fallback).appendingPathComponent("plainphone", isDirectory: true))
  }

  private var planURL: URL { directory.appendingPathComponent("plan.json") }
  private var receiptURL: URL { directory.appendingPathComponent("receipt.json") }
  private var eventsURL: URL { directory.appendingPathComponent("events.json") }

  private static func encoder() -> JSONEncoder {
    let e = JSONEncoder()
    e.dateEncodingStrategy = .iso8601
    e.outputFormatting = [.sortedKeys]
    return e
  }

  private static func decoder() -> JSONDecoder {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .iso8601
    return d
  }

  private func write<T: Encodable>(_ value: T, to url: URL) throws {
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    try Self.encoder().encode(value).write(to: url, options: .atomic)
  }

  private func read<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? Self.decoder().decode(type, from: data)
  }

  public func loadPlan() -> CompiledPlan? { read(CompiledPlan.self, from: planURL) }
  public func savePlan(_ plan: CompiledPlan) throws { try write(plan, to: planURL) }
  public func loadReceipt() -> Receipt? { read(Receipt.self, from: receiptURL) }
  public func saveReceipt(_ receipt: Receipt) throws { try write(receipt, to: receiptURL) }

  public func appendEvent(_ event: AppGroupEvent) throws {
    // Bounded, so an extension that fires often cannot fill the container.
    let events = (read([AppGroupEvent].self, from: eventsURL) ?? []) + [event]
    try write(Array(events.suffix(100)), to: eventsURL)
  }

  public func takeEvents() throws -> [AppGroupEvent] {
    let events = read([AppGroupEvent].self, from: eventsURL) ?? []
    if fm.fileExists(atPath: eventsURL.path) { try fm.removeItem(at: eventsURL) }
    return events
  }
}

/// In memory, for tests and previews.
public final class MemoryPlanStore: PlanStoring {
  public var plan: CompiledPlan?
  public var receipt: Receipt?
  public var events: [AppGroupEvent] = []
  public var failSaves = false

  public init() {}

  struct SaveFailed: Error {}

  public func loadPlan() -> CompiledPlan? { plan }
  public func savePlan(_ plan: CompiledPlan) throws {
    if failSaves { throw SaveFailed() }
    self.plan = plan
  }
  public func loadReceipt() -> Receipt? { receipt }
  public func saveReceipt(_ receipt: Receipt) throws {
    if failSaves { throw SaveFailed() }
    self.receipt = receipt
  }
  public func appendEvent(_ event: AppGroupEvent) throws { events.append(event) }
  public func takeEvents() throws -> [AppGroupEvent] {
    defer { events = [] }
    return events
  }
}
