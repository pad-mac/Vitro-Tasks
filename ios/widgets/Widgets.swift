// Vitro Tasks' home screen and lock screen widgets, and its controls (Controls.swift). They read the snapshot the app writes into
// the shared app group (src/lib/widgets.ts) and never touch the database: a
// tick waits there until the app takes it over, every other tap opens the app
// through a vitrotasks:// link.

import SwiftUI
import WidgetKit

@main
struct VitroWidgets: WidgetBundle {
  @WidgetBundleBuilder var body: some Widget {
    ListWidget()
    DayWidget()
    WeekWidget()
    LockListWidget()
    NextWidget()
    if #available(iOS 18.0, *) {
      AddControl()
      TodayControl()
      CalendarControl()
    }
  }
}
