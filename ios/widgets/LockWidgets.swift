// The lock screen's widgets (the rectangle under the clock): a list's open tasks to
// tick off, what comes next today with a time, and the next three with a time on
// any day. Drawn by the system in its own
// tint, so they have no colours and no background; system type, like the clock.

import AppIntents
import SwiftUI
import WidgetKit

/// Three rows fill the rectangle (about 72 points high).
let lockRows = 3
private let lockRowHeight: CGFloat = 22
private let lockFont: CGFloat = 15

// MARK: - A list

struct LockListView: View {
  let entry: ListEntry

  var body: some View {
    if entry.missing {
      LockNote(text: "Open Vitro Tasks once")
    } else if let view = entry.view {
      Group {
        if entry.rows.isEmpty {
          LockNote(text: view.filter == "today" ? "Nothing left for today" : "Nothing open")
        } else {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(entry.rows.prefix(lockRows)) { row in
              LockRow(row: row, view: view.id)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
      }
      .widgetURL(Links.list(view.id))
    }
  }
}

private struct LockRow: View {
  let row: Row
  let view: String

  var body: some View {
    HStack(spacing: 8) {
      Button(intent: CompleteTask(id: row.id)) {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .strokeBorder(.primary, lineWidth: 1.5)
          .frame(width: 14, height: 14)
          .frame(width: 14, height: lockRowHeight)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Complete")
      TapLink(Links.task(row.id, view: view)) {
        Text(row.title)
          .font(.system(size: lockFont))
          .lineLimit(1)
          .frame(maxWidth: .infinity, minHeight: lockRowHeight, maxHeight: lockRowHeight, alignment: .leading)
          .contentShape(Rectangle())
      }
    }
    .padding(.leading, row.parent == nil ? 0 : 18)
  }
}

// MARK: - Next with a time, today

struct NextEntry: TimelineEntry {
  let date: Date
  let day: String
  /// Running now or the next to start; nil: nothing more today.
  let item: Entry?
  var missing = false

  /// Today's timed entries (deadlines with a time too) that have not ended at `date`, first to start first.
  static func make(_ snap: Snapshot?, date: Date, done: Set<String>) -> NextEntry {
    let day = Day.key(date)
    guard let snap = snap else { return NextEntry(date: date, day: day, item: nil, missing: true) }
    let now = Day.minutes(date)
    let item = (snap.days[day] ?? [])
      .filter { e in
        guard let start = e.start, !done.contains(e.task) else { return false }
        return (e.end ?? start + 1) > now
      }
      .sorted { ($0.start ?? 0, $0.end ?? 0) < ($1.start ?? 0, $1.end ?? 0) }
      .first
    return NextEntry(date: date, day: day, item: item)
  }

  /// When the widget has to change: as each of today's entries ends, and at midnight.
  static func changes(_ snap: Snapshot?, after date: Date) -> [Date] {
    let start = Day.calendar.startOfDay(for: date)
    let ends = (snap?.days[Day.key(date)] ?? []).compactMap { e -> Date? in
      guard let s = e.start else { return nil }
      return start.addingTimeInterval(TimeInterval((e.end ?? s + 1) * 60))
    }
    return Array(Set(ends.filter { $0 > date })).sorted() + [Day.nextMidnight(after: date)]
  }
}

/// A day's entry in the snapshot (inside a provider, `Entry` means its timeline entry).
typealias DayItem = Entry

struct NextProvider: TimelineProvider {
  func placeholder(in context: Context) -> NextEntry {
    let e = DayItem(id: "a", task: "a", title: "Seminar", color: nil, start: 14 * 60, end: 16 * 60, deadline: nil, note: "Room 3.12")
    return NextEntry(date: Date(), day: Day.key(Date()), item: e)
  }

  func getSnapshot(in context: Context, completion: @escaping (NextEntry) -> Void) {
    Task {
      let snap = await Live.shared.snapshot()
      completion(snap == nil && context.isPreview ? placeholder(in: context) : NextEntry.make(snap, date: Date(), done: Store.pendingDone()))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<NextEntry>) -> Void) {
    Task {
      await Live.shared.refresh()
      let snap = await Live.shared.snapshot()
      let done = Store.pendingDone()
      let now = Date()
      // Each change today, then a new timeline within half an hour (with what changed on the servers).
      let horizon = now.addingTimeInterval(30 * 60)
      let dates = [now] + NextEntry.changes(snap, after: now).filter { $0 <= horizon }
      completion(Timeline(entries: dates.map { NextEntry.make(snap, date: $0, done: done) }, policy: .after(horizon)))
    }
  }
}

struct NextView: View {
  let entry: NextEntry

  var body: some View {
    if entry.missing {
      LockNote(text: "Open Vitro Tasks once")
    } else if let e = entry.item {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 4) {
          if e.deadline != nil {
            Image(systemName: "target").font(.system(size: lockFont - 2, weight: .semibold))
          }
          Text(Self.time(e))
            .font(.system(size: lockFont, weight: .semibold))
            .monospacedDigit()
        }
        Text(e.title)
          .font(.system(size: lockFont))
          .lineLimit(e.note == nil ? 2 : 1)
        if let note = e.note {
          Text(note)
            .font(.system(size: lockFont))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .widgetURL(Links.task(e.task, day: entry.day))
    } else {
      LockNote(text: "Nothing more scheduled today")
        .widgetURL(Links.calendar(day: entry.day))
    }
  }

  static func hm(_ m: Int) -> String { String(format: "%02d:%02d", m / 60 % 24, m % 60) }

  /// "16:00 – 17:00"; a deadline is the one time it is due.
  static func time(_ e: Entry) -> String {
    guard let start = e.start else { return "" }
    guard e.deadline == nil, let end = e.end, end > start else { return hm(start) }
    return "\(hm(start)) – \(end >= 24 * 60 ? "24:00" : hm(end))"
  }
}

// MARK: - Coming up: the next three with a time, on any day

struct UpcomingEntry: TimelineEntry {
  let date: Date
  let day: String
  /// The next timed entries (running now or still to start), with the day each is on.
  let items: [(day: String, item: Entry)]
  var missing = false

  /// Timed entries (deadlines with a time too) from now to the end of the snapshot, first to start first.
  static func make(_ snap: Snapshot?, date: Date, done: Set<String>, count: Int = lockRows) -> UpcomingEntry {
    let today = Day.key(date)
    guard let snap = snap else { return UpcomingEntry(date: date, day: today, items: [], missing: true) }
    let now = Day.minutes(date)
    var items: [(day: String, item: Entry)] = []
    var d = today
    while items.count < count && d <= snap.to {
      let timed = (snap.days[d] ?? [])
        .filter { e in
          guard let start = e.start, !done.contains(e.task) else { return false }
          return d != today || (e.end ?? start + 1) > now
        }
        .sorted { ($0.start ?? 0, $0.end ?? 0) < ($1.start ?? 0, $1.end ?? 0) }
      for e in timed where items.count < count { items.append((day: d, item: e)) }
      d = Day.add(d, 1)
    }
    return UpcomingEntry(date: date, day: today, items: items)
  }

  /// "Today", a weekday within the week ahead, else the date ("Dec 3").
  static func dayLabel(_ day: String, today: String) -> String {
    let d = Day.diff(today, day)
    if d == 0 { return "Today" }
    if d > 0 && d < 7 { return Day.weekdaysShort[Day.weekdayIndex(day)] }
    return "\(Day.monthsShort[Day.month(day)]) \(Day.number(day))"
  }
}

struct UpcomingProvider: TimelineProvider {
  func placeholder(in context: Context) -> UpcomingEntry {
    let day = Day.key(Date())
    let e = { (id: String, title: String, start: Int) in DayItem(id: id, task: id, title: title, color: nil, start: start, end: start + 60, deadline: nil, note: nil) }
    return UpcomingEntry(date: Date(), day: day, items: [(day, e("a", "Seminar", 14 * 60)), (Day.add(day, 1), e("b", "Call with the editor", 10 * 60)), (Day.add(day, 3), e("c", "Dentist", 8 * 60 + 30))])
  }

  func getSnapshot(in context: Context, completion: @escaping (UpcomingEntry) -> Void) {
    Task {
      let snap = await Live.shared.snapshot()
      completion(snap == nil && context.isPreview ? placeholder(in: context) : UpcomingEntry.make(snap, date: Date(), done: Store.pendingDone()))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<UpcomingEntry>) -> Void) {
    Task {
      await Live.shared.refresh()
      let snap = await Live.shared.snapshot()
      let done = Store.pendingDone()
      let now = Date()
      // As today's entries end, and at midnight; then a new timeline within half an hour.
      let horizon = now.addingTimeInterval(30 * 60)
      let dates = [now] + NextEntry.changes(snap, after: now).filter { $0 <= horizon }
      completion(Timeline(entries: dates.map { UpcomingEntry.make(snap, date: $0, done: done) }, policy: .after(horizon)))
    }
  }
}

struct UpcomingView: View {
  let entry: UpcomingEntry

  var body: some View {
    if entry.missing {
      LockNote(text: "Open Vitro Tasks once")
    } else if entry.items.isEmpty {
      LockNote(text: "Nothing scheduled with a time")
        .widgetURL(Links.calendar(day: entry.day))
    } else {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(entry.items.enumerated()), id: \.offset) { _, x in
          TapLink(Links.task(x.item.task, day: x.day)) {
            HStack(spacing: 6) {
              Text(UpcomingEntry.dayLabel(x.day, today: entry.day))
                .font(.system(size: lockFont, weight: .semibold))
                .frame(width: 46, alignment: .leading)
              Text(NextView.hm(x.item.start ?? 0))
                .font(.system(size: lockFont, weight: .semibold))
                .monospacedDigit()
                .frame(width: 42, alignment: .leading)
              Text(x.item.title)
                .font(.system(size: lockFont))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, minHeight: lockRowHeight, maxHeight: lockRowHeight, alignment: .leading)
            .contentShape(Rectangle())
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .widgetURL(Links.calendar(day: entry.day))
    }
  }
}

/// A line where there is nothing to list: light and subdued.
private struct LockNote: View {
  let text: String
  var body: some View {
    Text(text)
      .font(.system(size: lockFont, weight: .regular))
      .foregroundStyle(.secondary)
      .lineLimit(2)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

#if os(iOS)
  struct LockListWidget: Widget {
    var body: some WidgetConfiguration {
      AppIntentConfiguration(kind: "VitroLockList", intent: ListConfig.self, provider: ListProvider()) { entry in
        LockListView(entry: entry)
          .containerBackground(for: .widget) { Color.clear }
      }
      .configurationDisplayName("List")
      .description("A list's open tasks on the lock screen: tick them off.")
      .supportedFamilies([.accessoryRectangular])
    }
  }

  struct NextWidget: Widget {
    var body: some WidgetConfiguration {
      StaticConfiguration(kind: "VitroNext", provider: NextProvider()) { entry in
        NextView(entry: entry)
          .containerBackground(for: .widget) { Color.clear }
      }
      .configurationDisplayName("Next today")
      .description("What comes next today with a time.")
      .supportedFamilies([.accessoryRectangular])
    }
  }

  struct UpcomingWidget: Widget {
    var body: some WidgetConfiguration {
      StaticConfiguration(kind: "VitroUpcoming", provider: UpcomingProvider()) { entry in
        UpcomingView(entry: entry)
          .containerBackground(for: .widget) { Color.clear }
      }
      .configurationDisplayName("Coming up")
      .description("The next three with a time, with their day.")
      .supportedFamilies([.accessoryRectangular])
    }
  }
#endif
