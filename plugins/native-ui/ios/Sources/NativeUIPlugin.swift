// Native parts around the web view on iOS: the glass tab bar, haptics, the
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
  private var bar: GlassBar?
  private let haptics = Haptics()
  private var greeted = false
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
    attach(0)
  }

  /// The bar sits on the view that holds the web view (not on the web view,
  /// which gets shorter while the keyboard is up).
  private func attach(_ tries: Int) {
    guard let webview = webview else { return }
    guard let host = webview.superview else {
      if tries < 100 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in self?.attach(tries + 1) }
      }
      return
    }
    if bar == nil {
      let b = GlassBar(frame: host.bounds)
      b.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      b.onTab = { [weak self] id in self?.emit("tab", ["id": id]) }
      host.addSubview(b)
      bar = b
    }
    applyStyle()
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    // The page is listening now: tell it the native parts are there.
    if !greeted {
      greeted = true
      emit("ready", [:])
    }
    switch type {
    case "bar":
      if bar == nil { attach(0) }
      if let b = bar {
        b.superview?.bringSubviewToFront(b)
        b.update(body)
      }
    case "press":
      bar?.press(body["down"] as? Bool ?? false)
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
      if let json = body["json"] as? String { WidgetStore.write(json) }
    case "widgetsTake":
      emit("widgetActions", ["actions": WidgetStore.takeActions()])
    case "allowFocus":
      focusGate.allow()
    default:
      break
    }
  }

  /// Light or dark as chosen in the app (or the system's when it follows the
  /// system), for the bar, the menus and the keyboard.
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
/// snapshot of what they show, and the checkboxes ticked in them. Both live in
/// the app group of the app and its widgets. SideStore signs the app with its
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

  static func write(_ json: String) {
    queue.async {
      guard let folder = folder else { return }
      try? Data(json.utf8).write(to: folder.appendingPathComponent("widgets.json"), options: .atomic)
      #if canImport(WidgetKit)
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
      #endif
    }
  }

  /// The widgets' ticks since the last time, handed to the page once.
  static func takeActions() -> [[String: Any]] {
    queue.sync {
      guard let url = folder?.appendingPathComponent("actions.json"), let data = try? Data(contentsOf: url) else { return [] }
      try? FileManager.default.removeItem(at: url)
      return ((try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]) ?? []
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

// MARK: - Glass tab bar

/// Tasks and Calendar in one glass capsule (Settings is in the sidebar), and a round + next to
/// it. Covers the whole screen but only takes touches on the capsule; the +
/// only draws, so its tap reaches the page below (the page has to focus its
/// text field inside the touch, or iOS keeps the keyboard closed).
final class GlassBar: UIView {
  var onTab: ((String) -> Void)?

  private let ids = ["tasks", "calendar"]
  private let tabs: UIVisualEffectView
  private let add: UIVisualEffectView
  private let addIcon = UIImageView()
  // On pages outside the tabs (settings): only a round back button, bottom left.
  private let back: UIVisualEffectView
  private let backIcon = UIImageView()
  private var backMode = false
  private let pill = UIView()
  private var items: [TabItem] = []
  private var slots: [CGRect] = []
  private var active = 0
  private var wanted = false
  private var keyboardUp = false

  static let height: CGFloat = 58

  override init(frame: CGRect) {
    tabs = UIVisualEffectView(effect: GlassBar.glass(interactive: true))
    add = UIVisualEffectView(effect: GlassBar.glass(interactive: false))
    back = UIVisualEffectView(effect: GlassBar.glass(interactive: false))
    super.init(frame: frame)
    backgroundColor = .clear
    alpha = 0
    addSubview(tabs)
    addSubview(add)
    addSubview(back)

    pill.isUserInteractionEnabled = false
    pill.backgroundColor = UIColor { traits in
      traits.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.13) : UIColor(white: 0, alpha: 0.065)
    }
    pill.layer.cornerCurve = .continuous
    tabs.contentView.addSubview(pill)

    let specs: [(String, String)] = [("checklist", "Tasks"), ("calendar", "Calendar")]
    for (index, spec) in specs.enumerated() {
      let item = TabItem(symbol: spec.0, title: spec.1)
      item.tag = index
      item.addTarget(self, action: #selector(tapped(_:)), for: .touchUpInside)
      tabs.contentView.addSubview(item)
      items.append(item)
    }
    items[0].setActive(true)

    addIcon.image = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: .semibold))
    addIcon.tintColor = .label
    addIcon.contentMode = .center
    add.contentView.addSubview(addIcon)
    add.isUserInteractionEnabled = false

    // Like the +, the back button only draws; its tap reaches the page's own button below.
    backIcon.image = UIImage(systemName: "chevron.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .semibold))
    backIcon.tintColor = .label
    backIcon.contentMode = .center
    back.contentView.addSubview(backIcon)
    back.isUserInteractionEnabled = false
    back.alpha = 0

    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardShows), name: UIResponder.keyboardWillShowNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardHides), name: UIResponder.keyboardWillHideNotification, object: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  private static func glass(interactive: Bool) -> UIVisualEffect {
    #if compiler(>=6.2)
      if #available(iOS 26.0, *) {
        let effect = UIGlassEffect()
        effect.isInteractive = interactive
        return effect
      }
    #endif
    return UIBlurEffect(style: .systemChromeMaterial)
  }

  private static func round(_ view: UIVisualEffectView, _ radius: CGFloat) {
    #if compiler(>=6.2)
      if #available(iOS 26.0, *) {
        view.cornerConfiguration = .capsule()
        return
      }
    #endif
    view.layer.cornerRadius = radius
    view.layer.cornerCurve = .continuous
    view.clipsToBounds = true
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let h = GlassBar.height
    // Same place as the page's own bar: just above the home indicator.
    let gap = max(safeAreaInsets.bottom - 14, 10)
    let y = bounds.height - gap - h
    let addX = bounds.width - 16 - h
    setFrame(add, CGRect(x: addX, y: y, width: h, height: h))
    setFrame(tabs, CGRect(x: 16, y: y, width: max(0, addX - 10 - 16), height: h))
    setFrame(back, CGRect(x: 16, y: y, width: h, height: h))
    GlassBar.round(add, h / 2)
    GlassBar.round(tabs, h / 2)
    GlassBar.round(back, h / 2)
    addIcon.frame = CGRect(x: 0, y: 0, width: h, height: h)
    backIcon.frame = CGRect(x: 0, y: 0, width: h, height: h)

    let width = (tabs.bounds.width - 8) / CGFloat(max(1, items.count))
    slots = items.indices.map { CGRect(x: 4 + CGFloat($0) * width, y: 4, width: width, height: h - 8) }
    for (index, item) in items.enumerated() {
      item.bounds = CGRect(origin: .zero, size: slots[index].size)
      item.center = CGPoint(x: slots[index].midX, y: slots[index].midY)
    }
    pill.layer.cornerRadius = (h - 8) / 2
    if active < slots.count { pill.frame = slots[active] }
  }

  /// Frame changes that keep a running transform (hide / press animations).
  private func setFrame(_ view: UIView, _ frame: CGRect) {
    view.bounds = CGRect(origin: .zero, size: frame.size)
    view.center = CGPoint(x: frame.midX, y: frame.midY)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard alpha > 0.05, !isHidden else { return nil }
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }

  @objc private func tapped(_ sender: UIControl) {
    let index = sender.tag
    guard index >= 0, index < ids.count else { return }
    UISelectionFeedbackGenerator().selectionChanged()
    setActive(index, animated: true)
    onTab?(ids[index])
  }

  private func setActive(_ index: Int, animated: Bool) {
    guard index >= 0, index < items.count else { return }
    let changed = index != active
    active = index
    for (k, item) in items.enumerated() { item.setActive(k == index) }
    guard index < slots.count else { return }
    let target = slots[index]
    if animated && changed {
      UIView.animate(
        withDuration: 0.34, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0,
        options: [.beginFromCurrentState, .allowUserInteraction]
      ) {
        self.pill.frame = target
      }
    } else {
      pill.frame = target
    }
  }

  /// From the page: { visible, active: "tasks" | "calendar", back }. With `back` (settings)
  /// only the round back button shows, in place of the tabs and the +.
  func update(_ body: [String: Any]) {
    if let name = body["active"] as? String, let index = ids.firstIndex(of: name) {
      setActive(index, animated: alpha > 0.5)
    }
    if let b = body["back"] as? Bool, b != backMode {
      backMode = b
      UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
        self.tabs.alpha = b ? 0 : 1
        self.add.alpha = b ? 0 : 1
        self.back.alpha = b ? 1 : 0
      }
    }
    if let visible = body["visible"] as? Bool { wanted = visible }
    refresh()
  }

  private func refresh() {
    let show = wanted && !keyboardUp
    let target: CGFloat = show ? 1 : 0
    if alpha == target { return }
    let shift = show ? CGAffineTransform.identity : CGAffineTransform(translationX: 0, y: 12)
    UIView.animate(
      withDuration: show ? 0.24 : 0.16, delay: 0,
      options: [.beginFromCurrentState, .curveEaseOut, .allowUserInteraction]
    ) {
      self.alpha = target
      self.tabs.transform = shift
      self.add.transform = shift
      self.back.transform = shift
    }
  }

  /// The page reports touches on its + or back button (the tap itself happens there).
  func press(_ down: Bool) {
    let button = backMode ? back : add
    UIView.animate(
      withDuration: down ? 0.12 : 0.36, delay: 0, usingSpringWithDamping: down ? 1 : 0.55,
      initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]
    ) {
      button.transform = down ? CGAffineTransform(scaleX: 0.9, y: 0.9) : .identity
    }
  }

  @objc private func keyboardShows() {
    keyboardUp = true
    refresh()
  }

  @objc private func keyboardHides() {
    keyboardUp = false
    refresh()
  }
}

final class TabItem: UIControl {
  private let icon = UIImageView()
  private let label = UILabel()

  init(symbol: String, title: String) {
    super.init(frame: .zero)
    icon.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium))
    icon.contentMode = .center
    label.text = title
    label.font = .systemFont(ofSize: 10, weight: .medium)
    label.textAlignment = .center
    addSubview(icon)
    addSubview(label)
    isAccessibilityElement = true
    accessibilityLabel = title
    setActive(false)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  func setActive(_ on: Bool) {
    let color: UIColor = on ? .label : .secondaryLabel
    icon.tintColor = color
    label.textColor = color
    accessibilityTraits = on ? [.button, .selected] : [.button]
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    icon.frame = CGRect(x: 0, y: 5, width: bounds.width, height: 24)
    label.frame = CGRect(x: 0, y: 30, width: bounds.width, height: 14)
  }

  override var isHighlighted: Bool {
    didSet {
      let down = isHighlighted
      UIView.animate(withDuration: 0.14, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
        self.transform = down ? CGAffineTransform(scaleX: 0.92, y: 0.92) : .identity
      }
    }
  }
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
