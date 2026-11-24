// The widgets' own sync: with the app closed they still pull what changed on
// the servers, send their ticks there, and draw from the result. The logic is
// the app's (src/widget/core.ts, bundled into core.js and run here in
// JavaScriptCore); this side does the files and the network.
//
// state.json   written by the app: its data and servers, with its positions
// pulled.json  what the widgets pulled since that state
// changes.json what was ticked here; the app takes it over when it comes
//              forward (rows land once, whether from here or the server)

import Foundation
import JavaScriptCore

actor Live {
  static let shared = Live()

  private var context: JSContext?
  private var core: JSValue?

  private func engine() -> JSValue? {
    if let core = core { return core }
    guard let url = Bundle.main.url(forResource: "core", withExtension: "js"),
      let source = try? String(contentsOf: url, encoding: .utf8),
      let context = JSContext()
    else { return nil }
    context.exceptionHandler = { _, error in
      NSLog("Vitro widgets: %@", error?.toString() ?? "error")
    }
    context.evaluateScript(source)
    guard let value = context.objectForKeyedSubscript("VitroCore"), value.isObject else { return nil }
    self.context = context
    core = value
    return value
  }

  private func call(_ name: String, _ args: [Any]) -> JSValue? {
    guard let fn = engine()?.objectForKeyedSubscript(name), fn.isObject else { return nil }
    context?.exception = nil
    let result = fn.call(withArguments: args)
    if context?.exception != nil { return nil }
    return result
  }

  private static var millis: Double { Date().timeIntervalSince1970 * 1000 }

  /// What to draw: the app's data with what was pulled and ticked here on top (else the app's own snapshot).
  func snapshot(at date: Date = Date()) -> Snapshot? {
    let state = Store.read("state.json")
    if !state.isEmpty,
      let json = call("snapshot", [state, Store.read("pulled.json"), Store.read("changes.json"), Day.key(date), date.timeIntervalSince1970 * 1000])?.toString(),
      let snap = try? JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
    {
      return snap
    }
    return Store.snapshot()
  }

  /// A round trip with every server, when one is due (something to send, or nothing pulled for a while).
  func refresh() async {
    let state = Store.read("state.json")
    guard !state.isEmpty,
      call("needsSync", [state, Store.read("pulled.json"), Store.read("changes.json"), Self.millis])?.toBool() == true
    else { return }
    await sync()
  }

  /// Ticks a task off, on the latest version of it, and sends that right away.
  func complete(_ id: String) async {
    guard !Store.read("state.json").isEmpty else { return Store.completeLater(id) }
    // Fresh first, so the tick does not undo an edit made elsewhere meanwhile.
    await sync()
    let now = Date()
    guard
      let changes = call(
        "complete", [Store.read("state.json"), Store.read("pulled.json"), Store.read("changes.json"), id, now.timeIntervalSince1970 * 1000, Day.key(now)])?.toString()
    else { return }
    Store.write("changes.json", changes)
    await sync()
  }

  private struct Request: Decodable {
    let server: String
    let url: String
    let token: String
    let body: String
  }

  /// The two files' new texts.
  private struct Received: Decodable {
    let pulled: String
    let changes: String
  }

  private func sync() async {
    guard let json = call("requests", [Store.read("state.json"), Store.read("pulled.json"), Store.read("changes.json")])?.toString(),
      let requests = try? JSONDecoder().decode([Request].self, from: Data(json.utf8))
    else { return }
    for r in requests {
      guard let url = URL(string: r.url) else { continue }
      var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.setValue("Bearer \(r.token)", forHTTPHeaderField: "authorization")
      request.httpBody = Data(r.body.utf8)
      guard let (data, response) = try? await URLSession.shared.data(for: request),
        (response as? HTTPURLResponse)?.statusCode == 200,
        let answer = String(data: data, encoding: .utf8)
      else { continue }
      // Read again: the app may have written its data meanwhile.
      guard
        let out = call(
          "received", [Store.read("state.json"), Store.read("pulled.json"), Store.read("changes.json"), r.server, r.body, answer, Self.millis])?.toString(),
        let parsed = try? JSONDecoder().decode(Received.self, from: Data(out.utf8))
      else { continue }
      Store.write("pulled.json", parsed.pulled)
      Store.write("changes.json", parsed.changes)
    }
  }
}
