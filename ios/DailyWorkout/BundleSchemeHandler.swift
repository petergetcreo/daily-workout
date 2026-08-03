import Foundation
import WebKit

/// Serves the bundled web app over a custom URL scheme.
///
/// The obvious alternative — `loadFileURL` — gives the page a `file://` origin,
/// where WebKit's storage rules are inconsistent. Every byte of this app's
/// state is in `localStorage`, so an origin that might not persist is not a
/// risk worth taking. A registered scheme gets a stable, ordinary origin
/// (`dwapp://local`), and storage behaves like it does on a website.
///
/// What that origin does NOT get is a secure context, so `navigator.wakeLock`
/// and service workers are unavailable. Neither matters here: Bridge.js hands
/// wake lock to `UIApplication.isIdleTimerDisabled`, and offline caching is
/// meaningless when the assets are already in the bundle.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "dwapp"
    static let host = "local"

    /// `dwapp://local/index.html`
    static var startURL: URL {
        URL(string: "\(scheme)://\(host)/index.html")!
    }

    private let root: URL

    /// - Parameter root: directory inside the bundle holding the web app.
    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js":   "text/javascript; charset=utf-8",
        "css":  "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "png":  "image/png",
        "svg":  "image/svg+xml",
        "ico":  "image/x-icon",
        "txt":  "text/plain; charset=utf-8",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        let fileURL = root.appendingPathComponent(path).standardizedFileURL

        // Refuse anything that resolves outside the bundled web directory. The
        // only requests should be our own, but a path is still input.
        guard fileURL.path.hasPrefix(root.path + "/") || fileURL.path == root.path else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let ext = fileURL.pathExtension.lowercased()
        let mime = Self.mimeTypes[ext] ?? "application/octet-stream"

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime,
                "Content-Length": String(data.count),
                // Everything is local; never let WebKit hold a stale copy
                // across an app update.
                "Cache-Control": "no-store",
            ]
        )!

        // Handled synchronously, so there is no window in which `stop` could
        // race a later callback on a task WebKit has already torn down.
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Nothing to cancel — `start` completes before it returns.
    }
}
