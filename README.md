# Daily Workout

A phone-installable PWA that gives you one workout per day, built around the
equipment you actually have. No account, no network, no backend — everything is
generated on-device and stored in `localStorage`.

## How the programming works

A 7-day rotation, keyed to the calendar date — one full cycle per week, so a
given focus always lands on the same weekday:

| Day | Focus | What it is |
|----:|-------|------------|
| 1 | Push | Chest, shoulders, triceps |
| 2 | Pull | Back, rear delts, biceps |
| 3 | Legs | Squat, hinge, single leg |
| 4 | Recovery | Mobility and easy movement |
| 5 | Full Body | One of everything, moving |
| 6 | Engine + Core | Conditioning and midsection |
| 7 | Recovery | Mobility and easy movement |

Each muscle gets its direct day plus a second touch on Full Body day (~2× a
week), and the two recovery days split the hard training days apart.

Each day the app fills that focus's *slots* (e.g. Push = main press, second
press, accessory, triceps) from `exercises.js`, then adds a 3-move warm-up and a
conditioning finisher.

Selection is **deterministic from the date** — the same day always produces the
same workout, so it will not reshuffle when you close and reopen the app
mid-session. Different days produce different workouts, with one deliberate
exception:

- **Primary lifts run in 21-day blocks.** The heavy slots (main press, rows,
  squat, hinge) pick the same movements for a whole block, then rotate. Double
  progression needs to see the same lift week after week to work; accessories
  still vary day to day, where novelty is cheap.

Rules that keep the output sensible:

- **Equipment filtering.** An exercise only appears if *every* piece of gear it
  needs is switched on in Settings. Turn off the rack and bench and you get a
  legitimate hotel-room session, not a broken one.
- **Primary slots prefer load.** If a rack is available, Push day opens with a
  press, not a push-up. Bodyweight movements fill primary slots only when
  nothing loaded is available.
- **Warm-ups lean toward the day.** Leg day warms up hips and ankles, not
  shoulders; upper days get arm circles and scap work.
- **The finisher avoids the day's trained muscles.** No kettlebell swing ladder
  stacked on top of leg day.
- **The day's first heavy compound gets ramp-up sets** (~50% × 5, ~75% × 3,
  rounded to plate math) once a working weight is known, instead of jumping
  straight to work-set load.

Session length rescales sets, reps, and slot count: Short ≈ 15–25 min,
Standard ≈ 21–30 min, Long ≈ 41–52 min. Short days cut date-rotated non-primary
slots — not always the same tail — so arms and calves still show up over a week
of short sessions.

## Logging sets and progressive overload

Tapping a set is the main interaction, so it carries the weight:

- **One tap logs the set at the top of the rep range.** Hitting your target is
  a single tap — the common case costs nothing.
- **Tapping an already-logged set counts it down one rep**, for the days you
  came up short. The button shows the reps performed rather than the set number.
- **Dropping below the bottom of the range un-logs** that set and any after it.
- Sets that reached the top of the range get a green ring, so a good session is
  readable at a glance.
- Timed work (planks, intervals) has no rep range and just toggles done.

The default for a newly logged set is the top of the range, or what you managed
last time if that was lower — so a bad week doesn't make you tap five times per
set to correct it.

**Progression** uses double progression: work inside the rep window at a fixed
load, and once *every prescribed set* reaches the top of the window, the app
suggests adding weight (5 lb, or 2.5 kg). The suggestion appears on the card
next to what you did last time, and becomes the placeholder in the weight field.

**Stalls deload instead of holding forever.** Three consecutive completed
sessions at the same load without hitting the top of the window and the
suggestion becomes a ~10% drop (rounded to plate math) to rebuild from —
double progression is only self-correcting if it has an exit.

**Stale history never pushes weight.** A suggestion computed from a session
more than four weeks back (a rotated-out block, a vacation) repeats the old
load instead of advancing; past eight weeks it knocks the load down a notch.

