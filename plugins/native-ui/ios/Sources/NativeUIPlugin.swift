// Native parts around the web view on iOS: the glass tab bar, the context
// menu for tasks, and keyboard tweaks (no form bar above the keyboard, the
// keyboard follows the app's theme).
//
// The page talks to this plugin with
//   window.webkit.messageHandlers.vitroNative.postMessage({ type, ... })
// and hears back through
//   window.__vitroNative(name, payload)

import ObjectiveC
import Tauri
import UIKit
import WebKit

final class NativeUIPlugin: Plugin, WKScriptMessageHandler {
  private weak var webview: WKWebView?
  private var bar: GlassBar?
  private var menu: MenuPresenter?
  private var menuToken: Double = 0
  private var dark: Bool?
  private var background: UIColor?
  private var raised: UIColor?
  private var greeted = false

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
    ScrollLock.install(webview.scrollView)
    watchKeyboard()
    attach(0)
  }

  // MARK: Keyboard height

  private var keyboardHeight: CGFloat = -1

  /// The web view always fills the screen; the page learns how much of it the
  /// keyboard covers and moves its sheets itself, in step with the keyboard.
  private func watchKeyboard() {
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardChanges(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardHides(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    center.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  @objc private func keyboardChanges(_ note: Notification) {
    guard let host = webview?.superview,
      let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
    else { return }
    let local = host.convert(end, from: nil)
    let covered = max(0, min(host.bounds.height, host.bounds.maxY - local.minY))
    sendKeyboard(covered, note)
  }

  @objc private func keyboardHides(_ note: Notification) {
    sendKeyboard(0, note)
  }

  @objc private func becameActive() {
    fitWebview()
  }

  private func sendKeyboard(_ height: CGFloat, _ note: Notification) {
    fitWebview()
    if abs(height - keyboardHeight) < 0.5 { return }
    keyboardHeight = height
    let duration = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
    emit("keyboard", ["height": Double(height), "duration": duration])
  }

  private func fitWebview() {
    guard let webview = webview, let host = webview.superview else { return }
    if webview.frame != host.bounds { webview.frame = host.bounds }
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
    case "theme":
      dark = body["dark"] as? Bool
      background = UIColor(hexString: body["bg"] as? String)
      raised = UIColor(hexString: body["raised"] as? String)
      applyStyle()
    case "menu":
      presentMenu(body)
    case "menuDismiss":
      menuToken = -1
      menu?.dismiss()
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
      webview.superview?.backgroundColor = bg
      webview.backgroundColor = bg
      webview.scrollView.backgroundColor = bg
    }
  }

  private func emit(_ name: String, _ payload: [String: Any]) {
    guard let webview = webview,
      let data = try? JSONSerialization.data(withJSONObject: payload),
      let json = String(data: data, encoding: .utf8)
    else { return }
    webview.evaluateJavaScript("window.__vitroNative && window.__vitroNative('\(name)', \(json))", completionHandler: nil)
  }

  // MARK: Task menu

  private func presentMenu(_ body: [String: Any]) {
    let token = number(body["token"])
    guard let webview = webview, let host = webview.superview,
      let r = body["rect"] as? [String: Any],
      let items = body["items"] as? [[String: Any]]
    else {
      emit("menuFailed", ["token": token])
      return
    }
    menu?.cleanup()
    menu = nil
    menuToken = token
    let rect = CGRect(x: number(r["x"]), y: number(r["y"]), width: number(r["w"]), height: number(r["h"]))
    let radius = CGFloat(number(body["radius"], 12))
    let config = WKSnapshotConfiguration()
    config.rect = rect
    // After the page has drawn the task as a plain card for the picture.
    config.afterScreenUpdates = true
    webview.takeSnapshot(with: config) { [weak self] image, _ in
      guard let self = self, self.menuToken == token else { return }
      let frame = webview.convert(rect, to: host)
      let presenter = MenuPresenter(
        host: host, frame: frame, image: image,
        menu: UIMenu(title: "", children: self.elements(items, token)),
        radius: radius, background: self.raised ?? self.background,
        payload: body["payload"] as? String ?? "")
      presenter.onShown = { [weak self] in self?.emit("menuShown", ["token": token]) }
      presenter.onClose = { [weak self, weak presenter] in
        guard let self = self else { return }
        if let p = presenter, self.menu === p { self.menu = nil }
        self.emit("menuClosed", ["token": token])
      }
      presenter.onDragBegin = { [weak self] in self?.emit("menuDrag", ["token": token]) }
      presenter.onDragEnd = { [weak self] in self?.emit("menuDragEnd", ["token": token]) }
      self.menu = presenter
      if !presenter.present() {
        presenter.cleanup()
        self.menu = nil
        self.emit("menuFailed", ["token": token])
      }
    }
  }

  private func elements(_ items: [[String: Any]], _ token: Double) -> [UIMenuElement] {
    return items.map { element($0, token) }
  }

  private func element(_ item: [String: Any], _ token: Double) -> UIMenuElement {
    let title = item["title"] as? String ?? ""
    let image = symbol(item["icon"] as? String, item["color"] as? String)
    if let children = item["children"] as? [[String: Any]] {
      var options: UIMenu.Options = []
      if item["inline"] as? Bool == true { options.insert(.displayInline) }
      let kids = elements(children, token)
      if #available(iOS 16.0, *), let size = item["size"] as? String {
        let elementSize: UIMenu.ElementSize = size == "small" ? .small : size == "medium" ? .medium : .large
        return UIMenu(
          title: title, subtitle: nil, image: image, identifier: nil, options: options,
          preferredElementSize: elementSize, children: kids)
      }
      return UIMenu(title: title, image: image, identifier: nil, options: options, children: kids)
    }
    let id = item["id"] as? String ?? ""
    var attributes: UIMenuElement.Attributes = []
    if item["destructive"] as? Bool == true { attributes.insert(.destructive) }
    if item["disabled"] as? Bool == true { attributes.insert(.disabled) }
    let state: UIMenuElement.State = item["checked"] as? Bool == true ? .on : .off
    let action = UIAction(
      title: title, image: image, identifier: nil, discoverabilityTitle: nil,
      attributes: attributes, state: state
    ) { [weak self] _ in
      self?.emit("menuAction", ["token": token, "id": id])
    }
    if #available(iOS 15.0, *), let subtitle = item["subtitle"] as? String {
      action.subtitle = subtitle
    }
    return action
  }

  private func symbol(_ name: String?, _ hex: String?) -> UIImage? {
    guard let name = name, let image = UIImage(systemName: name) else { return nil }
    if let color = UIColor(hexString: hex) {
      return image.withTintColor(color, renderingMode: .alwaysOriginal)
    }
    return image
  }

  private func number(_ value: Any?, _ fallback: Double = 0) -> Double {
    return (value as? NSNumber)?.doubleValue ?? fallback
  }
}

