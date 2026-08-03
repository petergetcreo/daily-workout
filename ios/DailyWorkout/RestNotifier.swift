import Foundation
import UserNotifications

/// Raises a notification when a rest runs out while the app is not in front.
///
/// This exists because JavaScript timers are not dependable in the background:
/// once the app is suspended, `setInterval` stops firing, so the web layer
/// cannot announce anything on its own. A notification is scheduled with the
/// system up front and fires whether or not the app is still running.
///
/// It deliberately does NOT show while the app is in the foreground. With no
/// `UNUserNotificationCenterDelegate` installed, iOS suppresses foreground
/// notifications by default — which is what we want, since the app's own beep
/// and green flash already handle that case. The pending request is cancelled
/// on the way out too, so there is no race to lose.
final class RestNotifier {
    private static let identifier = "rest-over"

    /// nil until the user has been asked once.
    private var authorized: Bool?

    func schedule(after seconds: TimeInterval, body: String) {
        // Anything shorter than this cannot survive the round trip usefully.
        guard seconds > 1 else { return }

        requestAuthorizationIfNeeded { [weak self] granted in
            guard granted else { return }
            self?.post(after: seconds, body: body)
        }
    }

    func cancel() {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [Self.identifier])
    }

    /// Asked on the first rest rather than at launch, so the permission prompt
    /// arrives attached to something the user just did.
    private func requestAuthorizationIfNeeded(_ completion: @escaping (Bool) -> Void) {
        if let authorized {
            completion(authorized)
            return
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error {
                NSLog("DailyWorkout: notification authorization failed — \(error.localizedDescription)")
            }
            DispatchQueue.main.async {
                self.authorized = granted
                completion(granted)
            }
        }
    }

    private func post(after seconds: TimeInterval, body: String) {
        let content = UNMutableNotificationContent()
        content.title = "Rest over"
        content.body = body.isEmpty ? "Next set is up." : body
        content.sound = .default
        // Worth knowing: notification sound obeys the ringer switch, so on a
        // silenced phone this arrives as a banner and a haptic rather than a
        // tone. That is still more than the web app could manage.
        //
        // `.timeSensitive` would also break through a Focus mode, but it needs
        // the Time Sensitive Notifications entitlement enabled on the app ID —
        // worth adding once the Developer Program account is set up.

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        let request = UNNotificationRequest(identifier: Self.identifier,
                                            content: content,
                                            trigger: trigger)

        let center = UNUserNotificationCenter.current()
        // One pending rest notification at a time — a re-schedule replaces.
        center.removePendingNotificationRequests(withIdentifiers: [Self.identifier])
        center.add(request) { error in
            if let error {
                NSLog("DailyWorkout: could not schedule rest notification — \(error.localizedDescription)")
            }
        }
    }
}
