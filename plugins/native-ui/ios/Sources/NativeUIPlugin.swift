// Native parts around the web view on iOS: the glass tab bar, holding a task
// (lift, context menu, drag), the keyboard (the web view makes room for it,
// no form bar above it, its look follows the app's theme).
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
  private var press: PressController?
  private var greeted = false
  private var dark: Bool?
  private var background: UIColor?
  private var raised: UIColor?
  /// Colour behind the web view while a sheet is open (it shows around the keyboard's rounded corners).
  private var backdrop: UIColor?
  private var keyboardUp = false

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
    let press = PressController(webview: webview, emit: { [weak self] name, payload in self?.emit(name, payload) })
    press.install()
    self.press = press
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
    case "touch":
      press?.touch(body)
    case "theme":
      dark = body["dark"] as? Bool
      background = UIColor(hexString: body["bg"] as? String)
      raised = UIColor(hexString: body["raised"] as? String)
      press?.background = raised ?? background
      applyStyle()
    case "backdrop":
      backdrop = UIColor(hexString: body["color"] as? String)
      applyStyle()
    case "fit":
      if !keyboardUp { resize(0) }
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
    if let color = backdrop ?? background {
      webview.superview?.backgroundColor = color
    }
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

// MARK: - Holding a task

/// What the page reported when a touch began on a task.
struct PressTarget {
  let id: String
  let rect: CGRect
  let items: [[String: Any]]
  let movable: Bool
  let radius: CGFloat
  let time: Date
  var image: UIImage?
}

/// Holding a task works like in the system's own lists: the system context
/// menu and drag interactions sit on the web view, and the page says at the
/// start of each touch which task (if any) is under the finger, with its
/// menu. A picture of the task (taken right then) is what lifts; the page
/// hides the task itself meanwhile. Moving while holding, or dragging the
/// picture out of the open menu, starts a drag; a full-screen catcher then
/// reports where the finger is, and the page shows and does the drop.
final class PressController: NSObject, UIContextMenuInteractionDelegate, UIDragInteractionDelegate, UIDropInteractionDelegate {
  var background: UIColor?

  private weak var webview: WKWebView?
  private let emit: (String, [String: Any]) -> Void
  private var target: PressTarget?
  /// The task that is lifted right now (menu open or being dragged).
  private var lifted: PressTarget?
  private var anchor: UIView?
  private var session = 0
  private var menuShown = false
  private var dragging = false
  private var catcher: UIView?

  init(webview: WKWebView, emit: @escaping (String, [String: Any]) -> Void) {
    self.webview = webview
    self.emit = emit
    super.init()
  }

  func install() {
    guard let webview = webview else { return }
    webview.addInteraction(UIContextMenuInteraction(delegate: self))
    let drag = UIDragInteraction(delegate: self)
    drag.isEnabled = true
    webview.addInteraction(drag)
  }

  /// From the page at every touch start: { id, rect, items, movable } or no id.
  func touch(_ body: [String: Any]) {
    guard lifted == nil else { return }
    guard let id = body["id"] as? String, let r = body["rect"] as? [String: Any],
      let items = body["items"] as? [[String: Any]]
    else {
      target = nil
      return
    }
    let rect = CGRect(x: number(r["x"]), y: number(r["y"]), width: number(r["w"]), height: number(r["h"]))
    let time = Date()
    target = PressTarget(
      id: id, rect: rect, items: items, movable: body["movable"] as? Bool ?? false,
      radius: CGFloat(number(body["radius"], 12)), time: time, image: nil)
    // The picture is taken now: the menu asks for it a moment later and cannot wait.
    guard let webview = webview else { return }
    let config = WKSnapshotConfiguration()
    config.rect = rect
    config.afterScreenUpdates = false
    webview.takeSnapshot(with: config) { [weak self] image, _ in
      guard let self = self, let t = self.target, t.id == id, t.time == time else { return }
      self.target?.image = image
    }
  }

  private func targetAt(_ point: CGPoint) -> PressTarget? {
    guard let t = target, Date().timeIntervalSince(t.time) < 4, t.rect.insetBy(dx: -6, dy: -6).contains(point) else { return nil }
    return t
  }

