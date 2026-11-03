import ExpoModulesCore
import UIKit

private let zoomNotification = Notification.Name("LongviewZoomKeyCommand")

/// Adds ⌘+ / ⌘− / ⌘0 to the app's root view controller and forwards them to JS as "onZoom".
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
