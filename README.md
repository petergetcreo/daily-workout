# Daily Workout

A phone-installable PWA that gives you one workout per day, built around the
equipment you actually have. No account, no network, no backend — everything is
generated on-device and stored in `localStorage`.

## How the programming works

A 6-day rotation, keyed to the calendar date:

| Day | Focus | What it is |
|----:|-------|------------|
| 1 | Push | Chest, shoulders, triceps |
| 2 | Pull | Back, rear delts, biceps |
| 3 | Legs | Squat, hinge, single leg |
| 4 | Engine + Core | Conditioning and midsection |
| 5 | Full Body | One of everything, moving |
| 6 | Recovery | Mobility and easy movement |

Each day the app fills that focus's *slots* (e.g. Push = main press, second
press, accessory, triceps) from `exercises.js`, then adds a 3-move warm-up and a
conditioning finisher.

Selection is **deterministic from the date** — the same day always produces the
same workout, so it will not reshuffle when you close and reopen the app
mid-session. Different days produce different workouts.

Two rules keep the output sensible:

- **Equipment filtering.** An exercise only appears if *every* piece of gear it
  needs is switched on in Settings. Turn off the rack and bench and you get a
  legitimate hotel-room session, not a broken one.
- **Primary slots prefer load.** If a rack is available, Push day opens with a
  press, not a push-up. Bodyweight movements fill primary slots only when
  nothing loaded is available.

Session length rescales sets, reps, and slot count: Short ≈ 15–25 min,
Standard ≈ 21–30 min, Long ≈ 41–52 min.

## Tracking

**Body weight** (Progress tab) — one entry per day, logged in whatever unit is
set in Settings. Shows the latest number, the change against the entry nearest
30 days back, and a 90-day sparkline drawn as inline SVG. Logging again on the
same day overwrites; submitting an empty field deletes that day's entry.

**Maxes** (Progress tab) — a recorded best for each *applicable lift*, which
means the 21 loaded compound movements (bench, squat, OHP, rows, RDLs, and so
on). Curls, lateral raises, and calf raises are deliberately excluded, since a
"max" there is not a useful number.

Each max stores weight, reps, and date, and displays an Epley estimated 1RM
(`w × (1 + reps/30)`) when reps > 1. Above 12 reps the estimate stops being
shown, because Epley drifts badly out there. Add one with **＋**, or tap any
row to edit or clear it.

During a session, if the weight you log on an applicable lift is *higher* than
that lift's recorded max, a **PR?** chip appears on the card. Tapping it opens
the max editor pre-filled with that weight and the prescribed rep target, so
banking a PR is two taps. Equalling your max does not trigger it — only beating
it does.

Note that a max and a *last working weight* are different things and the app
tracks both: the max is your best ever, the working weight is simply what you
loaded most recently, and it appears as the placeholder in the weight field
next time that lift comes up.

## Using it

- Tap a set number to log it — that starts the rest timer automatically, sized
  to the movement (100s for compounds, 40s for core and intervals).
- Tap the last logged set again to un-log it.
- **↻** on any exercise swaps it for another that trains the same slot.
- Weight fields remember your last working weight per exercise and show it as
  the placeholder next time. Rolled up under History → Working weights.
- "Change today's focus" overrides the rotation for today only.
- Streak counts consecutive days marked complete. Not marking today does not
  break yesterday's streak until the day rolls over.

## Files

```
index.html      structure
style.css       all styling
exercises.js    the exercise library, day rotation, set/rep schemes
app.js          plan generation, rendering, storage, timer
sw.js           service worker (offline caching)
manifest.json   PWA metadata
make-icons.py   regenerates icons/ using only the stdlib
```

## Editing the library

Add an exercise by appending to `EXERCISES` in `exercises.js`:

```js
{ id: 'unique-id', name: 'Display Name',
  slots: ['push_acc'],        // where it can appear
  equip: ['db', 'bench'],     // ALL of these must be enabled
  type:  'accessory',         // drives sets/reps via SCHEMES
  load:  true,                // show a weight field
  cue:   'One short form cue.' }
```

To change volume globally, edit `SCHEMES` and `REST` at the bottom of the same
file. To change the rotation, edit `FOCI` and `FOCUS_ORDER`.

The service worker is **network-first with a 2.5s timeout**, so a deploy shows
up on the next load whenever you have signal, and falls back to the cache when
you don't. Bump `CACHE` in `sw.js` when you add or rename a file in `ASSETS`,
so the precache list stays honest.

## Running locally

```sh
cd ~/Desktop/daily-workout
python3 -m http.server 4321 --bind 127.0.0.1
# open http://127.0.0.1:4321
```

## Getting it on the phone

Needs to be served over HTTPS (or `localhost`) for the service worker and
offline mode to work. Any static host does it — GitHub Pages, Cloudflare Pages,
Netlify. Then on the phone: open the URL in Safari → Share → **Add to Home
Screen**. It gets an icon, opens fullscreen with no browser chrome, and works
with no signal.

Over plain HTTP on your LAN it will still install to the home screen and run,
but iOS blocks service workers on insecure origins, so it will not work offline.

## Data

Everything is in `localStorage` on the device — nothing leaves the phone. Keys:
`dw.settings`, `dw.log` (per-day sets and completion), `dw.weights` (last
working weight per lift), `dw.overrides` (focus changes and swaps),
`dw.body` (body weight), `dw.maxes`.

All dates are keyed to your **local** calendar day, not UTC, so a late-night
weigh-in files under the day you were actually living in.

Switching lb/kg relabels the display but does **not** convert numbers you
already logged.

Settings → Export writes a JSON backup. Settings → Erase clears it all.
Because it is per-origin storage, moving to a different URL starts fresh.
