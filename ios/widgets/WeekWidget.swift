// The week at a glance: seven columns, each headed by its letter and date on
// one line ("M 24", to save height), with the day's entries as chips. The
// arrows page through the weeks; the month name goes back to this week.

import AppIntents
import SwiftUI
import WidgetKit

private let titleHeight: CGFloat = 24
private let dayHeight: CGFloat = 19
private let chipHeight: CGFloat = 15
private let chipGap: CGFloat = 2

struct WeekEntry: TimelineEntry {
  let date: Date
  let snap: Snapshot?
  let shift: Int
  let done: Set<String>
  /// Chips that fit under a day.
  let fit: Int
}

struct WeekProvider: TimelineProvider {
  private func fit(_ context: Context) -> Int {
    let room = context.displaySize.height - 32 - titleHeight - 6 - dayHeight - 4
    return max(2, Int((room + chipGap) / (chipHeight + chipGap)))
  }

  private func entry(_ date: Date, _ context: Context) -> WeekEntry {
    WeekEntry(date: date, snap: Store.snapshot(), shift: Store.weekShift(at: date), done: Store.pendingDone(), fit: fit(context))
  }

  func placeholder(in context: Context) -> WeekEntry {
    WeekEntry(date: Date(), snap: nil, shift: 0, done: [], fit: fit(context))
  }

  func getSnapshot(in context: Context, completion: @escaping (WeekEntry) -> Void) {
    completion(entry(Date(), context))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WeekEntry>) -> Void) {
    let now = Date()
    let midnight = Day.nextMidnight(after: now)
    // Paged away: back at this week after a while.
    var dates = [now]
    if let back = Store.weekShiftEnds, back < midnight { dates.append(back) }
    dates.append(midnight)
    completion(Timeline(entries: dates.map { entry($0, context) }, policy: .after(midnight)))
  }
}

struct WeekWidgetView: View {
  let entry: WeekEntry
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    if let snap = entry.snap {
      content(snap)
    } else {
      OpenAppView()
    }
  }

  private func content(_ snap: Snapshot) -> some View {
    let today = Day.key(entry.date)
    let monday = Day.add(Day.monday(today), entry.shift * 7)
    let middle = Day.add(monday, 3)
    let month = Day.months[Day.month(middle)]
    let title = Day.year(middle) == Day.year(today) ? month : "\(month) \(Day.year(middle))"

    return VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 2) {
        Button(intent: ShiftWeek(by: 0)) {
          Text(title)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.primary)
            .lineLimit(1)
        }
        .buttonStyle(.plain)
        Spacer(minLength: 6)
        Arrow(symbol: "chevron.left", by: -1)
        Arrow(symbol: "chevron.right", by: 1)
      }
      .frame(height: titleHeight)
      HStack(alignment: .top, spacing: 3) {
        ForEach(0..<7, id: \.self) { i in
          let day = Day.add(monday, i)
          Link(destination: Links.calendar(day: day)) {
            DayColumn(
              day: day, index: i, today: today,
              entries: (snap.days[day] ?? []).filter { !entry.done.contains($0.task) },
              fit: entry.fit, scheme: scheme)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct Arrow: View {
  let symbol: String
  let by: Int

  var body: some View {
    Button(intent: ShiftWeek(by: by)) {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.secondary)
        .frame(width: 28, height: titleHeight)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

private struct DayColumn: View {
  let day: String
  let index: Int
  let today: String
  let entries: [Entry]
  let fit: Int
  let scheme: ColorScheme

  var body: some View {
    let isToday = day == today
    // Room for one chip less when the rest has to be counted.
    let shown = entries.count > fit ? fit - 1 : entries.count
    VStack(spacing: chipGap) {
      HStack(spacing: 3) {
        Text(Day.letters[index])
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(isToday ? AnyShapeStyle(Palette.background(scheme)) : AnyShapeStyle(.secondary))
        Text("\(Day.number(day))")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(isToday ? AnyShapeStyle(Palette.background(scheme)) : AnyShapeStyle(.primary))
          .monospacedDigit()
      }
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .frame(maxWidth: .infinity)
      .frame(height: dayHeight)
      .background {
        if isToday { Capsule().fill(Color.primary) }
      }
      .padding(.bottom, 4 - chipGap)
      ForEach(entries.prefix(max(0, shown))) { e in
        WeekChip(entry: e, scheme: scheme)
      }
      if entries.count > shown {
        Text("+\(entries.count - shown)")
          .font(.system(size: 9.5, weight: .medium))
          .foregroundStyle(.secondary)
          .monospacedDigit()
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, 3)
          .frame(height: chipHeight)
      }
      Spacer(minLength: 0)
    }
    .opacity(day < today ? 0.55 : 1)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .contentShape(Rectangle())
  }
}

/// All day: tinted with the list colour. At a set time: the colour as a bar, as in the app's month.
private struct WeekChip: View {
  let entry: Entry
  let scheme: ColorScheme

  var body: some View {
    if entry.timed && entry.deadline == nil {
      let color = Palette.list(entry.color, scheme)
      HStack(spacing: 2.5) {
        RoundedRectangle(cornerRadius: 1).fill(color).frame(width: 2, height: chipHeight - 5)
        Text(entry.title)
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(.primary)
          .lineLimit(1)
      }
      .padding(.leading, 1.5)
      .frame(maxWidth: .infinity, alignment: .leading)
      .frame(height: chipHeight)
      .clipped()
    } else {
      Chip(entry: entry, scheme: scheme)
    }
  }
}

struct WeekWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "VitroWeek", provider: WeekProvider()) { entry in
      WeekWidgetView(entry: entry)
        .containerBackground(for: .widget) { WidgetBackground() }
    }
    .configurationDisplayName("Week")
    .description("The week's tasks and events, day by day.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}
