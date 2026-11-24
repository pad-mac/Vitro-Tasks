// The day by the hour: today and tomorrow side by side, or today split into
// two halves (morning | afternoon, as TickTick does). All-day entries sit on
// top; the red line is now.

import AppIntents
import SwiftUI
import WidgetKit

struct ScheduleEntry: TimelineEntry {
  let date: Date
  let snap: Snapshot?
  let layout: DayLayout
  let done: Set<String>
}

struct DayProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> ScheduleEntry {
    ScheduleEntry(date: Date(), snap: nil, layout: .twoDays, done: [])
  }

  func snapshot(for configuration: DayConfig, in context: Context) async -> ScheduleEntry {
    ScheduleEntry(date: Date(), snap: await Live.shared.snapshot(), layout: configuration.layout, done: Store.pendingDone())
  }

  func timeline(for configuration: DayConfig, in context: Context) async -> Timeline<ScheduleEntry> {
    await Live.shared.refresh()
    let snap = await Live.shared.snapshot()
    let done = Store.pendingDone()
    let now = Date()
    let midnight = Day.nextMidnight(after: now)
    // Half an hour of entries, then a new timeline (with what changed on the servers meanwhile).
    let horizon = now.addingTimeInterval(30 * 60)
    // The now line moves on every quarter of an hour; at midnight the days move on.
    let quarter: TimeInterval = 15 * 60
    var dates = [now]
    var t = Date(timeIntervalSince1970: (floor(now.timeIntervalSince1970 / quarter) + 1) * quarter)
    while t < horizon && t < midnight {
      dates.append(t)
      t = t.addingTimeInterval(quarter)
    }
    if midnight <= horizon { dates.append(midnight) }
    let entries = dates.map { ScheduleEntry(date: $0, snap: snap, layout: configuration.layout, done: done) }
    return Timeline(entries: entries, policy: .atEnd)
  }
}

/// A column of hours: one day from one hour to another.
private struct Column: Identifiable {
  let day: String
  let from: Int
  let to: Int
  var id: String { "\(day)-\(from)" }
}