@_cdecl("init_plugin_native_ui")
public func initPlugin() -> Plugin {
  return NativeUIPlugin()
}

// MARK: - Glass tab bar

/// Tasks, Calendar and Settings in one glass capsule, and a round + next to
/// it. Covers the whole screen but only takes touches on the capsule; the +
/// only draws, so its tap reaches the page below (the page has to focus its
/// text field inside the touch, or iOS keeps the keyboard closed).
final class GlassBar: UIView {
  var onTab: ((String) -> Void)?

  private let ids = ["tasks", "calendar", "settings"]
  private let tabs: UIVisualEffectView
  private let add: UIVisualEffectView
  private let addIcon = UIImageView()
  private let pill = UIView()
  private let badge = UIView()
  private var items: [TabItem] = []
  private var slots: [CGRect] = []
  private var active = 0
  private var wanted = false
  private var keyboardUp = false

  static let height: CGFloat = 58

  override init(frame: CGRect) {
    tabs = UIVisualEffectView(effect: GlassBar.glass(interactive: true))
    add = UIVisualEffectView(effect: GlassBar.glass(interactive: false))
    super.init(frame: frame)
    backgroundColor = .clear
    alpha = 0
    addSubview(tabs)
    addSubview(add)

    pill.isUserInteractionEnabled = false
    pill.backgroundColor = UIColor { traits in
      traits.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.13) : UIColor(white: 0, alpha: 0.065)
    }
    pill.layer.cornerCurve = .continuous
    tabs.contentView.addSubview(pill)

