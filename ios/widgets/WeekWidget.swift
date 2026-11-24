// The week at a glance: seven columns, each headed by its letter and date on
// one line ("M 24", to save height), with the day's entries as chips. The
// columns reach out to the sides; the arrows sit in the top corners and page
// through the weeks; the month name between them goes back to this week.

import AppIntents
import SwiftUI
import WidgetKit

// Own margins: the columns out to the edges (as far from them as from each
// other), a low title row with the arrows as far from the top as from the sides.
private let topInset: CGFloat = 8
private let columnGap: CGFloat = 3
private let sideInset: CGFloat = columnGap
private let bottomInset: CGFloat = 6
private let titleHeight: CGFloat = 20
private let titleGap: CGFloat = 4
private let dayHeight: CGFloat = 18
private let dayGap: CGFloat = 3
private let chipHeight: CGFloat = 15
private let chipGap: CGFloat = 2
/// The "+N" line under the chips: lower than a chip, so one more chip fits.
private let moreHeight: CGFloat = 11

struct WeekEntry: TimelineEntry {
  let date: Date
  let snap: Snapshot?
  let shift: Int
  let done: Set<String>
  /// Chips that fit under a day: all of them, or with the "+N" line under them.
  let fit: Int
  let fitWithMore: Int
}

struct WeekProvider: TimelineProvider {
  /// Under a day's header: chips (each with the gap after it), and maybe the "+N" line.
  static func fit(height: CGFloat) -> (all: Int, withMore: Int) {
    let room = height - topInset - titleHeight - titleGap - dayHeight - dayGap - bottomInset
    let step = chipHeight + chipGap
    return (max(2, Int((room + chipGap) / step)), max(1, Int((room - moreHeight) / step)))
  }

  private func entry(_ snap: Snapshot?, _ date: Date, _ context: Context) -> WeekEntry {
    let f = Self.fit(height: context.displaySize.height)
    return WeekEntry(date: date, snap: snap, shift: Store.weekShift(at: date), done: Store.pendingDone(), fit: f.all, fitWithMore: f.withMore)
  }

  func placeholder(in context: Context) -> WeekEntry {
    let f = Self.fit(height: context.displaySize.height)
    return WeekEntry(date: Date(), snap: nil, shift: 0, done: [], fit: f.all, fitWithMore: f.withMore)
  }

  func getSnapshot(in context: Context, completion: @escaping (WeekEntry) -> Void) {
    Task {
      let snap = await Live.shared.snapshot()
      completion(entry(snap, Date(), context))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WeekEntry>) -> Void) {
    Task {
      // What changed on the servers since (iOS decides how often this runs; about every half hour asked for).
      await Live.shared.refresh()
      let snap = await Live.shared.snapshot()
      let now = Date()
      let midnight = Day.nextMidnight(after: now)
      let next = min(midnight, now.addingTimeInterval(30 * 60))
      // Paged away: back at this week after a while.
      var dates = [now]
      if let back = Store.weekShiftEnds, back < next { dates.append(back) }
      if midnight == next { dates.append(midnight) }
      completion(Timeline(entries: dates.map { entry(snap, $0, context) }, policy: .after(next)))
    }
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

    return VStack(alignment: .leading, spacing: titleGap) {
      ZStack {
        Button(intent: ShiftWeek(by: 0)) {
          Text(title)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.primary)
            .lineLimit(1)
        }
        .buttonStyle(.plain)
        HStack(spacing: 0) {
          Arrow(symbol: "chevron.left", by: -1)
          Spacer(minLength: 0)
          Arrow(symbol: "chevron.right", by: 1)
        }
      }
      .frame(height: titleHeight)
      HStack(alignment: .top, spacing: columnGap) {
        ForEach(0..<7, id: \.self) { i in
          let day = Day.add(monday, i)
          TapLink(Links.calendar(day: day)) {
            DayColumn(
              day: day, index: i, today: today,
              entries: (snap.days[day] ?? []).filter { !entry.done.contains($0.task) },
              fit: entry.fit, fitWithMore: entry.fitWithMore, scheme: scheme)
          }
        }
      }
    }
    .padding(.top, topInset)
    .padding(.horizontal, sideInset)
    .padding(.bottom, bottomInset)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// A chevron in a top corner: its glyph as far from the side as the title row's middle is from the top.
private struct Arrow: View {
  let symbol: String
  let by: Int

  var body: some View {
    Button(intent: ShiftWeek(by: by)) {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.secondary)
        .frame(width: 26, height: titleHeight)
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
  let fitWithMore: Int
  let scheme: ColorScheme

  var body: some View {
    let isToday = day == today
    // Fewer chips when the rest has to be counted.
    let shown = entries.count > fit ? fitWithMore : entries.count
    // Days gone by: their entries fade (as in the app's calendar), the header stays.
    let fade = day < today ? 0.55 : 1
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
      .padding(.bottom, dayGap - chipGap)
      ForEach(entries.prefix(max(0, shown))) { e in
        WeekChip(entry: e, scheme: scheme)
          .opacity(fade)
      }
      if entries.count > shown {
        Text("+\(entries.count - shown)")
          .font(.system(size: 9.5, weight: .medium))
          .foregroundStyle(.secondary)
          .monospacedDigit()
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, 3)
          .frame(height: moreHeight)
          .opacity(fade)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .contentShape(Rectangle())
  }
}

/// All day: tinted with the list colour. At a set time: the colour as a bar, as in the app's month.
/// Titles run to the column's edge and are cut there (no "…" taking the room).
private struct WeekChip: View {
  let entry: Entry
  let scheme: ColorScheme

  var body: some View {
    if entry.timed && entry.deadline == nil {
      let color = Palette.list(entry.color, scheme)
      // The chip's size comes from the column; the title lies over it at its full length, cut off at the edge.
      Color.clear
        .frame(maxWidth: .infinity)
        .frame(height: chipHeight)
        .overlay(alignment: .leading) {
          HStack(spacing: 2.5) {
            RoundedRectangle(cornerRadius: 1).fill(color).frame(width: 2, height: chipHeight - 5)
            Text(entry.title)
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(.primary)
              .lineLimit(1)
              .fixedSize()
          }
          .padding(.leading, 1.5)
        }
        .clipped()
    } else {
      Chip(entry: entry, scheme: scheme, clip: true)
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
    .contentMarginsDisabled()
  }
}
