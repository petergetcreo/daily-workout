# Daily Workout — iOS app

A thin native shell around the same web app that runs at
`petergetcreo.github.io/daily-workout`. There is no second copy of the app
here: `index.html`, `app.js`, `engine.js`, `exercises.js`, `style.css` and the
icons are copied out of the repo root into the bundle at build time.

## Why it exists

Three things a home-screen web app cannot do on iOS, all of which matter to a
rest timer you set the phone down next to:

| | Safari PWA | This shell |
|---|---|---|
| Beep with the phone on silent | No — iOS mutes Web Audio via the hardware switch | Yes — `AVAudioSession` set to `.playback` |
| Haptics | No — Safari has no `navigator.vibrate` | Yes — bridged to `UIImpactFeedbackGenerator` |
| Keep the screen awake | Only where Wake Lock is available | Yes — `UIApplication.isIdleTimerDisabled` |
| Announce a rest you walked away from | No — JS timers stop when the app is suspended | Yes — a scheduled `UNNotificationRequest` |

The web app is **not** modified for any of this. `Bridge.js` is injected before
`app.js` runs and installs `navigator.vibrate` and `navigator.wakeLock` under
their standard names, backed by UIKit. The website and the app run identical
source.

## Building

```sh
cd ios
xcodegen generate        # only after editing project.yml
open DailyWorkout.xcodeproj
```

The `.xcodeproj` is committed, so Xcode works without XcodeGen installed. Edit
`project.yml` rather than the project, then regenerate.

From the command line:

```sh
xcodebuild -project DailyWorkout.xcodeproj -scheme DailyWorkout \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath ./build build
```

## Signing and getting it on the phone

This is a one-person app, so it installs straight from Xcode. **No TestFlight,
no App Store Connect record, no App Review.** Once the Apple Developer Program
enrollment is active:

1. Xcode → target **DailyWorkout** → **Signing & Capabilities** → set **Team**.
   Leave "Automatically manage signing" on — it registers the device and issues
   the profile without any portal visits.
2. Plug the phone in, trust the Mac, pick it as the run destination.
3. **Product → Run.**

That is the whole thing. Once the device is paired, "Connect via network" in
**Window → Devices and Simulators** means later runs need no cable.

**The install lasts a year**, which is the life of the development provisioning
profile — not the 7 days that free personal-team signing gives you, and not the
90 days a TestFlight build gets. Re-running from Xcode after any change renews
it, so in practice it never expires on its own. Let the $99 membership lapse
and the app stops launching.

<details>
<summary>If a second person ever needs it</summary>

Then it becomes a TestFlight job: create the app record in App Store Connect
with bundle ID `com.petergetcreo.dailyworkout`, **Product → Archive →
Distribute App → TestFlight & App Store**, and add them under TestFlight.
Adding someone as an **internal** tester (an App Store Connect user) skips App
Review entirely and needs no privacy policy; external testers need a one-time
review of the first build. TestFlight builds expire 90 days after upload —
upload a new one to refresh, and the app's data stays put.
</details>

## Rest notifications

`startRest` hands the deadline to the system; `stopRest`/`endRest` cancel it.
iOS suppresses the notification while the app is in front, so it only surfaces
if you actually switched away — you never get a banner duplicating the beep and
flash you are already looking at.

Permission is requested on the first rest, not at launch, so the prompt arrives
attached to something you just did.

**Verified end to end** in the Simulator on 2026-08-04: permission granted, a
notification scheduled, the app backgrounded, banner delivered. That confirms
the whole path — authorization, `UNNotificationRequest`, and delivery — which
the daily reminders below share.

## Daily reminders

Two optional nudges, set in Settings → Reminders: one in the morning, and one
later that only arrives if the workout is still unlogged.

These exist only here. A web page cannot schedule anything for tomorrow —
`setTimeout` dies with the tab, Web Push needs a server this app deliberately
does not have, and the Notification Triggers API never shipped in Safari — so
`app.js` hides the whole settings block unless `NativeShell.setReminders`
exists.

iOS cannot evaluate a condition when a notification fires, so "only if I have
not trained" is resolved in advance. `reconcileReminders()` in `app.js` works
out which of the next seven days still need a nudge and hands over the entire
schedule; `Reminders.swift` replaces everything pending with it. Each day is
its own request, which is what makes a single day's reminder withdrawable when
that day gets completed. Reconciling on every launch keeps the seven-day window
topped up, so the reminders survive a stretch of not opening the app.

## Data does not carry over from the website

`localStorage` is per-origin, and the app's origin (`dwapp://local`) is not the
website's. The app starts empty. To bring history across: **Settings → Export**
in the web app, then **Settings → Import → Replace** in the app.

Verified on iOS 26.5: storage on the custom scheme both works and survives
relaunches. The bridge logs a line at every launch confirming it —

```sh
xcrun simctl spawn booted log stream --predicate 'process == "Daily"'
# DailyWorkout: bridge ready — vibrate=true wakeLock=true storage=ok storedKeys=0
```

With a real device attached, the same line shows in Console.app. `storage=ok` is
the one to check: every byte of app state lives in `localStorage`, so anything
else means the app will silently forget everything.

## Files

```
project.yml                 project definition — edit this, not the .xcodeproj
DailyWorkout/
  AppDelegate.swift         audio session (the mute-switch fix) + window
  WebViewController.swift   full-screen WKWebView host
  BundleSchemeHandler.swift serves the bundled web app over dwapp://
  NativeBridge.swift        receives JS calls — haptics, wake lock, diagnostics
  RestNotifier.swift        notification for a rest that ends in the background
  Bridge.js                 injected at document start; installs the polyfills
  Assets.xcassets/          app icon (generated by ../make-icons.py) + launch colour
```

`sw.js` is deliberately not bundled: service workers do not run on a custom URL
scheme, and there is nothing for one to do when every asset is already local.
