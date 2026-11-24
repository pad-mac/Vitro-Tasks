// The widgets' settings (which list, which day layout) and their buttons
// (tick a task, page through weeks). Buttons run here, in the widget; a tick
// waits in the shared folder until the app takes it over.

import AppIntents
import WidgetKit

// MARK: - Which list

struct ListChoice: AppEntity {
  var id: String
  var name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "List"
  static var defaultQuery = ListChoiceQuery()

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }
}

struct ListChoiceQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [ListChoice] {
    let all = Self.all()
    return identifiers.map { id in all.first(where: { $0.id == id }) ?? ListChoice(id: id, name: "List") }
  }

  func suggestedEntities() async throws -> [ListChoice] {
    Self.all()
  }

  func defaultResult() async -> ListChoice? {
    Self.all().first
  }

  /// Today, Next 7 Days, All, Inbox, Deadlines, then the lists in sidebar order.
  static func all() -> [ListChoice] {
    guard let snap = Store.snapshot(), !snap.views.isEmpty else { return [ListChoice(id: "today", name: "Today")] }
    return snap.views.map { ListChoice(id: $0.id, name: String(repeating: "    ", count: $0.depth) + $0.name) }
  }
}

struct ListConfig: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "List"
  static var description = IntentDescription("The list or view the widget shows.")

  @Parameter(title: "List")
  var list: ListChoice?

  init() {}
}

// MARK: - Day layout

enum DayLayout: String, AppEnum {
  case twoDays
  case split

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Layout"
  static var caseDisplayRepresentations: [DayLayout: DisplayRepresentation] = [
    .twoDays: "Today and tomorrow",
    .split: "Today in two halves",
  ]
}

struct DayConfig: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Day"
  static var description = IntentDescription("Today's schedule, by the hour.")

  @Parameter(title: "Layout", default: .twoDays)
  var layout: DayLayout

  init() {}
}

// MARK: - Buttons

struct CompleteTask: AppIntent {
  static var title: LocalizedStringResource = "Complete Task"
  static var isDiscoverable: Bool = false

  @Parameter(title: "Task")
  var id: String

  init() {}

  init(id: String) {
    self.id = id
  }

  func perform() async throws -> some IntentResult {
    Store.complete(id)
    return .result()
  }
}

struct ShiftWeek: AppIntent {
  static var title: LocalizedStringResource = "Show Another Week"
  static var isDiscoverable: Bool = false

  /// Weeks forward (negative: back); 0 is the current week again.
  @Parameter(title: "Weeks")
  var by: Int

  init() {}

  init(by: Int) {
    self.by = by
  }

  func perform() async throws -> some IntentResult {
    Store.shiftWeek(by)
    return .result()
  }
}
