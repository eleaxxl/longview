import ExpoModulesCore
import UIKit

private let zoomNotification = Notification.Name("LongviewZoomKeyCommand")

/// Adds ⌘+ / ⌘− / ⌘0, ⌘ + scroll wheel and trackpad pinch, and forwards them to JS as "onZoom".
public class KeyCommandsModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("KeyCommands")

    Events("onZoom")

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(forName: zoomNotification, object: nil, queue: .main) { [weak self] note in
        self?.sendEvent("onZoom", ["step": note.userInfo?["step"] as? Int ?? 0])
      }
    }

    OnDestroy {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
      }
    }

    AsyncFunction("enable") {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      for window in scenes.flatMap(\.windows) {
        guard let root = window.rootViewController else { continue }
        let mine = Set(root.keyCommands?.compactMap(\.input) ?? [])
        for (input, step) in [("=", 1), ("+", 1), ("-", -1), ("0", 0)] where !mine.contains(input) {
          let command = UIKeyCommand(input: input, modifierFlags: .command, action: Self.selector(for: step))
          command.wantsPriorityOverSystemBehavior = true
          root.addKeyCommand(command)
        }
        ZoomGestures.shared.install(on: window)
      }
    }.runOnQueue(.main)
  }

  private static func selector(for step: Int) -> Selector {
    switch step {
    case 1: return #selector(UIViewController.longviewZoomIn)
    case -1: return #selector(UIViewController.longviewZoomOut)
    default: return #selector(UIViewController.longviewZoomReset)
    }
  }
}

// Key commands send their action up the responder chain, which starts at the root view controller.
extension UIViewController {
  @objc func longviewZoomIn() { postZoom(1) }
  @objc func longviewZoomOut() { postZoom(-1) }
  @objc func longviewZoomReset() { postZoom(0) }

  private func postZoom(_ step: Int) {
    NotificationCenter.default.post(name: zoomNotification, object: nil, userInfo: ["step": step])
  }
}

/// ⌘ + scroll wheel and trackpad pinch on a window. While ⌘ is held the wheel zooms instead of scrolling.
private final class ZoomGestures: NSObject, UIGestureRecognizerDelegate {
  static let shared = ZoomGestures()

  /// Scroll distance, and pinch scale, per zoom step.
  private let wheelStep: CGFloat = 40
  private let pinchStep: CGFloat = 0.18
  private var installed = Set<ObjectIdentifier>()
  private var wheel = 0.0

  func install(on window: UIWindow) {
    guard installed.insert(ObjectIdentifier(window)).inserted else { return }
    let pan = UIPanGestureRecognizer(target: self, action: #selector(onWheel))
    pan.allowedScrollTypesMask = .all
    pan.maximumNumberOfTouches = 0
    pan.delegate = self
    window.addGestureRecognizer(pan)

    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(onPinch))
    pinch.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
    pinch.delegate = self
    window.addGestureRecognizer(pinch)
  }

  @objc private func onWheel(_ g: UIPanGestureRecognizer) {
    guard g.state == .changed else { wheel = 0; return }
    wheel += g.translation(in: g.view).y
    g.setTranslation(.zero, in: g.view)
    while abs(wheel) >= wheelStep {
      post(wheel > 0 ? 1 : -1)
      wheel -= wheel > 0 ? wheelStep : -wheelStep
    }
  }

  @objc private func onPinch(_ g: UIPinchGestureRecognizer) {
    guard g.state == .changed else { return }
    if g.scale > 1 + pinchStep || g.scale < 1 - pinchStep {
      post(g.scale > 1 ? 1 : -1)
      g.scale = 1
    }
  }

  private func post(_ step: Int) {
    NotificationCenter.default.post(name: zoomNotification, object: nil, userInfo: ["step": step])
  }

  private func isWheel(_ g: UIGestureRecognizer) -> Bool { g is UIPanGestureRecognizer && g.delegate === self }

  func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
    isWheel(g) ? g.modifierFlags.contains(.command) : true
  }

  // With ⌘ held the list's own scrolling waits for the zoom gesture, so it doesn't scroll as well.
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
    isWheel(g) && g.modifierFlags.contains(.command)
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    !isWheel(g)
  }
}
