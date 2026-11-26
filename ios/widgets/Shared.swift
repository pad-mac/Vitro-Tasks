// What the widgets share: the snapshot the app writes (src/lib/widgets.ts),
// the ticks they hand back, days and colours.

import SwiftUI
import WidgetKit

// MARK: - Snapshot

struct Snapshot: Decodable {
  var today: String
  var from: String
  var to: String
  var views: [ViewData]
  var days: [String: [Entry]]
}

struct ViewData: Decodable {
  var id: String
  var name: String
  var kind: String
  var color: String?
  var depth: Int
  var count: Int
  var filter: String?
  var rows: [Row]
}

struct Row: Decodable, Identifiable {
  var id: String
  var title: String
  var p: Int
  var date: String?
  var time: String?
  var first: String?
  var parent: String?
}

struct Entry: Decodable, Identifiable {
  var id: String
  var task: String
  var title: String
  var color: String?
  var start: Int?
  var end: Int?
  var deadline: Int?
  /// The description's first line (a place, say).
  var note: String?

  var timed: Bool { start != nil }
}

// MARK: - Shared folder

/// The app group of the app and its widgets. SideStore signs both with its
/// own team and renames the group ("group.app.vitro.tasks.<TEAM>"), so its
/// real name comes from the provisioning profile.
enum Store {
  static let group: String = {
    if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let start = data.range(of: Data("<?xml".utf8)),
      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
      let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil)
        as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any],
      let groups = entitlements["com.apple.security.application-groups"] as? [String],
      let group = groups.first(where: { $0.hasPrefix("group.app.vitro.tasks") }) ?? groups.first
    {
      return group
    }
    return "group.app.vitro.tasks"
  }()

  static var folder: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
  }

  /** The app's own snapshot (the widgets draw from Live's, which adds what they pulled and ticked themselves). */
  static func snapshot() -> Snapshot? {
    guard let url = folder?.appendingPathComponent("widgets.json"), let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  static func read(_ name: String) -> String {
    guard let url = folder?.appendingPathComponent(name), let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
    return text
  }

  static func write(_ name: String, _ text: String) {
    guard let url = folder?.appendingPathComponent(name) else { return }
    try? Data(text.utf8).write(to: url, options: .atomic)
  }

  private struct Action: Codable {
    var kind: String
    var id: String
    var at: Double
  }

  private static func actions() -> [Action] {
    guard let url = folder?.appendingPathComponent("actions.json"), let data = try? Data(contentsOf: url) else { return [] }
    return (try? JSONDecoder().decode([Action].self, from: data)) ?? []
  }

  /// Ticked before the app first wrote its data for the widgets (or by version 0.12.0): hidden until the app takes them over.
  static func pendingDone() -> Set<String> {
    Set(actions().filter { $0.kind == "complete" }.map(\.id))
  }

  /// Without the app's data a tick can only wait for the app (it completes the task when it comes forward).
  static func completeLater(_ id: String) {
    guard let url = folder?.appendingPathComponent("actions.json") else { return }
    var all = actions()
    guard !all.contains(where: { $0.kind == "complete" && $0.id == id }) else { return }
    all.append(Action(kind: "complete", id: id, at: Date().timeIntervalSince1970 * 1000))
    if let data = try? JSONEncoder().encode(all) { try? data.write(to: url, options: .atomic) }
  }

  // The week widget's arrows: weeks away from the current one, for a while.
  private static let defaults = UserDefaults.standard
  /// After this long the week widget is back at the current week.
  static let shiftLasts: TimeInterval = 30 * 60

  static func shiftWeek(_ by: Int) {
    let now = Date()
    let current = weekShift(at: now)
    let next = by == 0 ? 0 : min(4, max(-1, current + by))
    defaults.set(next, forKey: "weekShift")
    defaults.set(now.timeIntervalSince1970, forKey: "weekShiftAt")
  }

  static func weekShift(at date: Date) -> Int {
    let at = defaults.double(forKey: "weekShiftAt")
    guard at > 0, date.timeIntervalSince1970 - at < shiftLasts else { return 0 }
    return defaults.integer(forKey: "weekShift")
  }

  static var weekShiftEnds: Date? {
    let at = defaults.double(forKey: "weekShiftAt")
    guard at > 0, defaults.integer(forKey: "weekShift") != 0 else { return nil }
    let end = Date(timeIntervalSince1970: at + shiftLasts)
    return end > Date() ? end : nil
  }
}

// MARK: - Days ("YYYY-MM-DD", local time, weeks from Monday)

