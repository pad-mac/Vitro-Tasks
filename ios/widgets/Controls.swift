// Controls (iOS 18): the round buttons for Control Center, the lock screen's two corners
// and the Action button. Each opens the app at a place, through the same vitrotasks://
// links the widgets use, with OpenLink (ios/shared/OpenLink.swift: it runs in the app).

#if os(iOS)
  import AppIntents
  import SwiftUI
  import WidgetKit

  @available(iOS 18.0, *)
  struct AddControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
      StaticControlConfiguration(kind: "app.vitro.tasks.control.add") {
        ControlWidgetButton(action: OpenLink("vitrotasks://add")) {
          Label("New Task", systemImage: "plus")
        }
      }
      .displayName("New Task")
      .description("Opens the quick add.")
    }
  }

  @available(iOS 18.0, *)
  struct TodayControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
      StaticControlConfiguration(kind: "app.vitro.tasks.control.today") {
        ControlWidgetButton(action: OpenLink("vitrotasks://list?id=today")) {
          Label("Today", systemImage: "sun.max")
        }
      }
      .displayName("Today")
      .description("Opens Today.")
    }
  }

  @available(iOS 18.0, *)
  struct CalendarControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
      StaticControlConfiguration(kind: "app.vitro.tasks.control.calendar") {
        // "today": the app works out the day when it opens (a control can't know the date it is tapped on).
        ControlWidgetButton(action: OpenLink("vitrotasks://calendar?day=today")) {
          Label("Calendar", systemImage: "calendar")
        }
      }
      .displayName("Calendar")
      .description("Opens the calendar at today.")
    }
  }
#endif