struct DayWidgetView: View {
  let entry: ScheduleEntry
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    if let snap = entry.snap {
      content(snap)
    } else {
      OpenAppView()
    }
  }

  private func entries(_ snap: Snapshot, _ day: String) -> [Entry] {
    (snap.days[day] ?? []).filter { !entry.done.contains($0.task) }
  }

  /// 08–22, wider when something starts earlier or ends later.
  private func hours(_ lists: [[Entry]]) -> (Int, Int) {
    var from = 8
    var to = 22
    for e in lists.joined() {
      guard let start = e.start else { continue }
      from = min(from, start / 60)
      to = max(to, Int((Double(e.end ?? start + 60) / 60).rounded(.up)))
    }
    return (max(0, from), min(24, to))
  }

  private func content(_ snap: Snapshot) -> some View {
    let today = Day.key(entry.date)
    let tomorrow = Day.add(today, 1)
    let split = entry.layout == .split
    let days = split ? [today] : [today, tomorrow]
    let (from, to) = hours(days.map { entries(snap, $0) })
    let mid = (from + to + 1) / 2
    let columns: [Column] =
      split
      ? [Column(day: today, from: from, to: mid), Column(day: today, from: mid, to: to)]
      : [Column(day: today, from: from, to: to), Column(day: tomorrow, from: from, to: to)]

    return VStack(alignment: .leading, spacing: 8) {
      if split {
        DayHeader(day: today)
        AllDayRow(day: today, entries: entries(snap, today).filter { !$0.timed }, room: 3, scheme: scheme)
      }
      HStack(alignment: .top, spacing: 12) {
        ForEach(columns) { column in
          VStack(alignment: .leading, spacing: 6) {
            if !split {
              DayHeader(day: column.day)
              AllDayRow(day: column.day, entries: entries(snap, column.day).filter { !$0.timed }, room: 1, scheme: scheme)
            }
            HourColumn(
              day: column.day,
              entries: entries(snap, column.day).filter(\.timed),
              from: column.from, to: column.to,
              now: column.day == today ? Day.minutes(entry.date) : nil,
              scheme: scheme
            )
            // Room for the first hour's label, which sits on the top line.
            .padding(.top, 5)
          }
          .frame(maxWidth: .infinity)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(Links.calendar(day: today))
  }
}

private struct DayHeader: View {
  let day: String

  var body: some View {
    HStack(alignment: .lastTextBaseline, spacing: 6) {
      Text("\(Day.number(day))")
        .font(.system(size: 24, weight: .bold))
        .monospacedDigit()
      Text(Day.weekdays[Day.weekdayIndex(day)])
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
      Spacer(minLength: 0)
    }
    .frame(height: 28)
  }
}

/// All-day entries on one line: as many as there is room for, then "+N".
private struct AllDayRow: View {
  let day: String
  let entries: [Entry]
  let room: Int
  let scheme: ColorScheme

  var body: some View {
    if !entries.isEmpty {
      HStack(spacing: 4) {
        ForEach(entries.prefix(room)) { e in
          TapLink(Links.task(e.task, day: day)) {
            Chip(entry: e, scheme: scheme, size: 11, height: 19)
          }
        }
        if entries.count > room {
          Text("+\(entries.count - room)")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .fixedSize()
        }
      }
    }
  }
}

/// Entries that overlap in time sit side by side.
private struct Placed: Identifiable {
  let entry: Entry
  let start: Int
  let end: Int
  var col = 0
  var cols = 1
  var id: String { entry.id }
}

private func place(_ entries: [Entry], from: Int, to: Int) -> [Placed] {
  let lo = from * 60
  let hi = to * 60
  var items: [Placed] = entries.compactMap { e in
    guard let s = e.start else { return nil }
    let a = max(s, lo)
    let b = min(max(e.end ?? s + 60, s + 15), hi)
    return b > a ? Placed(entry: e, start: a, end: b) : nil
  }
  items.sort { $0.start != $1.start ? $0.start < $1.start : $0.end > $1.end }
  var first = 0
  var clusterEnd = Int.min
  var colEnds: [Int] = []
  for i in items.indices {
    if items[i].start >= clusterEnd && !colEnds.isEmpty {
      for k in first..<i { items[k].cols = colEnds.count }
      first = i
      colEnds = []
    }
    if let c = colEnds.firstIndex(where: { $0 <= items[i].start }) {
      items[i].col = c
      colEnds[c] = items[i].end
    } else {
      items[i].col = colEnds.count
      colEnds.append(items[i].end)
    }
    clusterEnd = max(clusterEnd, items[i].end)
  }
  for k in first..<items.count { items[k].cols = max(1, colEnds.count) }
  return items
}

private func clock(_ minutes: Int) -> String {
  String(format: "%02d:%02d", minutes / 60 % 24, minutes % 60)
}

private struct HourColumn: View {
  let day: String
  let entries: [Entry]
  let from: Int
  let to: Int
  /// Minutes into the day, when this column is today.
  let now: Int?
  let scheme: ColorScheme

  private let gutter: CGFloat = 18

  var body: some View {
    GeometryReader { geo in
      let hourH = geo.size.height / CGFloat(max(1, to - from))
      let width = geo.size.width - gutter
      // Every hour labelled while there is room, else every other.
      let step = hourH < 24 ? 2 : 1
      ZStack(alignment: .topLeading) {
        // A line at every hour, the last one closing the column; labels on the lines, as in the app's week view.
        ForEach(from...to, id: \.self) { h in
          let y = CGFloat(h - from) * hourH
          Rectangle()
            .fill(Palette.hairline(scheme))
            .frame(width: width, height: 0.5)
            .offset(x: gutter, y: min(y, geo.size.height - 0.5))
          if (h - from) % step == 0 {
            Text(String(format: "%02d", h % 24))
              .font(.system(size: 9, weight: .medium))
              .foregroundStyle(.tertiary)
              .monospacedDigit()
              .frame(height: 11)
              .offset(x: 0, y: y - 5.5)
          }
        }
        ForEach(place(entries, from: from, to: to)) { p in
          let y = CGFloat(p.start - from * 60) / 60 * hourH
          let h = max(14, CGFloat(p.end - p.start) / 60 * hourH - 1.5)
          let w = width / CGFloat(p.cols)
          TapLink(Links.task(p.entry.task, day: day)) {
            Block(entry: p.entry, height: h, scheme: scheme)
          }
          .frame(width: max(0, w - 2), height: h)
          .offset(x: gutter + CGFloat(p.col) * w, y: y + 0.5)
        }
        if let now = now, now >= from * 60, now <= to * 60 {
          let y = CGFloat(now - from * 60) / 60 * hourH
          Rectangle()
            .fill(Palette.red(scheme))
            .frame(width: width, height: 1.5)
            .offset(x: gutter, y: y - 0.75)
          Circle()
            .fill(Palette.red(scheme))
            .frame(width: 7, height: 7)
            .offset(x: gutter - 3.5, y: y - 3.5)
        }
      }
      .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
    }
  }
}

/// An entry at a set time, as the week view draws it: a tinted block with the list colour's bar.
private struct Block: View {
  let entry: Entry
  let height: CGFloat
  let scheme: ColorScheme

  var body: some View {
    let color = Palette.list(entry.color, scheme)
    // Its own times, also where a column shows only part of it.
    let start = entry.start ?? 0
    let end = entry.end ?? start + 60
    let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
    HStack(spacing: 0) {
      Rectangle().fill(color).frame(width: 2.5)
      VStack(alignment: .leading, spacing: 0) {
        Text(entry.title)
          .font(.system(size: 10.5, weight: .medium))
          .foregroundStyle(.primary)
          .lineLimit(height >= 40 ? 2 : 1)
        if height >= 27 {
          Text(entry.deadline != nil ? "Due \(clock(start))" : "\(clock(start)) – \(clock(end))")
            .font(.system(size: 9.5))
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .lineLimit(1)
        }
      }
      .padding(.leading, 4)
      .padding(.trailing, 2)
      .padding(.top, 2)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .background(entry.deadline != nil ? Color.clear : color.opacity(scheme == .dark ? 0.3 : 0.2))
    .overlay {
      if entry.deadline != nil { shape.strokeBorder(color.opacity(0.6), lineWidth: 1) }
    }
    .clipShape(shape)
  }
}

/// An all-day entry: tinted with its list's colour (a deadline only outlined).
struct Chip: View {
  let entry: Entry
  let scheme: ColorScheme
  var size: CGFloat = 10
  var height: CGFloat = 15
  /// Cut the title at the chip's edge instead of ending it with "…" (the week's narrow columns).
  var clip = false

  var body: some View {
    let color = Palette.list(entry.color, scheme)
    let shape = RoundedRectangle(cornerRadius: 3.5, style: .continuous)
    let title = Text(entry.title)
      .font(.system(size: size, weight: .medium))
      .foregroundStyle(.primary)
      .lineLimit(1)
    Group {
      if clip {
        // The chip's size comes from its column; the title lies over it at its full length.
        Color.clear.overlay(alignment: .leading) { title.fixedSize().padding(.leading, 4) }
      } else {
        title.padding(.horizontal, 4)
      }
    }
      .frame(maxWidth: .infinity, alignment: .leading)
      .frame(height: height)
      .background(entry.deadline != nil ? Color.clear : color.opacity(scheme == .dark ? 0.32 : 0.22))
      .overlay {
        if entry.deadline != nil { shape.strokeBorder(color.opacity(0.6), lineWidth: 1) }
      }
      .clipShape(shape)
  }
}

struct DayWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "VitroDay", intent: DayConfig.self, provider: DayProvider()) { entry in
      DayWidgetView(entry: entry)
        .containerBackground(for: .widget) { WidgetBackground() }
    }
    .configurationDisplayName("Day")
    .description("Today and tomorrow by the hour, or today in two halves.")
    .supportedFamilies([.systemLarge])
  }
}