    let specs: [(String, String)] = [("checklist", "Tasks"), ("calendar", "Calendar"), ("gearshape", "Settings")]
    for (index, spec) in specs.enumerated() {
      let item = TabItem(symbol: spec.0, title: spec.1)
      item.tag = index
      item.addTarget(self, action: #selector(tapped(_:)), for: .touchUpInside)
      tabs.contentView.addSubview(item)
      items.append(item)
    }
    items[0].setActive(true)

    // Sync trouble: a small red dot on Settings.
    badge.backgroundColor = .systemRed
    badge.layer.cornerRadius = 3.5
    badge.isHidden = true
    badge.isUserInteractionEnabled = false
    items[2].addSubview(badge)

    addIcon.image = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: .semibold))
    addIcon.tintColor = .label
    addIcon.contentMode = .center
    add.contentView.addSubview(addIcon)
    add.isUserInteractionEnabled = false

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
    GlassBar.round(add, h / 2)
    GlassBar.round(tabs, h / 2)
    addIcon.frame = CGRect(x: 0, y: 0, width: h, height: h)

    let width = (tabs.bounds.width - 8) / CGFloat(max(1, items.count))
    slots = items.indices.map { CGRect(x: 4 + CGFloat($0) * width, y: 4, width: width, height: h - 8) }
    for (index, item) in items.enumerated() {
      item.bounds = CGRect(origin: .zero, size: slots[index].size)
      item.center = CGPoint(x: slots[index].midX, y: slots[index].midY)
    }
    badge.frame = CGRect(x: width / 2 + 7, y: 6, width: 7, height: 7)
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

  /// From the page: { visible, active: "tasks" | "calendar" | "settings", badge }.
  func update(_ body: [String: Any]) {
    if let name = body["active"] as? String, let index = ids.firstIndex(of: name) {
      setActive(index, animated: alpha > 0.5)
    }
    if let error = body["badge"] as? Bool { badge.isHidden = !error }
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
    }
  }

  /// The page reports touches on its + (the tap itself happens there).
  func press(_ down: Bool) {
    UIView.animate(
      withDuration: down ? 0.12 : 0.36, delay: 0, usingSpringWithDamping: down ? 1 : 0.55,
      initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]
    ) {
      self.add.transform = down ? CGAffineTransform(scaleX: 0.9, y: 0.9) : .identity
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

// MARK: - Context menu

/// Shows a system context menu for a task in the page: a picture of the task
/// is lifted out of the page and the menu sits below (or above) it, the way
/// iOS does it for its own lists. The page hides the task itself while the
/// picture stands in for it. The picture can be dragged out of the open menu;
/// the drag then goes on in the page (WebKit turns it into drag events there).
final class MenuPresenter: NSObject, UIContextMenuInteractionDelegate, UIDragInteractionDelegate {
  var onShown: (() -> Void)?
  var onClose: (() -> Void)?
  var onDragBegin: (() -> Void)?
  var onDragEnd: (() -> Void)?

  private let anchor: UIView
  private let preview: UIImageView
  private let menu: UIMenu
  private let radius: CGFloat
  private let background: UIColor?
  private let payload: String
  private var interaction: UIContextMenuInteraction?
  private var drag: UIDragInteraction?
  private var closed = false
  private var dragging = false
  // Kept alive while a drag from the menu is under way.
  private var keepAlive: MenuPresenter?

  init(host: UIView, frame: CGRect, image: UIImage?, menu: UIMenu, radius: CGFloat, background: UIColor?, payload: String) {
    anchor = UIView(frame: frame)
    preview = UIImageView(image: image)
    self.menu = menu
    self.radius = radius
    self.background = background
    self.payload = payload
    super.init()
    anchor.backgroundColor = .clear
    preview.frame = anchor.bounds
    preview.contentMode = .scaleToFill
    preview.isUserInteractionEnabled = true
    anchor.addSubview(preview)
    host.addSubview(anchor)
    let interaction = UIContextMenuInteraction(delegate: self)
    anchor.addInteraction(interaction)
    self.interaction = interaction
    let drag = UIDragInteraction(delegate: self)
    // Only tasks that can be moved in their list or board.
    drag.isEnabled = !payload.isEmpty
    anchor.addInteraction(drag)
    self.drag = drag
  }

  /// Opens the menu without a touch on the anchor (UIKit has no public call
  /// for that; when it is missing the page shows its own menu).
  func present() -> Bool {
    guard let interaction = interaction else { return false }
    let selector = NSSelectorFromString("_presentMenuAtLocation:")
    guard interaction.responds(to: selector) else { return false }
    typealias Present = @convention(c) (AnyObject, Selector, CGPoint) -> Void
    let fn = unsafeBitCast(interaction.method(for: selector), to: Present.self)
    fn(interaction, selector, CGPoint(x: anchor.bounds.midX, y: anchor.bounds.midY))
    onShown?()
    return true
  }

  func dismiss() {
    if #available(iOS 14.0, *), let interaction = interaction {
      interaction.dismissMenu()
    } else {
      finish()
    }
  }

  func cleanup() {
    if let interaction = interaction { anchor.removeInteraction(interaction) }
    if let drag = drag { anchor.removeInteraction(drag) }
    interaction = nil
    drag = nil
    anchor.removeFromSuperview()
  }

  private func targeted() -> UITargetedPreview? {
    guard preview.window != nil else { return nil }
    let parameters = UIPreviewParameters()
    parameters.visiblePath = UIBezierPath(roundedRect: preview.bounds, cornerRadius: radius)
    if let background = background { parameters.backgroundColor = background }
    return UITargetedPreview(view: preview, parameters: parameters)
  }

  /// The page shows its task again first; the picture goes a moment later,
  /// so nothing blinks in between.
  private func finish() {
    guard !closed else { return }
    closed = true
    onClose?()
    if dragging { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.cleanup() }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    let menu = self.menu
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { _ in menu }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    return targeted()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    return targeted()
  }

  @available(iOS 16.0, *)
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, configuration: UIContextMenuConfiguration,
    highlightPreviewForItemWithIdentifier identifier: NSCopying
  ) -> UITargetedPreview? {
    return targeted()
  }

  @available(iOS 16.0, *)
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, configuration: UIContextMenuConfiguration,
    dismissalPreviewForItemWithIdentifier identifier: NSCopying
  ) -> UITargetedPreview? {
    return targeted()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    if let animator = animator {
      animator.addCompletion { [weak self] in self?.finish() }
    } else {
      finish()
    }
  }

  // MARK: Drag out of the menu

  func dragInteraction(_ interaction: UIDragInteraction, itemsForBeginning session: UIDragSession) -> [UIDragItem] {
    dragging = true
    keepAlive = self
    onDragBegin?()
    let item = UIDragItem(itemProvider: NSItemProvider(object: payload as NSString))
    item.localObject = payload
    return [item]
  }

  func dragInteraction(_ interaction: UIDragInteraction, previewForLifting item: UIDragItem, session: UIDragSession) -> UITargetedDragPreview? {
    guard preview.window != nil else { return nil }
    let parameters = UIDragPreviewParameters()
    parameters.visiblePath = UIBezierPath(roundedRect: preview.bounds, cornerRadius: radius)
    return UITargetedDragPreview(view: preview, parameters: parameters)
  }

  func dragInteraction(_ interaction: UIDragInteraction, session: UIDragSession, didEndWith operation: UIDropOperation) {
    dragging = false
    onDragEnd?()
    if closed { cleanup() }
    keepAlive = nil
  }
}

// MARK: - Scroll lock

enum ScrollLock {
  private static var installed = false

  /// The page scrolls inside itself. The web view's own scroll view stays at
  /// the top, so focusing a field no longer pushes the whole page up (WebKit
  /// would scroll it to keep the field clear of the keyboard).
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