**Bodyweight movements progress by reps, then by variation.** Below the top of
the window the card suggests one rep past your weakest set; top out every set
and it points at the next variation up (push-up → decline push-up → pike
push-up), when your equipment allows it.

**A recorded max seeds new lifts.** The first time a lift with no history
appears, if you have a max recorded for it, the card suggests a conservative
starting weight (inverted Epley at the top of the rep window, rounded down).

**Load steps match the equipment.** Free weights step 5 lb / 2.5 kg (dumbbells
are logged per hand); cable movements step double, matching real stacks.

One deliberate restraint:

- An **unfinished session never earns an increase**. Logging one strong set and
  walking away would otherwise ratchet the suggested load up off work that
  never happened.

## About you

An optional profile (Settings → About you) that stays on the device. Every
field earns its place by changing something:

- **Name** — the Today header greets you by it, matched to the time of day.
- **Age** — conditioning work and cardio finishers show heart-rate targets
  (from the plain 220 − age estimate: easy ≈ 60–70%, hard ≈ 80–90%), and past
  fifty the warm-up grows to four movements at 40 seconds each.
- **Experience** — sets how long the heavy lifts stay in rotation: new to it =
  4-week blocks (repetition to learn the lifts), regular = 3 weeks, seasoned =
  2 weeks (earned variety).

## The PT test

An optional ten-minute capacity test — 2 minutes each of max push-ups,
sit-ups, and air squats (with rests), then a timed mile — offered on first
open and retakeable from Settings. Not a max-lift test: the bar already
personalizes loaded work, so the test calibrates everything the bar can't.

- **Push-up and squat counts size bodyweight rep windows** directly: work
  sets land at 30–45% of the 2-minute max (test 40 push-ups → train 12–18;
  test 10 → train 4–6), clamped to a sane 4–25.
- **Sit-ups scale timed core doses**, ±30% around a 40-rep baseline.
- **The mile scales conditioning volume** — interval and cardio doses —
  ±30% around a 10:00 baseline.
- Skipped stations leave their domain on the defaults, and the pull chain is
  deliberately untouched: a push-up count says nothing about pull-ups.

The sheet includes a 2:00 station timer (the rest timer, repurposed). Which
exercises appear never changes — only the prescriptions.

## Goals

Set a target on a lift (an estimated 1RM — "bench 250") or a bodyweight
movement (a best single set — "20 push-ups") from the Progress tab, and the
programming aims at it, three ways:

- **The goal movement is pinned.** Any slot that can host it, gets it — on its
  own day *and* on full-body day — instead of rotating with the block.
  Rerolling still swaps it out for the day. Capped at 3 active goals, one per
  slot at a time; a program that chases everything catches nothing.
- **Load goals train heavy.** The pinned lift runs a strength scheme (4 × 4–6
  standard, longer rests) on its primary day, while the full-body touch stays
  in the normal window. Rep goals keep the normal scheme — the existing
  rep-target machinery does the pushing.
- **Distance is measured.** Each goal shows current-best vs target (estimated
  1RM from every logged session and recorded max, or best single set) with a
  progress bar, and the goal lift's card carries a "→ 250 lb" tag. Crossing
  the target marks the goal achieved with the date, and achieved goals stop
  steering the program.

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

**Lift trends** (Progress tab) — a 90-day sparkline per lift, valued at the
Epley estimate of each session's top set (so 155 × 8 charts higher than
155 × 6), with the change across the window. Shows the eight most recently
trained lifts that have at least two logged sessions.

## Using it

- Tap a set number to log it — that starts the rest timer automatically, sized
  to the movement (100s for compounds, 40s for core and intervals). The timer
  counts against the wall clock, so locking the phone can't freeze it, and it
  holds a screen wake lock while running where the browser supports one.
