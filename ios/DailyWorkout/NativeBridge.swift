import UIKit
import WebKit

/// Receives `window.webkit.messageHandlers.native` calls from Bridge.js.
///
/// The web app is not modified to talk to this. Bridge.js installs polyfills
/// under the standard names the app already calls — `navigator.vibrate`,
/// `navigator.wakeLock` — and they land here. One codebase serves both the
/// website and the app; the shell just makes the missing APIs exist.
final class NativeBridge: NSObject, WKScriptMessageHandler {
    static let messageName = "native"

    private let impact = UIImpactFeedbackGenerator(style: .medium)
    private let lightImpact = UIImpactFeedbackGenerator(style: .light)

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == Self.messageName,
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "haptic":
            let pattern = (body["pattern"] as? [Any])?.compactMap { toMilliseconds($0) } ?? []
            playHaptic(pattern: pattern)

        case "keepAwake":
            let on = body["on"] as? Bool ?? false
            UIApplication.shared.isIdleTimerDisabled = on

        case "ready":
            // One line at startup saying what the shell installed and whether
            // this origin can persist anything. All app state is localStorage,
            // so "storage=blocked" is the difference between a working app and
            // one that silently forgets everything.
            let vibrate = body["vibrate"] as? Bool ?? false
            let wakeLock = body["wakeLock"] as? Bool ?? false
            let storage = body["storage"] as? String ?? "?"
            let keys = body["keys"] as? Int ?? -1
            NSLog("DailyWorkout: bridge ready — vibrate=\(vibrate) wakeLock=\(wakeLock) storage=\(storage) storedKeys=\(keys)")

        default:
            NSLog("DailyWorkout: unknown bridge action '\(action)'")
        }
    }

    private func toMilliseconds(_ value: Any) -> Int? {
        if let n = value as? Int { return n }
        if let d = value as? Double { return Int(d) }
        if let s = value as? String { return Int(s) }
        return nil
    }

    /// Replays a `navigator.vibrate` pattern as UIKit haptics.
    ///
    /// The pattern alternates buzz, pause, buzz… so the even indices are the
    /// pulses and the odd ones are gaps. Reproducing the rhythm matters: the
    /// app uses a single short tap for "saved", and a three-pulse pattern for
    /// "your rest is over" — those should not feel identical.
    private func playHaptic(pattern: [Int]) {
        guard !pattern.isEmpty else { return }

        if pattern.count == 1 {
            let generator = pattern[0] < 50 ? lightImpact : impact
            generator.prepare()
            generator.impactOccurred()
            return
        }

        impact.prepare()
        var delay: Double = 0
        for (index, duration) in pattern.enumerated() {
            if index.isMultiple(of: 2) {
                let at = delay
                DispatchQueue.main.asyncAfter(deadline: .now() + at) { [weak self] in
                    self?.impact.impactOccurred()
                }
            }
            delay += Double(duration) / 1000.0
        }
    }
}
