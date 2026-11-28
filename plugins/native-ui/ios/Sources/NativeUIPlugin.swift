// Native parts around the web view on iOS: haptics, the
// keyboard (the web view makes room for it, no form bar above it, its look
// follows the app's theme), and the data the home screen widgets show.
// Holding a task (menu, drag) is the page's own.
//
// The page talks to this plugin with
//   window.webkit.messageHandlers.vitroNative.postMessage({ type, ... })
// and hears back through
//   window.__vitroNative(name, payload)

import ObjectiveC
import Tauri
import UIKit
import WebKit
#if canImport(WidgetKit)
  import WidgetKit
#endif

final class NativeUIPlugin: Plugin, WKScriptMessageHandler {
  private weak var webview: WKWebView?
  private let haptics = Haptics()
  private var greeted = false
  /// The page's widget bridge listens (it asked for the widgets' changes once).
  private var bridged = false
  private var dark: Bool?
  private var background: UIColor?
  private var raised: UIColor?
  /// Colour behind the web view while a sheet is open (it shows around the keyboard's rounded corners).
  private var backdrop: UIColor?
  private var keyboardUp = false
  private let focusGate = FocusGate()

  override func load(webview: WKWebView) {
    if Thread.isMainThread {
      start(webview)
    } else {
      DispatchQueue.main.async { self.start(webview) }
    }
  }

