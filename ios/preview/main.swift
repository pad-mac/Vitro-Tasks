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

@MainActor func render<V: View>(_ name: String, _ size: CGSize, _ view: V) {
  for scheme in [ColorScheme.light, .dark] {
    let content =
      view
      .padding(16)
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

MainActor.assumeIsolated {
  let list = snap.views.first(where: { $0.kind == "list" })?.id ?? "all"
  render("list-medium", medium, ListWidgetView(entry: ListEntry.make(snap, view: "today", date: now, done: [], fit: 4)))
  render("list-large", large, ListWidgetView(entry: ListEntry.make(snap, view: list, date: now, done: [], fit: 12)))
  render("day-two", large, DayWidgetView(entry: ScheduleEntry(date: now, snap: snap, layout: .twoDays, done: [])))
  render("day-split", large, DayWidgetView(entry: ScheduleEntry(date: now, snap: snap, layout: .split, done: [])))
  render("week-medium", medium, WeekWidgetView(entry: WeekEntry(date: now, snap: snap, shift: 0, done: [], fit: 4)))
  render("week-large", large, WeekWidgetView(entry: WeekEntry(date: now, snap: snap, shift: 0, done: [], fit: 15)))
  print("rendered into \(out.path)")
}
