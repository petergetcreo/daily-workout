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

  /* app.js feature-detects this object and calls through it. In a browser it
     simply does not exist, and every call site is guarded. */
  window.NativeShell = {
    version: 3,
    post: post,

    /* Daily training reminders. app.js checks for this function's existence to
       decide whether to offer the setting at all — on the website there is no
       way to schedule anything for tomorrow, so the option is hidden rather
       than shown and quietly broken.

       `items` is the complete schedule, and replaces whatever is pending. The
       web layer decides which days still need a nudge because it is the side
       that knows which days are already logged. */
    setReminders: function (items) {
      post({ action: 'setReminders', items: items || [] });
    },

    /* A rest that runs out while the app is backgrounded cannot announce
       itself from JavaScript — the interval stops firing once iOS suspends
       the app. Hand the deadline to the system instead. iOS suppresses this
       while the app is in front, so it only ever surfaces if you left. */
    scheduleRestEnd: function (seconds, label) {
      post({ action: 'scheduleRestEnd', seconds: Number(seconds) || 0, label: label || '' });
    },
    cancelRestEnd: function () {
      post({ action: 'cancelRestEnd' });
    }
  };

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