  private func start(_ webview: WKWebView) {
    self.webview = webview
    webview.configuration.userContentController.add(self, name: "vitroNative")
    KeyboardTweaks.install()
    focusGate.install(on: webview)
    ScrollLock.install(webview.scrollView)
    watchKeyboard()
    NotificationCenter.default.addObserver(self, selector: #selector(linkWaiting), name: Self.pendingLinkNote, object: nil)
  }

  // MARK: Links from the controls

  /// Where a control's link waits (ios/shared/OpenLink.swift writes it, in this app's process).
  private static let pendingLinkKey = "vitro.pendingLink"
  private static let pendingLinkNote = Notification.Name("VitroPendingLink")

  private func takeLink() -> String? {
    let defaults = UserDefaults.standard
    guard let link = defaults.string(forKey: Self.pendingLinkKey) else { return nil }
    defaults.removeObject(forKey: Self.pendingLinkKey)
    return link
  }

  /// A control was tapped while the page listens: it opens the link now (else it takes it with the widgets' changes).
  @objc private func linkWaiting() {
    guard bridged, let link = takeLink() else { return }
    emit("openLink", ["url": link])
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    // The page is listening now: tell it the native parts are there.
    if !greeted {
      greeted = true
      emit("ready", [:])
    }
    switch type {
    case "haptic":
      haptics.play(body["kind"] as? String ?? "")
    case "theme":
      dark = body["dark"] as? Bool
      background = UIColor(hexString: body["bg"] as? String)
      raised = UIColor(hexString: body["raised"] as? String)
      applyStyle()
    case "backdrop":
      backdrop = UIColor(hexString: body["color"] as? String)
      applyBackdrop()
    case "fit":
      if !keyboardUp { resize(0) }
    case "widgets":
      if let json = body["json"] as? String { WidgetStore.write(json, state: body["state"] as? String) }
    case "widgetsTake":
      bridged = true
      let taken = WidgetStore.take()
      emit("widgetActions", ["actions": taken.actions, "changes": taken.changes, "links": takeLink().map { [$0] } ?? []])
    case "allowFocus":
      focusGate.allow()
    default:
      break
    }
  }

  /// Light or dark as chosen in the app (or the system's when it follows the
  /// system), for the menus and the keyboard.
  private func applyStyle() {
    guard let webview = webview else { return }
    let style: UIUserInterfaceStyle
    if let dark = dark {
      style = dark ? .dark : .light
    } else {
      style = .unspecified
    }
    webview.window?.overrideUserInterfaceStyle = style
    webview.superview?.overrideUserInterfaceStyle = style
    if let bg = background {
      webview.backgroundColor = bg
      webview.scrollView.backgroundColor = bg
    }
    applyBackdrop()
  }

  /// Behind the web view (what the keyboard's rounded corners show while the
  /// web view ends above it): the colour at the bottom of the page, as the page
  /// reports it. Only the views behind the web view change (no traits, no web
  /// view colour, which can make the page repaint), and only when it differs.
  private func applyBackdrop() {
    guard let webview = webview, let color = backdrop ?? background else { return }
    if let host = webview.superview, host.backgroundColor != color { host.backgroundColor = color }
    if let window = webview.window, window.backgroundColor != color { window.backgroundColor = color }
  }

  private func emit(_ name: String, _ payload: [String: Any]) {
    guard let webview = webview,
      let data = try? JSONSerialization.data(withJSONObject: payload),
      let json = String(data: data, encoding: .utf8)
    else { return }
    webview.evaluateJavaScript("window.__vitroNative && window.__vitroNative('\(name)', \(json))", completionHandler: nil)
  }

  // MARK: Keyboard

  /// The web view gets shorter while the keyboard is up, so sheets sit on top
  /// of it and the rest of the screen stays where it is. It always returns to
  /// full height when the keyboard goes, when the app comes back, and when the
  /// page notices it is short without a keyboard.
  private func watchKeyboard() {
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardChanges(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardHides(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardShown), name: UIResponder.keyboardDidShowNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardGone), name: UIResponder.keyboardDidHideNotification, object: nil)
    center.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  @objc private func keyboardChanges(_ note: Notification) {
    guard let host = webview?.superview,
      let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
    else { return }
    let local = host.convert(end, from: nil)
    // A keyboard that does not reach the bottom edge (floating, or on its way out) covers nothing.
    let covered = local.maxY >= host.bounds.maxY - 1 ? max(0, min(host.bounds.height, host.bounds.maxY - local.minY)) : 0
    resize(covered)
  }

  @objc private func keyboardHides(_ note: Notification) {
    resize(0)
  }

  @objc private func keyboardShown() {
    keyboardUp = true
  }

  @objc private func keyboardGone() {
    keyboardUp = false
    resize(0)
  }

  @objc private func becameActive() {
    if !keyboardUp { resize(0) }
  }

  private func resize(_ covered: CGFloat) {
    guard let webview = webview, let host = webview.superview else { return }
    let b = host.bounds
    let frame = CGRect(x: b.minX, y: b.minY, width: b.width, height: b.height - covered)
    if webview.frame != frame { webview.frame = frame }
  }
}

// MARK: - Widgets

/// What the home screen widgets (ios/widgets) share with the app: the page's
/// snapshot of what they show and its data (from which they draw and sync on
/// their own while the app is closed), and what was ticked in them. All of it
/// lives in the app group of the app and its widgets. SideStore signs the app with its
/// own team and renames the group ("group.app.vitro.tasks.<TEAM>"), so its
/// real name comes from the provisioning profile.
enum WidgetStore {
  static let group: String = {
    if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let start = data.range(of: Data("<?xml".utf8)),
      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
      let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil)
        as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any],
      let groups = entitlements["com.apple.security.application-groups"] as? [String],
      let group = groups.first(where: { $0.hasPrefix("group.app.vitro.tasks") }) ?? groups.first
    {
      return group
    }
    return "group.app.vitro.tasks"
  }()

  static var folder: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
  }

  private static let queue = DispatchQueue(label: "app.vitro.tasks.widgets", qos: .utility)

  static func write(_ json: String, state: String?) {
    queue.async {
      guard let folder = folder else { return }
      try? Data(json.utf8).write(to: folder.appendingPathComponent("widgets.json"), options: .atomic)
      if let state = state { try? Data(state.utf8).write(to: folder.appendingPathComponent("state.json"), options: .atomic) }
      #if canImport(WidgetKit)
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
      #endif
    }
  }

  /// What was changed in the widgets since the last time (rows; plain ticks from version 0.12.0), handed to the page once.
  static func take() -> (actions: [[String: Any]], changes: [[String: Any]]) {
    queue.sync {
      func takeFile(_ name: String) -> [[String: Any]] {
        guard let url = folder?.appendingPathComponent(name), let data = try? Data(contentsOf: url) else { return [] }
        try? FileManager.default.removeItem(at: url)
        return ((try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]) ?? []
      }
      return (takeFile("actions.json"), takeFile("changes.json"))
    }
  }
}

/// iOS raises the keyboard only for a field focused by a tap. A widget's +
/// opens the quick add through a link, without a tap: for a moment after the
/// page asks, a focus may raise it too. (WebKit's input delegate; everything
/// else stays as WebKit decides.)
final class FocusGate: NSObject {
  private var until = Date.distantPast

  func install(on webview: WKWebView) {
    let setter = NSSelectorFromString("_setInputDelegate:")
    if webview.responds(to: setter) { webview.perform(setter, with: self) }
  }

  func allow() {
    until = Date().addingTimeInterval(1.5)
  }

  /// _WKFocusStartsInputSessionPolicy: 0 auto (WebKit's own rule), 1 allow.
  @objc(_webView:decidePolicyForFocusedElement:)
  func decidePolicy(_ webView: WKWebView, focusedElement: AnyObject) -> Int {
    if Date() < until {
      until = .distantPast
      return 1
    }
    return 0
  }
}