enum Day {
  static let calendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.firstWeekday = 2
    c.timeZone = .current
    c.locale = Locale(identifier: "en_US_POSIX")
    return c
  }()

  static func key(_ date: Date) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
  }

  static func date(_ key: String) -> Date {
    let parts = key.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return Date() }
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) ?? Date()
  }

  static func add(_ key: String, _ days: Int) -> String {
    Day.key(calendar.date(byAdding: .day, value: days, to: date(key)) ?? Date())
  }

  static func diff(_ a: String, _ b: String) -> Int {
    calendar.dateComponents([.day], from: date(a), to: date(b)).day ?? 0
  }

  static func monday(_ key: String) -> String {
    // Sunday 1 … Saturday 7 → days since Monday.
    let weekday = calendar.component(.weekday, from: date(key))
    return add(key, -((weekday + 5) % 7))
  }

  static func number(_ key: String) -> Int { calendar.component(.day, from: date(key)) }

  static let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  static let monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  /// Monday first.
  static let weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  static let weekdaysShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  static let letters = ["M", "T", "W", "T", "F", "S", "S"]

  static func month(_ key: String) -> Int { calendar.component(.month, from: date(key)) - 1 }
  static func year(_ key: String) -> Int { calendar.component(.year, from: date(key)) }
  static func weekdayIndex(_ key: String) -> Int { (calendar.component(.weekday, from: date(key)) + 5) % 7 }

  static func minutes(_ date: Date) -> Int {
    let c = calendar.dateComponents([.hour, .minute], from: date)
    return (c.hour ?? 0) * 60 + (c.minute ?? 0)
  }

  static func nextMidnight(after date: Date) -> Date {
    calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: date) ?? date)
  }

  /// The date on a task row, as short as it can be for the day it is drawn.
  static func label(date: String?, time: String?, today: String) -> String {
    guard let date = date else { return "" }
    let d = diff(today, date)
    if d == 0 { return time ?? "" }
    if d == -1 { return "Yesterday" }
    if d == 1 { return "Tomorrow" }
    if d > 1 && d < 7 { return weekdaysShort[weekdayIndex(date)] }
    let text = "\(monthsShort[month(date)]) \(number(date))"
    return year(date) == year(today) ? text : "\(text), \(year(date))"
  }
}

// MARK: - Colours (the app's)

extension Color {
  init?(hex: String?) {
    guard var s = hex?.trimmingCharacters(in: .whitespaces) else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
  }
}

enum Palette {
  static func priority(_ p: Int, _ scheme: ColorScheme) -> Color {
    let dark = scheme == .dark
    switch p {
    case 3: return Color(hex: dark ? "#f0655c" : "#e0443a")!
    case 2: return Color(hex: dark ? "#f0b04a" : "#f0a22e")!
    case 1: return Color(hex: dark ? "#6f93ff" : "#4772fa")!
    default: return faint(scheme)
    }
  }

  static func red(_ scheme: ColorScheme) -> Color { Color(hex: scheme == .dark ? "#f0655c" : "#e0443a")! }
  static func faint(_ scheme: ColorScheme) -> Color { Color(hex: scheme == .dark ? "#636363" : "#a3a3a3")! }
  static func list(_ hex: String?, _ scheme: ColorScheme) -> Color { Color(hex: hex) ?? faint(scheme) }
  static func background(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color(hex: "#1c1c1e")! : .white }
  static func hairline(_ scheme: ColorScheme) -> Color { Color.primary.opacity(scheme == .dark ? 0.14 : 0.09) }
}

/// The widgets' own background, light or dark with the system.
struct WidgetBackground: View {
  @Environment(\.colorScheme) private var scheme
  var body: some View { Palette.background(scheme) }
}

/// Shown until the app has written its first snapshot.
struct OpenAppView: View {
  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "checklist").font(.system(size: 22, weight: .medium)).foregroundStyle(.secondary)
      Text("Open Vitro Tasks once to fill this widget.")
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// A tap that opens the app at a link. (The previews draw only the content:
/// ImageRenderer cannot draw links.)
struct TapLink<Content: View>: View {
  let url: URL
  let content: Content

  init(_ url: URL, @ViewBuilder content: () -> Content) {
    self.url = url
    self.content = content()
  }

  var body: some View {
    #if PREVIEW
      content
    #else
      Link(destination: url) { content }
    #endif
  }
}

enum Links {
  private static func make(_ path: String, _ items: [(String, String)]) -> URL {
    var c = URLComponents()
    c.scheme = "vitrotasks"
    c.host = path
    c.queryItems = items.map { URLQueryItem(name: $0.0, value: $0.1) }
    return c.url ?? URL(string: "vitrotasks://open")!
  }

  static func add(list: String) -> URL { make("add", [("list", list)]) }
  static func list(_ id: String) -> URL { make("list", [("id", id)]) }
  /// Opens the task inside the list or view it was tapped in, or in the calendar at its day.
  static func task(_ id: String, view: String? = nil, day: String? = nil) -> URL {
    make("task", [("id", id)] + (view.map { [("view", $0)] } ?? []) + (day.map { [("day", $0)] } ?? []))
  }
  static func calendar(day: String) -> URL { make("calendar", [("day", day)]) }
}
