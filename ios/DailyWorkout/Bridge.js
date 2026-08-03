/* Injected into the page at document start, before app.js runs.

   The point of this file is that app.js needs no iOS-specific code. It already
   calls navigator.vibrate and navigator.wakeLock and guards for their absence;
   here we simply make them exist, backed by UIKit. The website and the app run
   the same source. */
(function () {
  'use strict';

  var handler = window.webkit
    && window.webkit.messageHandlers
    && window.webkit.messageHandlers.native;
  if (!handler) return;

  function post(msg) {
    try { handler.postMessage(msg); } catch (e) { /* shell went away */ }
  }

  window.NativeShell = { version: 1, post: post };

  /* Report what the shell actually installed, and whether this origin can
     store anything. Every byte of app state is in localStorage, so if that is
     ever blocked the app is silently useless — better a line in Console than a
     mystery. Visible in Console.app with the device attached, or via
     `xcrun simctl spawn booted log stream --predicate 'process == "Daily"'`. */
  function storageStatus() {
    try {
      var probe = '__dw_probe__';
      localStorage.setItem(probe, '1');
      var ok = localStorage.getItem(probe) === '1';
      localStorage.removeItem(probe);
      return ok ? 'ok' : 'unreadable';
    } catch (e) {
      return 'blocked:' + (e && e.name);
    }
  }

  /* Safari has no vibration API on any platform — confirmed on iOS 26.5, where
     navigator.vibrate is undefined. Route the app's existing calls to real
     UIKit haptics instead. */
  if (typeof navigator.vibrate !== 'function') {
    try {
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        writable: true,
        value: function (pattern) {
          post({ action: 'haptic', pattern: Array.isArray(pattern) ? pattern : [pattern] });
          return true;
        }
      });
    } catch (e) { /* leave it undefined; the app already handles that */ }
  }

  /* The Wake Lock API needs a secure context, and a custom URL scheme is not
     one. Hand it to UIApplication.isIdleTimerDisabled, wearing the same shape
     app.js expects back from navigator.wakeLock.request('screen'). */
  if (!('wakeLock' in navigator)) {
    try {
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: function () {
            post({ action: 'keepAwake', on: true });
            return Promise.resolve({
              type: 'screen',
              released: false,
              release: function () {
                post({ action: 'keepAwake', on: false });
                this.released = true;
                return Promise.resolve();
              },
              addEventListener: function () {},
              removeEventListener: function () {}
            });
          }
        }
      });
    } catch (e) { /* app.js falls back to no wake lock */ }
  }

  post({
    action: 'ready',
    vibrate: typeof navigator.vibrate === 'function',
    wakeLock: 'wakeLock' in navigator,
    storage: storageStatus(),
    keys: (function () { try { return localStorage.length; } catch (e) { return -1; } })()
  });
})();
