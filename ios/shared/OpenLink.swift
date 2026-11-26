// Opens the app at a vitrotasks:// link: what the controls (ios/widgets/Controls.swift)
// run. iOS 18 opens no app for a custom link handed back from a control
// (OpenURLIntent wants universal links), so this intent opens the app itself
// (openAppWhenRun) and runs in it: it is built into the app as well as into the
// widgets (scripts/ios-widgets.mjs). There it leaves the link for the page,
// which opens it as any other (the native-ui plugin passes it on).

#if os(iOS)
  import AppIntents
  import Foundation

  @available(iOS 18.0, *)
  struct OpenLink: AppIntent {
    static var title: LocalizedStringResource = "Open Vitro Tasks"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Link")
    var link: String

    init() {}

    init(_ link: String) {
      self.link = link
    }

    @MainActor
    func perform() async throws -> some IntentResult {
      PendingLink.put(link)
      return .result()
    }
  }

  /// A link waiting for the page: kept until it is taken (the app may still be starting), and announced at once.
  enum PendingLink {
    static let key = "vitro.pendingLink"
    static let note = Notification.Name("VitroPendingLink")

    static func put(_ link: String) {
      UserDefaults.standard.set(link, forKey: key)
      NotificationCenter.default.post(name: note, object: nil)
    }
  }
#endif
