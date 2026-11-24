// A list (or Today, Next 7 Days, …) with its open tasks in the app's order:
// tick them off right here, + opens the quick add for the list.

import AppIntents
import SwiftUI
import WidgetKit

private let rowHeight: CGFloat = 23
private let headerHeight: CGFloat = 24
private let headerGap: CGFloat = 7

struct ListEntry: TimelineEntry {
  let date: Date
  let view: ViewData?
  let rows: [Row]
  let count: Int
  let day: String
  let fit: Int
  var missing = false
}

struct ListProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> ListEntry {
    let rows = [
      Row(id: "a", title: "Plan the week", p: 3, date: nil, time: "09:00"),
      Row(id: "b", title: "Reply to the editors", p: 2, date: nil, time: nil),
      Row(id: "c", title: "Book the train", p: 1, date: nil, time: nil),
      Row(id: "d", title: "Water the plants", p: 0, date: nil, time: nil),
    ]
    let view = ViewData(id: "today", name: "Today", kind: "smart", color: nil, depth: 0, count: rows.count, filter: nil, rows: rows)
    return ListEntry(date: Date(), view: view, rows: rows, count: rows.count, day: Day.key(Date()), fit: fit(context))
  }

  func snapshot(for configuration: ListConfig, in context: Context) async -> ListEntry {
    Store.snapshot() == nil && context.isPreview ? placeholder(in: context) : entry(configuration, Date(), context)
  }

  func timeline(for configuration: ListConfig, in context: Context) async -> Timeline<ListEntry> {
    let now = Date()
    // Dates read "Today", "Tomorrow", overdue in red: drawn again at midnight.
    let midnight = Day.nextMidnight(after: now)
    return Timeline(entries: [entry(configuration, now, context), entry(configuration, midnight, context)], policy: .after(midnight))
  }

  private func fit(_ context: Context) -> Int {
    max(2, Int((context.displaySize.height - 32 - headerHeight - headerGap) / rowHeight))
  }

  private func entry(_ configuration: ListConfig, _ date: Date, _ context: Context) -> ListEntry {
    ListEntry.make(Store.snapshot(), view: configuration.list?.id ?? "today", date: date, done: Store.pendingDone(), fit: fit(context))
  }
}

extension ListEntry {
  /// The rows to draw on `date`: ticked ones (not yet taken over) left out,
  /// Today / Next 7 Days as they are on that day (the snapshot may be from yesterday).
  static func make(_ snap: Snapshot?, view id: String, date: Date, done: Set<String>, fit: Int) -> ListEntry {
    let day = Day.key(date)
    guard let snap = snap, let view = snap.views.first(where: { $0.id == id }) ?? snap.views.first else {
      return ListEntry(date: date, view: nil, rows: [], count: 0, day: day, fit: fit, missing: true)
    }
    let limit = view.filter == "today" ? day : view.filter == "next7" ? Day.add(day, 6) : nil
    var kept = Set<String>()
    var rows: [Row] = []
    for row in view.rows {
      if let parent = row.parent {
        if kept.contains(parent) && !done.contains(row.id) { rows.append(row) }
        continue
      }
      if done.contains(row.id) { continue }
      if let limit = limit {
        guard let first = row.first, first <= limit else { continue }
      }
      kept.insert(row.id)
      rows.append(row)
    }
    let ticked = view.rows.filter { $0.parent == nil && done.contains($0.id) }.count
    let count = limit != nil && day != snap.today ? kept.count : max(0, view.count - ticked)
    return ListEntry(date: date, view: view, rows: rows, count: count, day: day, fit: fit)
  }
}

struct ListWidgetView: View {
  let entry: ListEntry
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    if entry.missing {
      OpenAppView()
    } else if let view = entry.view {
      content(view)
    }
  }

  private func content(_ view: ViewData) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      header(view)
        .padding(.bottom, headerGap)
      if entry.rows.isEmpty {
        Text(view.filter == nil ? "No open tasks" : "Nothing left for today")
          .font(.system(size: 13))
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ForEach(entry.rows.prefix(entry.fit)) { row in
          RowView(row: row, day: entry.day, scheme: scheme)
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(Links.list(view.id))
  }

  private func header(_ view: ViewData) -> some View {
    HStack(alignment: .center, spacing: 6) {
      if let color = Color(hex: view.color) {
        Circle().fill(color).frame(width: 8, height: 8)
      }
      Text(view.name)
        .font(.system(size: 15, weight: .semibold))
        .lineLimit(1)
      Text("\(entry.count)")
        .font(.system(size: 15))
        .foregroundStyle(.secondary)
        .monospacedDigit()
      Spacer(minLength: 6)
      TapLink(Links.add(list: view.id)) {
        Image(systemName: "plus")
          .font(.system(size: 12, weight: .bold))
          .foregroundStyle(Palette.background(scheme))
          .frame(width: headerHeight, height: headerHeight)
          .background(Circle().fill(Color.primary))
      }
      .accessibilityLabel("Add a task")
    }
    .frame(height: headerHeight)
  }
}

private struct RowView: View {
  let row: Row
  let day: String
  let scheme: ColorScheme

  var body: some View {
    let overdue = (row.date ?? day) < day
    let color = Palette.priority(row.p, scheme)
    HStack(spacing: 9) {
      Button(intent: CompleteTask(id: row.id)) {
        RoundedRectangle(cornerRadius: 4.5, style: .continuous)
          .fill(color.opacity(row.p > 0 ? 0.12 : 0))
          .overlay(RoundedRectangle(cornerRadius: 4.5, style: .continuous).strokeBorder(color, lineWidth: 1.5))
          .frame(width: 16, height: 16)
          .frame(width: 16, height: rowHeight)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Complete")
      TapLink(Links.task(row.id)) {
        HStack(spacing: 6) {
          Text(row.title)
            .font(.system(size: 13.5))
            .foregroundStyle(.primary)
            .lineLimit(1)
          Spacer(minLength: 4)
          Text(Day.label(date: row.date, time: row.time, today: day))
            .font(.system(size: 12))
            .foregroundStyle(overdue ? Palette.red(scheme) : Color.secondary)
            .monospacedDigit()
            .lineLimit(1)
        }
        .frame(height: rowHeight)
        .contentShape(Rectangle())
      }
    }
    .padding(.leading, row.parent == nil ? 0 : 25)
  }
}

struct ListWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "VitroList", intent: ListConfig.self, provider: ListProvider()) { entry in
      ListWidgetView(entry: entry)
        .containerBackground(for: .widget) { WidgetBackground() }
    }
    .configurationDisplayName("List")
    .description("A list's open tasks: tick them off, or add one.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}