  // MARK: Lift

  /// Puts the picture over the task and tells the page to hide the task.
  private func lift(_ t: PressTarget) -> UIView? {
    if let a = anchor, lifted?.id == t.id { return a }
    guard let webview = webview, let host = webview.superview else { return nil }
    clearAnchor()
    let frame = webview.convert(t.rect, to: host)
    let a = UIView(frame: frame)
    a.isUserInteractionEnabled = false
    if let image = t.image {
      let iv = UIImageView(image: image)
      iv.frame = a.bounds
      a.addSubview(iv)
    } else if let snap = webview.resizableSnapshotView(from: t.rect, afterScreenUpdates: false, withCapInsets: .zero) {
      snap.frame = a.bounds
      a.addSubview(snap)
    }
    host.addSubview(a)
    anchor = a
    lifted = t
    menuShown = false
    session += 1
    emit("lifted", ["id": t.id])
    // Safety: a lift that led to neither a menu nor a drag ends by itself.
    let s = session
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      guard let self = self, self.session == s, !self.menuShown, !self.dragging else { return }
      self.end()
    }
    return a
  }

  /// The page shows its task again first; the picture goes a moment later, so nothing blinks.
  private func end() {
    guard let t = lifted else { return }
    lifted = nil
    target = nil
    menuShown = false
    emit("restore", ["id": t.id])
    let s = session
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
      guard let self = self, self.session == s, self.lifted == nil else { return }
      self.clearAnchor()
    }
  }

  private func clearAnchor() {
    anchor?.removeFromSuperview()
    anchor = nil
  }

  private func preview() -> UITargetedPreview? {
    guard let a = anchor, a.window != nil, let t = lifted else { return nil }
    let parameters = UIPreviewParameters()
    parameters.visiblePath = UIBezierPath(roundedRect: a.bounds, cornerRadius: t.radius)
    if let bg = background { parameters.backgroundColor = bg }
    return UITargetedPreview(view: a, parameters: parameters)
  }

  // MARK: Menu

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard lifted == nil, let t = targetAt(location) else { return nil }
    let menu = UIMenu(title: "", children: MenuBuilder.elements(t.items) { [weak self] action in
      self?.emit("menuAction", ["id": t.id, "action": action])
    })
    return UIContextMenuConfiguration(identifier: t.id as NSString, previewProvider: nil) { _ in menu }
  }

  private func liftForMenu() -> UITargetedPreview? {
    if lifted == nil, let t = target { _ = lift(t) }
    return preview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    return liftForMenu()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    return preview()
  }

  @available(iOS 16.0, *)
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, configuration: UIContextMenuConfiguration,
    highlightPreviewForItemWithIdentifier identifier: NSCopying
  ) -> UITargetedPreview? {
    return liftForMenu()
  }

  @available(iOS 16.0, *)
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, configuration: UIContextMenuConfiguration,
    dismissalPreviewForItemWithIdentifier identifier: NSCopying
  ) -> UITargetedPreview? {
    return preview()
  }

  @available(iOS 14.0, *)
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    menuShown = true
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    let finish = { [weak self] in
      guard let self = self else { return }
      self.menuShown = false
      // A drag out of the menu goes on; it ends the lift itself.
      if !self.dragging { self.end() }
    }
    if let animator = animator {
      animator.addCompletion(finish)
    } else {
      finish()
    }
  }

  // MARK: Drag

  func dragInteraction(_ interaction: UIDragInteraction, itemsForBeginning session: UIDragSession) -> [UIDragItem] {
    guard let webview = webview else { return [] }
    // From an open menu the picture may have moved; it is still the lifted task.
    guard let t = lifted ?? targetAt(session.location(in: webview)), t.movable else { return [] }
    if lifted == nil { _ = lift(t) }
    let item = UIDragItem(itemProvider: NSItemProvider(object: "vitro-task:\(t.id)" as NSString))
    item.localObject = t.id
    return [item]
  }

  func dragInteraction(_ interaction: UIDragInteraction, previewForLifting item: UIDragItem, session: UIDragSession) -> UITargetedDragPreview? {
    guard let a = anchor, a.window != nil, let host = a.superview, let t = lifted else { return nil }
    let parameters = UIDragPreviewParameters()
    parameters.visiblePath = UIBezierPath(roundedRect: a.bounds, cornerRadius: t.radius)
    if let bg = background { parameters.backgroundColor = bg }
    // A copy travels with the finger, so the picture itself can leave the
    // task's old place empty during the drag.
    let copy: UIView
    if let image = t.image {
      copy = UIImageView(image: image)
    } else if let snap = a.snapshotView(afterScreenUpdates: false) {
      copy = snap
    } else {
      return UITargetedDragPreview(view: a, parameters: parameters)
    }
    copy.frame = a.bounds
    return UITargetedDragPreview(view: copy, parameters: parameters, target: UIDragPreviewTarget(container: host, center: a.center))
  }

  func dragInteraction(_ interaction: UIDragInteraction, sessionWillBegin session: UIDragSession) {
    guard let t = lifted else { return }
    dragging = true
    addCatcher()
    UIView.animate(withDuration: 0.12) { self.anchor?.alpha = 0 }
    emit("dragStart", ["id": t.id])
  }

  /// A drag that is called off flies back; the picture is there again when it lands.
  func dragInteraction(_ interaction: UIDragInteraction, item: UIDragItem, willAnimateCancelWith animator: UIDragAnimating) {
    animator.addAnimations { [weak self] in self?.anchor?.alpha = 1 }
  }

  func dragInteraction(_ interaction: UIDragInteraction, sessionIsRestrictedToDraggingApplication session: UIDragSession) -> Bool {
    return true
  }

  func dragInteraction(_ interaction: UIDragInteraction, session: UIDragSession, didEndWith operation: UIDropOperation) {
    dragging = false
    removeCatcher()
    emit("dragEnd", ["dropped": operation == .move])
    end()
  }

  // MARK: Drop

  /// Covers the screen during a drag, so the drop lands here (not in WebKit)
  /// and the page hears where the finger is.
  private func addCatcher() {
    guard catcher == nil, let host = webview?.superview else { return }
    let view = UIView(frame: host.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.backgroundColor = .clear
    view.addInteraction(UIDropInteraction(delegate: self))
    host.addSubview(view)
    catcher = view
  }

  private func removeCatcher() {
    catcher?.removeFromSuperview()
    catcher = nil
  }

  private func spot(_ session: UIDropSession) -> [String: Any] {
    guard let webview = webview else { return [:] }
    let p = session.location(in: webview)
    return ["x": Double(p.x), "y": Double(p.y)]
  }

  func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
    return session.localDragSession != nil
  }

  func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal {
    emit("dragMove", spot(session))
    return UIDropProposal(operation: .move)
  }

  func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
    emit("dragDrop", spot(session))
  }

  private func number(_ value: Any?, _ fallback: Double = 0) -> Double {
    return (value as? NSNumber)?.doubleValue ?? fallback
  }
}

/// Builds a UIMenu tree from the page's description:
/// { id, title, icon, color, subtitle, checked, destructive } or
/// { title, icon, inline, size, children }.
enum MenuBuilder {
  static func elements(_ items: [[String: Any]], _ act: @escaping (String) -> Void) -> [UIMenuElement] {
    return items.map { element($0, act) }
  }

  private static func element(_ item: [String: Any], _ act: @escaping (String) -> Void) -> UIMenuElement {
    let title = item["title"] as? String ?? ""
    let image = symbol(item["icon"] as? String, item["color"] as? String)
    if let children = item["children"] as? [[String: Any]] {
      var options: UIMenu.Options = []
      if item["inline"] as? Bool == true { options.insert(.displayInline) }
      let kids = elements(children, act)
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
    ) { _ in act(id) }
    if #available(iOS 15.0, *), let subtitle = item["subtitle"] as? String {
      action.subtitle = subtitle
    }
    return action
  }

  private static func symbol(_ name: String?, _ hex: String?) -> UIImage? {
    guard let name = name, let image = UIImage(systemName: name) else { return nil }
    if let color = UIColor(hexString: hex) {
      return image.withTintColor(color, renderingMode: .alwaysOriginal)
    }
    return image
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
