// Pictures of the widgets, light and dark, from a sample snapshot (sample.json,
// the demo data): built and run on the CI's Mac for branches named ios-…,
// to look at a layout without a phone. Usage: render sample.json out-dir

import AppKit
import SwiftUI

let args = CommandLine.arguments
let snap = try! JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let out = URL(fileURLWithPath: args[2], isDirectory: true)
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let parts = snap.today.split(separator: "-").compactMap { Int($0) }
// 10:40 on the snapshot's day, for the now line.
let now = Day.calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 10, minute: 40))!

// An iPhone 15 / 16 Pro's widget sizes (points).
let medium = CGSize(width: 338, height: 158)
let large = CGSize(width: 338, height: 354)

/// `margins`: the system's own content margins (widgets that set their own leave them out).
@MainActor func render<V: View>(_ name: String, _ size: CGSize, margins: Bool = true, _ view: V) {
  for scheme in [ColorScheme.light, .dark] {
    let content =
      view
      .padding(margins ? 16 : 0)
      .frame(width: size.width, height: size.height)
      .background(Palette.background(scheme))
      .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
      .padding(24)
      .background(scheme == .dark ? Color(white: 0.22) : Color(white: 0.86))
      .environment(\.colorScheme, scheme)
    let renderer = ImageRenderer(content: content)
    renderer.scale = 2
    guard let image = renderer.cgImage,
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else {
      print("could not render \(name)")
      continue
    }
    try? png.write(to: out.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
  }
}

@MainActor func renderLock<V: View>(_ name: String, _ size: CGSize, _ view: V) {
  let content =
    view
    .frame(width: size.width, height: size.height)
    .overlay(Rectangle().strokeBorder(Color.white.opacity(0.15), style: StrokeStyle(lineWidth: 0.5, dash: [3])))
    .padding(24)
    .background(Color(white: 0.1))
    .foregroundStyle(Color.white.opacity(0.92))
    .environment(\.colorScheme, .dark)
  let renderer = ImageRenderer(content: content)
  renderer.scale = 3
  guard let image = renderer.cgImage, let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
    print("could not render \(name)")
    return
  }
  try? png.write(to: out.appendingPathComponent("\(name).png"))
}

MainActor.assumeIsolated {
  let list = snap.views.first(where: { $0.kind == "list" })?.id ?? "all"
  // Rows and chips that fit, as the providers work them out from these sizes.
  render("list-medium", medium, margins: false, ListWidgetView(entry: ListEntry.make(snap, view: "today", date: now, done: [], fit: 5)))
  render("list-large", large, margins: false, ListWidgetView(entry: ListEntry.make(snap, view: list, date: now, done: [], fit: 14)))
  render("day-two", large, DayWidgetView(entry: ScheduleEntry(date: now, snap: snap, layout: .twoDays, done: [])))
  render("day-split", large, DayWidgetView(entry: ScheduleEntry(date: now, snap: snap, layout: .split, done: [])))
  let weekM = WeekProvider.fit(height: medium.height)
  let weekL = WeekProvider.fit(height: large.height)
  render("week-medium", medium, margins: false, WeekWidgetView(entry: WeekEntry(date: now, snap: snap, shift: 0, done: [], fit: weekM.all, fitWithMore: weekM.withMore)))
  render("week-large", large, margins: false, WeekWidgetView(entry: WeekEntry(date: now, snap: snap, shift: 0, done: [], fit: weekL.all, fitWithMore: weekL.withMore)))
  // The lock screen's rectangle (iPhone 15 / 16 Pro: 160 × 72), white on a dark wallpaper as the system tints it.
  let lock = CGSize(width: 160, height: 72)
  renderLock("lock-list", lock, LockListView(entry: ListEntry.make(snap, view: list, date: now, done: [], fit: lockRows)))
  renderLock("lock-today", lock, LockListView(entry: ListEntry.make(snap, view: "today", date: now, done: [], fit: lockRows)))
  renderLock("lock-next", lock, NextView(entry: NextEntry.make(snap, date: now, done: [])))
  let late = Day.calendar.date(bySettingHour: 23, minute: 30, second: 0, of: now)!
  renderLock("lock-next-empty", lock, NextView(entry: NextEntry.make(snap, date: late, done: [])))
  print("rendered into \(out.path)")
}
