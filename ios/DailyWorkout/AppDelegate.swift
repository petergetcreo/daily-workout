import UIKit
import AVFoundation

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    /// The entire reason this app is native rather than a home-screen web app.
    ///
    /// In Safari, Web Audio is silenced by the hardware mute switch — verified
    /// in the Simulator: with output muted the AudioContext stays suspended and
    /// the rest-timer tone never plays. A phone on silent, which is how most
    /// phones live, got no audible cue at all.
    ///
    /// The `.playback` category tells iOS this audio is the point of the app,
    /// not incidental, and it plays through the mute switch. `.mixWithOthers`
    /// keeps whatever you are listening to alive — killing someone's music to
    /// beep at them would be a poor trade — and `.duckOthers` dips it for the
    /// half second the beep needs so it is actually audible over a chorus.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
            try session.setActive(true)
        } catch {
            // Not fatal: the app still works, the beep just behaves like the
            // web version did. The green flash covers this case regardless.
            NSLog("DailyWorkout: audio session setup failed — \(error.localizedDescription)")
        }
    }
}