- When the rest runs out it beeps *and* flashes the screen green for a beat.
  Both, because neither is enough alone on a phone: iOS silences Web Audio
  with the hardware mute switch, and Safari has no vibration API to fall back
  on, so on a silenced phone the flash is the only cue that lands. The wake
  lock means the screen is already awake to show it.
- Timed work (planks, carries, intervals) progresses by duration: complete
  every prescribed set a few sessions running and the card suggests +5 seconds
  per completed session, capped at +30.
- Tap the last logged set again to un-log it.
- **↻** on any exercise swaps it for another that trains the same slot.
- Weight fields remember your last working weight per exercise and show it as
  the placeholder next time. Rolled up under History → Working weights.
- "Change today's focus" overrides the rotation for today only.
- Streak counts consecutive days marked complete. Not marking today does not
  break yesterday's streak until the day rolls over.
- Tap any day in the Progress calendar to see what that day actually recorded
  — lifts, loads, reps, and the body weight entry, read-only.
- On first open, a one-time setup sheet collects the profile (name, age,
  experience) and equipment before the first workout — skippable, everything
  editable later in Settings. A separate one-time card on Today explains the
  tap-to-log gesture.

## Files

```
index.html            structure
style.css             all styling
exercises.js          the exercise library, day rotation, set/rep schemes
engine.js             generation logic — pure, no DOM, no storage
app.js                rendering, storage, timer, wiring
test/engine.test.js   test suite for the engine
sw.js                 service worker (offline caching)
manifest.json         PWA metadata
make-icons.py          regenerates icons/ using only the stdlib
package.json          npm test / npm run serve
```

### Why the engine is separate

`engine.js` holds everything that decides *what you train*: the rotation, slot
filling, equipment filtering, set/rep schemes, duration estimates, 1RM math. It
touches no DOM and no `localStorage` — every function takes what it needs as an
argument and returns a value.

That buys two things. It can be tested headlessly in Node, and it is the piece
that ports if this ever becomes a native iOS app, where the rendering layer
gets rebuilt but the programming logic shouldn't have to be rewritten from
scratch.

`app.js` owns state and rendering, and calls into the engine. Keep that
direction — the engine should never reach back into the UI.

## Tests

```sh
npm test          # or: node --test test/engine.test.js
```

89 tests covering library integrity, the rotation, goal pinning, PT-test
calibration, profile effects (experience block lengths, age-scaled warm-ups,
heart-rate zones), plan generation across five
equipment setups × three session lengths × a full year of dates, determinism,
training blocks, reroll behaviour, short-session slot rotation, warm-up and
finisher steering, ramp-up sets, equipment gating (including the kettlebell
toggle), local-vs-UTC date handling, rep-range parsing, progression, deload
and staleness rules, bodyweight rep targets, timed-work duration progression,
max-seeded starting weights, and the 1RM math.

The suite has been mutation-tested — deliberately breaking the primary-slot
preference, the date handling, the Epley formula, reroll determinism, the
finisher rule, or equipment filtering each makes it fail. If you edit
`exercises.js`, the integrity and placement tests are the ones that will catch
a mistyped slot or an unknown equipment code.

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
`dw.body` (body weight), `dw.maxes`, `dw.goals`. Reps live in `dw.log` under
`[date].reps[exerciseId]` as an array, one entry per completed set.

All dates are keyed to your **local** calendar day, not UTC, so a late-night
weigh-in files under the day you were actually living in.

Switching lb/kg asks whether to **convert** every stored number (lift loads to
the nearest 0.5, body weight to 0.1 — the history is a record being restated,
not a plate suggestion) or just relabel.

Settings → Export writes a JSON backup. Settings → Import restores one —
either **replace** (wipe this device, then load the file) or **merge** (union
of both; this device wins where both logged the same day or lift, and maxes
keep whichever record is heavier). Files are validated before anything is
touched. Settings → Erase clears it all. Because it is per-origin storage,
moving to a different URL starts fresh — export from the old one, import into
the new one.
