import Foundation
import UserNotifications

/// Daily "go train" reminders.
///
/// These cannot exist in the web version of this app, which is why the setting
/// is hidden there rather than offered and quietly broken. A page cannot
/// schedule anything for tomorrow morning: `setTimeout` dies with the tab, Web
/// Push needs a server this app deliberately does not have, and the
/// Notification Triggers API never shipped in Safari. Only the shell can do it.
///
/// iOS cannot evaluate a condition when a notification fires, so "remind me
/// only if I have not trained yet" is done by scheduling each day as its own
/// request and cancelling the ones for days that get completed. The web layer
/// works out which days still need a nudge — it is the side that knows what is
/// logged — and hands over the whole list.
///
/// Every reconcile **replaces** the entire set rather than adding to it. That
/// makes the operation idempotent: there is no incremental state here to drift
/// out of sync with what the app actually believes.
final class Reminders {
    private static let prefix = "remind-"

    /// nil until the user has been asked once.
    private var authorized: Bool?

    func replaceAll(with items: [[String: Any]]) {
        let center = UNUserNotificationCenter.current()

        // Turning every reminder off must clear the queue without triggering a
        // permission prompt — asking for a capability at the moment someone
        // declines to use it is backwards.
        guard !items.isEmpty else {
            clearPending(in: center, then: nil)
            return
        }

        requestAuthorizationIfNeeded { [weak self] granted in
            guard let self else { return }
            self.clearPending(in: center) {
                guard granted else { return }
                for item in items {
                    Self.add(item, to: center)
                }
            }
        }
    }

    private func clearPending(in center: UNUserNotificationCenter,
                              then next: (() -> Void)?) {
        center.getPendingNotificationRequests { pending in
            let ours = pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            if !ours.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: ours)
            }
            next?()
        }
    }

    /// Asked when a reminder is first switched on, not at launch, so the
    /// prompt arrives attached to something the user just chose.
    private func requestAuthorizationIfNeeded(_ completion: @escaping (Bool) -> Void) {
        if let authorized {
            completion(authorized)
            return
        }
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound]) { granted, error in
                if let error {
                    NSLog("DailyWorkout: reminder authorization failed — \(error.localizedDescription)")
                }
                DispatchQueue.main.async {
                    self.authorized = granted
                    completion(granted)
                }
            }
    }

    private static func add(_ item: [String: Any], to center: UNUserNotificationCenter) {
        guard let id = item["id"] as? String,
              let year = intValue(item["year"]),
              let month = intValue(item["month"]),
              let day = intValue(item["day"]),
              let hour = intValue(item["hour"]),
              let minute = intValue(item["minute"]) else { return }

        let content = UNMutableNotificationContent()
        content.title = item["title"] as? String ?? "Daily Workout"
        content.body = item["body"] as? String ?? ""
        content.sound = .default

        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = hour
        comps.minute = minute

        // Not repeating: each day is its own request precisely so a completed
        // day's reminder can be withdrawn without touching the others.
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        let request = UNNotificationRequest(identifier: prefix + id,
                                            content: content,
                                            trigger: trigger)
        center.add(request) { error in
            if let error {
                NSLog("DailyWorkout: could not schedule \(id) — \(error.localizedDescription)")
            }
        }
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let n = value as? Int { return n }
        if let d = value as? Double { return Int(d) }
        if let s = value as? String { return Int(s) }
        return nil
    }
}
