import UIKit
import WebKit

/// Full-screen host for the bundled web app.
final class WebViewController: UIViewController {

    /// Matches --bg in style.css. Set on the view and the web view so there is
    /// no white flash between launch screen and first paint.
    private static let background = UIColor(red: 0x0E / 255.0,
                                            green: 0x10 / 255.0,
                                            blue: 0x14 / 255.0,
                                            alpha: 1)

    private var webView: WKWebView!
    private let bridge = NativeBridge()

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.background

        guard let webRoot = Bundle.main.resourceURL?.appendingPathComponent("web"),
              FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("index.html").path) else {
            showBundleError()
            return
        }

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundleSchemeHandler(root: webRoot),
                                          forURLScheme: BundleSchemeHandler.scheme)

        // The rest-timer tone is scheduled from a JS interval, not a tap, so it
        // must not require a user gesture to play.
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let controller = WKUserContentController()
        controller.add(bridge, name: NativeBridge.messageName)
        if let bridgeSource = Self.loadBridgeScript() {
            controller.addUserScript(WKUserScript(source: bridgeSource,
                                                  injectionTime: .atDocumentStart,
                                                  forMainFrameOnly: true))
        }
        configuration.userContentController = controller

        let webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = Self.background
        webView.scrollView.backgroundColor = Self.background
        webView.allowsLinkPreview = false
        webView.scrollView.alwaysBounceHorizontal = false
        // index.html carries viewport-fit=cover and the CSS reads
        // env(safe-area-inset-*), so the page handles its own insets. UIKit
        // adding a second set on top would double them.
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        self.webView = webView

        webView.load(URLRequest(url: BundleSchemeHandler.startURL))
    }

    private static func loadBridgeScript() -> String? {
        guard let url = Bundle.main.url(forResource: "Bridge", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            NSLog("DailyWorkout: Bridge.js missing — haptics and wake lock will be unavailable")
            return nil
        }
        return source
    }

    /// If the web-bundling build phase did not run, fail loudly rather than
    /// showing an empty black screen nobody can diagnose.
    private func showBundleError() {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        label.text = "The web app is missing from the bundle.\n\n"
            + "The \"Bundle web app\" build phase did not run.\n"
            + "Check it in Xcode under Build Phases."
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])
    }
}