@_cdecl("init_plugin_native_ui")
public func initPlugin() -> Plugin {
  return NativeUIPlugin()
}

// MARK: - Haptics

/// Feedback generators kept ready, so a tick lands with the finger.
final class Haptics {
  private let selection = UISelectionFeedbackGenerator()
  private let light = UIImpactFeedbackGenerator(style: .light)
  private let medium = UIImpactFeedbackGenerator(style: .medium)
  private let notice = UINotificationFeedbackGenerator()

  init() {
    selection.prepare()
    light.prepare()
    medium.prepare()
    notice.prepare()
  }

  func play(_ kind: String) {
    switch kind {
    case "success":
      // A task done: the system's own "done" feel.
      notice.notificationOccurred(.success)
      notice.prepare()
    case "selection":
      selection.selectionChanged()
      selection.prepare()
    case "light":
      light.impactOccurred()
      light.prepare()
    default:
      medium.impactOccurred()
      medium.prepare()
    }
  }
}

// MARK: - Scroll lock

enum ScrollLock {
  private static var installed = false

  /// The page scrolls inside itself. The web view's own scroll view stays at
  /// the top, so focusing a field no longer pushes the whole page up for a
  /// moment (WebKit scrolls to keep the field clear of the keyboard).
  static func install(_ scrollView: UIScrollView) {
    guard !installed else { return }
    let cls: AnyClass = type(of: scrollView)
    // Only WebKit's own subclass, never every scroll view in the app.
    guard ObjectIdentifier(cls) != ObjectIdentifier(UIScrollView.self), NSStringFromClass(cls).hasPrefix("WK") else { return }
    installed = true
    let plain = #selector(setter: UIScrollView.contentOffset)
    if let method = class_getInstanceMethod(cls, plain) {
      typealias Set = @convention(c) (AnyObject, Selector, CGPoint) -> Void
      let original = unsafeBitCast(method_getImplementation(method), to: Set.self)
      let block: @convention(block) (AnyObject, CGPoint) -> Void = { view, _ in original(view, plain, .zero) }
      class_replaceMethod(cls, plain, imp_implementationWithBlock(unsafeBitCast(block, to: AnyObject.self)), method_getTypeEncoding(method))
    }
    let animated = #selector(UIScrollView.setContentOffset(_:animated:))
    if let method = class_getInstanceMethod(cls, animated) {
      typealias Set = @convention(c) (AnyObject, Selector, CGPoint, Bool) -> Void
      let original = unsafeBitCast(method_getImplementation(method), to: Set.self)
      let block: @convention(block) (AnyObject, CGPoint, Bool) -> Void = { view, _, _ in original(view, animated, .zero, false) }
      class_replaceMethod(cls, animated, imp_implementationWithBlock(unsafeBitCast(block, to: AnyObject.self)), method_getTypeEncoding(method))
    }
    scrollView.contentOffset = .zero
  }
}

// MARK: - Keyboard

enum KeyboardTweaks {
  private static var installed = false

  /// No bar with arrows and Done above the keyboard, and a keyboard in the
  /// standard look (light or dark from the app's theme, like Safari's)
  /// instead of WebKit's own dark variant.
  static func install() {
    guard !installed else { return }
    installed = true
    let noView: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
    let appearance: @convention(block) (AnyObject) -> Int = { _ in UIKeyboardAppearance.default.rawValue }
    if let content = NSClassFromString("WKContentView") {
      replace(content, #selector(getter: UIResponder.inputAccessoryView), unsafeBitCast(noView, to: AnyObject.self), "@@:")
      replace(content, #selector(getter: UIResponder.inputAccessoryViewController), unsafeBitCast(noView, to: AnyObject.self), "@@:")
      replace(content, NSSelectorFromString("keyboardAppearance"), unsafeBitCast(appearance, to: AnyObject.self), "q@:")
    }
    if let traits = NSClassFromString("UITextInputTraits") {
      replace(traits, NSSelectorFromString("keyboardAppearance"), unsafeBitCast(appearance, to: AnyObject.self), "q@:")
    }
  }

  private static func replace(_ cls: AnyClass, _ selector: Selector, _ block: AnyObject, _ types: String) {
    let imp = imp_implementationWithBlock(block)
    _ = class_replaceMethod(cls, selector, imp, types)
  }
}

extension UIColor {
  /// "#rrggbb"
  convenience init?(hexString: String?) {
    guard var s = hexString?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    self.init(
      red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
      blue: CGFloat(v & 0xff) / 255, alpha: 1)
  }
}
