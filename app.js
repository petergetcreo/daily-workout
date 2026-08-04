/* Daily Workout — offline PWA.
   All state is in localStorage. No network, no accounts, no backend. */

'use strict';

/* ======================= storage ======================= */

const KEY = {
  settings: 'dw.settings',
  log:      'dw.log',       // { "2026-07-27": { focus, complete, sets:{exId:n}, warm:{i:true}, weights:{exId:val} } }
                            //   sets are keyed by EXERCISE ID, never slot index: goal pinning and
                            //   short-mode trims can change which exercise sits at an index mid-day,
                            //   and logged work must stay with the movement that did it
  weights:  'dw.weights',   // { exId: "135" }  most recent working weight
  overrides:'dw.overrides', // { "2026-07-27": { focus, rerolls:{i:n}, finisherRoll:n } }
  body:     'dw.body',      // { "2026-07-27": 182.4 }  body weight log
  maxes:    'dw.maxes',     // { exId: { weight: 225, reps: 3, date: "2026-07-27" } }
  goals:    'dw.goals',     // { exId: { type: 'load'|'reps', target: 250, set: date, achieved: date|null } }
  onboard:  'dw.onboarded', // true once the how-logging-works card is dismissed
  setup:    'dw.setup',     // true once the first-open setup sheet is closed
  ptcard:   'dw.ptcard',    // true once the PT-test invitation is dismissed
};

const DEFAULT_SETTINGS = {
  length: 'standard',
  units: 'lb',
  equip: { bw: true, db: true, kb: true, bar: true, bench: true, cable: true, cardio: true },
  profile: { name: '', age: null, experience: 'regular' },
  /* Native app only — see reconcileReminders. */
  reminders: {
    morning: { on: false, time: '07:30' },
    evening: { on: false, time: '18:00' },
  },
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch (e) {
    return structuredClone(fallback);
  }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
}

/* Fold a stored or imported settings object onto the defaults.

   The nested objects need their own merge: a plain Object.assign would let a
   backup written by an older version drop `experience` or `equip.kb`
   outright, and an explicit null would replace the whole object and throw on
   the first render. Both the boot path and the import path go through here so
   they cannot drift — the import path used to normalize `equip` but not
   `profile`, which is exactly the kind of gap this closes. */
function normalizeSettings(raw) {
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  const s = Object.assign(structuredClone(DEFAULT_SETTINGS), obj(raw));
  s.equip   = Object.assign(structuredClone(DEFAULT_SETTINGS.equip), obj(s.equip));
  s.profile = Object.assign(structuredClone(DEFAULT_SETTINGS.profile), obj(s.profile));
  /* two levels deep, so a backup written before reminders existed still gets
     both slots rather than a half-built object that throws on first render */
  const rem = obj(s.reminders);
  s.reminders = {
    morning: Object.assign(structuredClone(DEFAULT_SETTINGS.reminders.morning), obj(rem.morning)),
    evening: Object.assign(structuredClone(DEFAULT_SETTINGS.reminders.evening), obj(rem.evening)),
  };
  return s;
}

let settings  = normalizeSettings(load(KEY.settings, {}));
let logs      = load(KEY.log, {});
let weights   = load(KEY.weights, {});
let overrides = load(KEY.overrides, {});
let body      = load(KEY.body, {});
let maxes     = load(KEY.maxes, {});
let goals     = load(KEY.goals, {});

/* ======================= engine ======================= */

/* All generation logic lives in engine.js, which knows nothing about the DOM
   or storage. This layer owns state and rendering only. */
const { dateKey, dayNumber, keyToDate, e1rm, exerciseById, repRange } = Engine;

function activeGoals() {
  const out = {};
  for (const [id, g] of Object.entries(goals)) {
    if (g && !g.achieved) out[id] = g;
  }
  return out;
}

function buildPlan(key) {
  return Engine.buildPlan(key, settings, overrides[key], activeGoals());
}

/* ======================= performance history ======================= */

/* Up to `limit` most recent sessions before `beforeKey` in which this
   movement was performed, newest first. Counts a session if EITHER a weight
   or any reps were logged, so bodyweight work gets a history too.
   Returns [{ key, weight, reps }]. Fetching a few sessions rather than one is
   what lets the engine spot a lift stalled at the same load for weeks. */
function performanceHistory(exId, beforeKey, limit) {
  const out = [];
  const keys = Object.keys(logs).filter(k => k < beforeKey).sort().reverse();
  for (const k of keys) {
    const r = logs[k];
    if (!r) continue;
    const weight = r.weights && r.weights[exId];
    const reps = (r.reps && r.reps[exId]) || [];
    const hasWeight = weight != null && weight !== '';
    if (!hasWeight && !reps.length) continue;
    out.push({ key: k, weight: hasWeight ? weight : null, reps });
    if (out.length >= limit) break;
  }
  return out;
}

/* What to aim for today, given last time.

   Loaded lifts get a real progression suggestion. Bodyweight movements get
   their history shown but no suggested load — when you top out the rep range
   on push-ups the next step is a harder variation, which is a judgement call,
   not arithmetic. */
function targetFor(item, beforeKey) {
  const range = repRange(item.reps);
  if (!range) return null;
  const history = performanceHistory(item.ex.id, beforeKey, Engine.STALL_SESSIONS + 2);
  const last = history[0];
  const step = Engine.loadStep(settings.units, item.ex);

  if (!last) {
    // never done this lift — seed a starting weight from a recorded max
    const seed = item.ex.load
      ? Engine.startingWeight(maxes[item.ex.id], range, settings.units, item.ex)
      : null;
    return seed != null
      ? { last: null, range, prog: { weight: seed, advance: false, reason: 'seed', reps: [] } }
      : null;
  }

  if (!item.ex.load || last.weight == null) {
    if (!last.reps.length) return null;
    const goal = Engine.repTarget(last, range, item.sets);
    return { last, range, prog: { weight: null, advance: false, reason: 'bodyweight', reps: last.reps, goal } };
  }
  const holds = Engine.countHolds(history, range, item.sets);
  let prog = Engine.progression(last, range, step, item.sets, holds);
  if (prog) prog = Engine.staleAdjust(prog, dayNumber(beforeKey) - dayNumber(last.key), step);
  return prog ? { last, range, prog } : null;
}

/* Consecutive recent sessions in which every prescribed set of this timed
   movement was completed. Days it simply was not programmed do not break
   the streak. */
function timedStreak(exId, beforeKey) {
  let n = 0;
  const keys = Object.keys(logs).filter(k => k < beforeKey).sort().reverse();
  for (const k of keys) {
    const t = logs[k] && logs[k].timed && logs[k].timed[exId];
    if (!t) continue;
    if (!(t.done >= t.of)) break;
    if (++n >= 6) break;
  }
  return n;
}

/* ======================= day record ======================= */

function today() { return dateKey(new Date()); }

function record(key) {
  if (!logs[key]) logs[key] = { sets: {}, warm: {}, weights: {}, reps: {}, complete: false };
  const r = logs[key];
  r.sets = r.sets || {}; r.warm = r.warm || {}; r.weights = r.weights || {}; r.reps = r.reps || {};
  return r;
}

/* Everything one exercise can write into a day's record.

   Swapping a movement out — or changing the day's focus — has to clear ALL of
   it. `sets` and `reps` are the visible part, but `weights` is banked on the
   FIRST tap of a set (see logSet), so a single tap then a swap is enough to
   strand a load. performanceHistory counts any day with a weight OR reps as a
   session, so a stranded weight becomes a phantom session with no reps —
   which breaks countHolds' streak and quietly cancels a deload that was about
   to trigger. It also charts a phantom point in lift trends and lists a
   movement in the day viewer that was never performed.

   The sticky working weight in `weights[exId]` is deliberately NOT cleared:
   that is "what you last loaded on this lift", which is still true. */
function clearExerciseRecord(rec, exId) {
  if (!rec) return;
  if (rec.sets)    delete rec.sets[exId];
  if (rec.reps)    delete rec.reps[exId];
  if (rec.weights) delete rec.weights[exId];
  if (rec.timed)   delete rec.timed[exId];
}

function persist() {
  save(KEY.log, logs);
  save(KEY.weights, weights);
  save(KEY.overrides, overrides);
  save(KEY.body, body);
  save(KEY.maxes, maxes);
  save(KEY.goals, goals);
}

/* ======================= maxes ======================= */

const MAXABLE = Engine.maxableLifts();
const MAXABLE_IDS = new Set(MAXABLE.map(e => e.id));
const exById = exerciseById;

/* ======================= rendering ======================= */

let plan = null;

/* Which exercise is open on the Today screen. Normally the first unfinished
   one, but tapping a collapsed row jumps to it — that override lives here.
   Deliberately not persisted: on a fresh open you want to be back at the next
   thing to do, not wherever you were poking around yesterday. */
let focusedExId = null;
const $ = id => document.getElementById(id);

/* Tapping a set is the main interaction in the app, so it carries a lot:
     - an unlogged set logs as done, defaulting to the top of the rep range
       (so "I hit my target" costs exactly one tap)
     - tapping an already-logged set counts it DOWN one rep, for the days you
       came up short
     - dropping below the bottom of the range un-logs that set and everything
       after it
   Timed work has no rep range and just toggles done/undone. */
function logSet(item, s, doneSets, range, rec, key) {
  rec.reps = rec.reps || {};
  const reps = (rec.reps[item.ex.id] || []).slice();
  const wasDone = s <= doneSets;
  const t = range ? targetFor(item, key) : null;

  if (!range) {
    rec.sets[item.ex.id] = wasDone && doneSets === s ? s - 1 : s;
    // timed work keeps a completion record too, so it has a history that
    // survives plan changes — that is what duration progression reads
    rec.timed = rec.timed || {};
    const done = rec.sets[item.ex.id] || 0;
    if (done > 0) rec.timed[item.ex.id] = { done, of: item.sets };
    else delete rec.timed[item.ex.id];
  } else if (!wasDone) {
    // default new sets to the top of the range, or to what was logged last
    // time. A deload day defaults to the top like an advance does — at the
    // lighter load the target is the full window, not the stalled rep count
    // (which taps can only count down from, never up).
    const fallback = (t && (t.prog.advance || t.prog.reason === 'deload')) ? range.hi
                   : (t && t.prog.reps.length ? Math.max(...t.prog.reps) : range.hi);
    for (let i = doneSets; i < s; i++) {
      if (reps[i] == null) reps[i] = Math.min(range.hi, Math.max(range.lo, fallback));
    }
    rec.sets[item.ex.id] = s;
  } else {
    const next = (reps[s - 1] || range.hi) - 1;
    if (next < range.lo) {
      rec.sets[item.ex.id] = s - 1;
      reps.length = Math.max(0, s - 1);
    } else {
      reps[s - 1] = next;
    }
  }

  if (range) {
    reps.length = Math.min(reps.length, rec.sets[item.ex.id] || 0);
    if (reps.length) rec.reps[item.ex.id] = reps;
    else delete rec.reps[item.ex.id];
  }

  /* Following the suggested load without typing it must still count as
     lifting it — otherwise the session stores no weight, stall tracking
     resets, and a deload never takes effect. First completed set banks the
     suggestion (or the sticky working weight) as this session's load. */
  if (!wasDone && item.ex.load && rec.weights[item.ex.id] == null) {
    const suggested = (t && t.prog.weight != null) ? t.prog.weight : weights[item.ex.id];
    if (suggested != null && suggested !== '') {
      rec.weights[item.ex.id] = String(suggested);
      weights[item.ex.id] = String(suggested);
    }
  }

  const nowDone = rec.sets[item.ex.id] || 0;

  /* Finishing the exercise you are on hands the card to the next one. Doing
     it here rather than in the render is what keeps a finished row reopenable
     — the render must not undo a focus you just asked for. */
  if (focusedExId === item.ex.id && nowDone >= item.sets) focusedExId = null;

  persist();
  checkGoals();
  renderToday();

  // only start a rest timer when a set was newly completed, not on a rep edit
  if (!wasDone && nowDone === s && s < item.sets) {
    startRest(item.rest, 'Set ' + (s + 1) + ' of ' + item.sets + ' · ' + item.ex.name);
  }
}

function renderToday() {
  const key = today();
  plan = buildPlan(key);
  const rec = record(key);
  const d = keyToDate(key);

  /* The header belongs to whichever view is on screen, and this function is
     called from Settings too — changing equipment, age, experience or session
     length all rebuild the plan. Without this guard, flipping an equipment
     switch replaced the word "Settings" with "Engine + Core" under your thumb
     and brought the streak pill back with it. */
  const onToday = $('view-today').classList.contains('active');

  const name = (settings.profile.name || '').trim();
  /* A greeting in front of a long weekday overruns the space left by the
     streak pill and wraps onto a second line — "Afternoon, Peter · Tuesday,
     Aug 4" does not fit 390px. Shorten the weekday only when there is a
     greeting to make room for. */
  const dateStr = d.toLocaleDateString(undefined,
    { weekday: name ? 'short' : 'long', month: 'short', day: 'numeric' });
  if (onToday) {
    if (name) {
      const h = new Date().getHours();
      const hello = h < 5 ? 'Up late' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
      $('hdr-date').textContent = hello + ', ' + name + ' · ' + dateStr;
    } else {
      $('hdr-date').textContent = dateStr;
    }
    $('hdr-focus').textContent = plan.focus.label;
  }

  /* The focus blurb ("Conditioning and midsection") only restated the label
     above it. What is actually worth the line is the shape of the session you
     are about to start — how much work, and how long it will take. */
  const mainSets = plan.main.reduce((a, m) => a + m.sets, 0);
  const exCount  = plan.main.length;
  if (onToday) {
    $('hdr-blurb').textContent =
      mainSets + ' set' + (mainSets === 1 ? '' : 's') +
      ' · ~' + plan.minutes + ' min';
  }
  /* the time estimate now lives in the header, so this stops repeating it */
  $('main-note').textContent = exCount + ' exercise' + (exCount === 1 ? '' : 's');

  /* warm-up */
  const wl = $('warmup-list');
  wl.innerHTML = '';
  plan.warm.forEach((w, i) => {
    const li = document.createElement('li');
    li.className = rec.warm[i] ? 'done' : '';
    li.innerHTML =
      '<span class="tick">&#10003;</span>' +
      '<span class="wu-name">' + esc(w.ex.name) + '</span>' +
      '<span class="wu-dose">' + esc(w.dose) + '</span>';
    li.onclick = () => { rec.warm[i] = !rec.warm[i]; persist(); renderToday(); };
    wl.appendChild(li);
  });

  /* main work */
  const zones = Engine.hrZones(settings.profile.age);
  const hrHint = zones
    ? ' <span class="hr-hint">hard ≈ ' + zones.hard[0] + '–' + zones.hard[1] +
      ' bpm · easy ≈ ' + zones.easy[0] + '–' + zones.easy[1] + '</span>'
    : '';
  const ml = $('main-list');
  ml.innerHTML = '';

  const setsDone = m => rec.sets[m.ex.id] || 0;
  const doseOf = m => (m.ex.type === 'cardio' || m.ex.type === 'mobility')
    ? (m.sets > 1 ? m.sets + ' × ' + m.reps : m.reps)
    : m.sets + ' × ' + m.reps;

  /* Only drop the override if the exercise left today's plan — a swap, or a
     focus carried over from a previous day. Advancing off a *finished*
     exercise happens in logSet, so that tapping a completed row here can
     still reopen it to correct a miscount. */
  if (focusedExId && !plan.main.some(m => m.ex.id === focusedExId)) focusedExId = null;
  const nextUp = plan.main.find(m => setsDone(m) < m.sets);
  const activeId = focusedExId || (nextUp ? nextUp.ex.id : null);

  /* Everything that is not in play collapses to a single row. Consecutive
     rows share one container so they read as a list rather than as a run of
     little cards — the same shape the warm-up already uses. */
  let stack = null;
  function pushLine(node) {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'stack';
      ml.appendChild(stack);
    }
    stack.appendChild(node);
  }
  function makeLine(item) {
    const done = setsDone(item);
    const finished = done >= item.sets;
    const row = document.createElement('div');
    row.className = 'ex-line' + (finished ? ' is-done' : done > 0 ? ' is-part' : '');
    row.innerHTML =
      '<span class="l-tick">&#10003;</span>' +
      '<span class="l-name">' + esc(item.ex.name) + '</span>' +
      '<span class="l-dose">' +
        (done > 0 && !finished ? done + ' of ' + item.sets : esc(doseOf(item))) +
      '</span>';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', 'Open ' + item.ex.name);
    row.onclick = () => { focusedExId = item.ex.id; renderToday(); };
    return row;
  }

  plan.main.forEach(item => {
    const doneSets = setsDone(item);

    if (item.ex.id !== activeId) {
      pushLine(makeLine(item));
      return;
    }
    stack = null;   // the active card breaks the run of rows

    const card = document.createElement('div');
    card.className = 'ex is-active' + (doneSets >= item.sets ? ' complete' : '');
    const nowLabel = document.createElement('span');
    nowLabel.className = 'now-label';
    nowLabel.textContent = 'Now';
    card.appendChild(nowLabel);

    const dose = doseOf(item);

    const top = document.createElement('div');
    top.className = 'ex-top';
    top.innerHTML =
      '<div style="flex:1;min-width:0">' +
        '<div class="ex-name">' + esc(item.ex.name) +
          (item.goal && goals[item.ex.id]
            ? ' <span class="goal-tag">&#8594; ' + esc(goals[item.ex.id].target) + ' ' +
              esc(goalUnitLabel(goals[item.ex.id])) + '</span>'
            : '') +
        '</div>' +
        '<div class="ex-cue">' + esc(item.ex.cue) +
          (item.ex.type === 'cardio' || item.ex.type === 'interval' ? hrHint : '') +
        '</div>' +
      '</div>' +
      '<div class="ex-dose">' + esc(dose) + '</div>';
    const swap = document.createElement('button');
    swap.className = 'mini-btn';
    swap.innerHTML = '&#8635;';
    swap.setAttribute('aria-label', 'Swap ' + item.ex.name);
    swap.onclick = () => {
      const ov = overrides[key] || (overrides[key] = {});
      ov.rerolls = ov.rerolls || {};
      // rerolls stay index-keyed on purpose: they mean "reroll this SLOT"
      ov.rerolls[item.index] = (ov.rerolls[item.index] || 0) + 1;
      clearExerciseRecord(rec, item.ex.id);
      persist();
      renderToday();
    };
    top.appendChild(swap);
    card.appendChild(top);

    /* What happened last time, and what today should aim for. */
    const target = targetFor(item, key);
    if (target) {
      const { last, prog } = target;
      const line = document.createElement('div');
      line.className = 'ex-last' + (prog.advance ? ' advance' : '');

      let label, cta = '';
      if (!last) {
        // no history — seeded from a recorded max
        label = 'from your ' + esc(item.ex.name) + ' max';
        cta = '<span class="last-cta">start around ' + prog.weight + ' ' + settings.units + '</span>';
      } else {
        const when = keyToDate(last.key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const load = last.weight != null ? esc(last.weight) + ' ' + settings.units + ' × ' : '';
        label = esc(when) + ': ' + load + esc(prog.reps.join('·'));
        if (prog.advance) {
          cta = '<span class="last-cta">try ' + prog.weight + ' ' + settings.units + '</span>';
        } else if (prog.reason === 'deload') {
          cta = '<span class="last-cta deload">stalled — drop to ' + prog.weight + ' ' + settings.units + '</span>';
        } else if (prog.reason === 'stale') {
          cta = '<span class="last-cta deload">been a while — start at ' + prog.weight + ' ' + settings.units + '</span>';
        } else if (prog.goal && prog.goal.reason === 'add-rep') {
          cta = '<span class="last-cta">aim for ' + prog.goal.target + '</span>';
        } else if (prog.goal && prog.goal.reason === 'top-out') {
          const h = item.ex.harder && exById(item.ex.harder);
          const usable = h && h.equip.every(c => settings.equip[c]);
          cta = usable
            ? '<span class="last-cta">ready for ' + esc(h.name) + '</span>'
            : '<span class="last-cta">topped out — slow the reps down</span>';
        }
      }
      line.innerHTML = '<span class="last-label">' + label + '</span>' + cta;
      card.appendChild(line);
    } else if (item.ex.type === 'core' || item.ex.type === 'interval') {
      /* timed work: after consecutive complete sessions, suggest longer sets */
      const streak = timedStreak(item.ex.id, key);
      const tt = Engine.timedTarget(item.reps, streak);
      if (tt) {
        const line = document.createElement('div');
        line.className = 'ex-last advance';
        line.innerHTML =
          '<span class="last-label">' + streak + ' full session' + (streak === 1 ? '' : 's') + ' in a row</span>' +
          '<span class="last-cta">try ' + tt.seconds + ' sec ' +
            (item.ex.type === 'core' ? 'holds' : 'efforts') + '</span>';
        card.appendChild(line);
      }
    }

    /* ramp-up sets before the day's first heavy compound, once a working
       weight is known to ramp toward */
    if (item.ramp) {
      const workW = parseFloat(rec.weights[item.ex.id] || (target && target.prog.weight) || weights[item.ex.id]);
      const ramp = Engine.rampSets(workW, settings.units, item.ex);
      if (ramp.length) {
        const rl = document.createElement('div');
        rl.className = 'ex-ramp';
        rl.innerHTML = '<span class="ramp-label">Ramp up</span>' +
          ramp.map(r => esc(r.weight) + ' × ' + r.reps).join(' · ') +
          ', then work sets';
        card.appendChild(rl);
      }
    }

    const bottom = document.createElement('div');
    bottom.className = 'ex-bottom';

    const range = repRange(item.reps);
    const loggedReps = (rec.reps && rec.reps[item.ex.id]) || [];

    const setWrap = document.createElement('div');
    setWrap.className = 'sets';
    for (let s = 1; s <= item.sets; s++) {
      const b = document.createElement('button');
      const isDone = s <= doneSets;
      /* exactly one set is "next" — the first unlogged one */
      b.className = 'set' + (isDone ? ' done' : s === doneSets + 1 ? ' next' : '');

      if (range && isDone && loggedReps[s - 1]) {
        b.textContent = loggedReps[s - 1];
        b.classList.add('has-reps');
        if (loggedReps[s - 1] >= range.hi) b.classList.add('at-top');
        b.setAttribute('aria-label',
          `Set ${s} of ${item.sets}: ${loggedReps[s - 1]} reps. Tap to log fewer.`);
      } else {
        b.textContent = s;
        b.setAttribute('aria-label', `Log set ${s} of ${item.sets} for ${item.ex.name}`);
      }

      b.onclick = () => logSet(item, s, doneSets, range, rec, key);
      setWrap.appendChild(b);
    }
    bottom.appendChild(setWrap);

    if (item.ex.load) {
      const w = document.createElement('div');
      w.className = 'weight';
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      // placeholder shows what to load: the progression target if there is
      // one (a weightless last session has none — fall back to the sticky
      // working weight rather than rendering "null")
      input.placeholder = (target && target.prog.weight != null)
        ? String(target.prog.weight)
        : (weights[item.ex.id] || '—');
      input.value = rec.weights[item.ex.id] || '';
      input.setAttribute('aria-label', 'Weight for ' + item.ex.name);
      input.onchange = () => {
        const v = input.value.trim();
        if (v) { rec.weights[item.ex.id] = v; weights[item.ex.id] = v; }
        else { delete rec.weights[item.ex.id]; }
        persist();
        checkGoals();
        renderToday(); // may surface or clear the PR chip
      };
      w.appendChild(input);
      const u = document.createElement('span');
      u.textContent = settings.units;
      w.appendChild(u);
      bottom.appendChild(w);

      /* If today's load beats the lift's recorded max, offer to bank it. */
      if (MAXABLE_IDS.has(item.ex.id)) {
        const todayW = parseFloat(rec.weights[item.ex.id]);
        const best = maxes[item.ex.id] ? parseFloat(maxes[item.ex.id].weight) : 0;
        if (todayW > best) {
          const chip = document.createElement('button');
          chip.className = 'pr-chip';
          chip.textContent = 'PR?';
          chip.title = 'Record this as a new max';
          chip.onclick = () => openMaxSheet(item.ex.id, todayW, parseInt(item.reps, 10) || 1);
          bottom.appendChild(chip);
        }
      }
    }

    card.appendChild(bottom);
    ml.appendChild(card);
  });

  /* finisher */
  if (plan.finisher) {
    $('finisher-block').hidden = false;
    /* Once the main work is logged, the finisher is the thing you are on, so
       it takes the same lifted card and "Now" label the current exercise had. */
    const mainDone = plan.main.every(m => (rec.sets[m.ex.id] || 0) >= m.sets);
    const fin = $('finisher');
    fin.className = 'finisher' + (mainDone ? ' is-active' : '');
    fin.innerHTML =
      (mainDone ? '<span class="now-label">Now</span>' : '') +
      '<div class="finisher-name">' + esc(plan.finisher.name) + '</div>' +
      '<div class="finisher-detail">' + esc(plan.finisher.detail) +
        (plan.finisher.stress === 'cardio' ? hrHint : '') + '</div>';
  } else {
    $('finisher-block').hidden = true;
  }

  /* progress + finish button */
  const totalSets = plan.main.reduce((a, m) => a + m.sets, 0) + plan.warm.length;
  const doneAll = plan.main.reduce((a, m) => a + Math.min(rec.sets[m.ex.id] || 0, m.sets), 0) +
                  plan.warm.filter((_, i) => rec.warm[i]).length;
  $('progress-fill').style.width = (totalSets ? (doneAll / totalSets) * 100 : 0) + '%';

  const btn = $('finish-btn');
  btn.textContent = rec.complete ? '✓ Logged for today' : 'Mark workout complete';
  btn.classList.toggle('done', !!rec.complete);

  /* A zero streak is the one number nobody wants staring back at them, and it
     was holding prime space in the header to say nothing. It reappears the
     moment there is a streak to show — but only on Today, since setHeader
     hides it outright on the other two views. */
  const s = streak();
  if (onToday) {
    $('hdr-streak').hidden = s === 0;
    $('hdr-streak').querySelector('.streak-num').textContent = s;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ======================= streak & history ======================= */

function streak() {
  let n = 0;
  const d = new Date();
  // today not being done yet should not break yesterday's streak
  if (!(logs[dateKey(d)] && logs[dateKey(d)].complete)) d.setDate(d.getDate() - 1);
  while (logs[dateKey(d)] && logs[dateKey(d)].complete) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/* ======================= body weight ======================= */

function bodyEntries() {
  return Object.entries(body)
    .filter(([, v]) => typeof v === 'number' && isFinite(v))
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function renderBodyweight() {
  const entries = bodyEntries();
  const unit = settings.units;
  $('bw-unit').textContent = unit;

  const input = $('bw-input');
  if (document.activeElement !== input) {
    input.value = body[today()] != null ? body[today()] : '';
  }

  if (!entries.length) {
    $('bw-now').textContent = '—';
    $('bw-meta').textContent = 'No entries yet';
    $('bw-delta').textContent = '';
    drawSpark([]);
    return;
  }

  const [lastKey, lastVal] = entries[entries.length - 1];
  $('bw-now').textContent = lastVal;
  $('bw-meta').textContent = lastKey === today()
    ? 'logged today'
    : 'as of ' + keyToDate(lastKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  /* change vs the entry nearest to 30 days before the latest one */
  const target = dayNumber(lastKey) - 30;
  let ref = null, refGap = Infinity;
  for (const [k, v] of entries) {
    if (k === lastKey) continue;
    const gap = Math.abs(dayNumber(k) - target);
    if (gap < refGap) { refGap = gap; ref = [k, v]; }
  }
  if (ref && refGap <= 21) {
    const diff = lastVal - ref[1];
    const span = dayNumber(lastKey) - dayNumber(ref[0]);
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    $('bw-delta').textContent =
      sign + Math.abs(diff).toFixed(1) + ' ' + unit + ' in ' + span + ' days';
  } else {
    $('bw-delta').textContent = entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies');
  }

  drawSpark(entries);
}

/* 90-day sparkline, drawn as inline SVG so there is no charting library. */
function drawSpark(entries) {
  const svg = $('bw-spark');
  const cutoff = dayNumber(today()) - 90;
  const pts = entries.filter(([k]) => dayNumber(k) >= cutoff);

  if (pts.length < 2) {
    svg.innerHTML = '';
    svg.style.display = 'none';
    let note = svg.nextElementSibling;
    if (!note || !note.classList.contains('spark-empty')) {
      note = document.createElement('div');
      note.className = 'spark-empty';
      svg.after(note);
    }
    note.textContent = pts.length
      ? 'Log a second weigh-in to see the trend.'
      : 'Log your weight below to start tracking.';
    note.hidden = false;
    return;
  }
  svg.style.display = 'block';
  const note = svg.nextElementSibling;
  if (note && note.classList.contains('spark-empty')) note.hidden = true;

  const W = 300, H = 62, PAD = 6;
  const xs = pts.map(([k]) => dayNumber(k));
  const ys = pts.map(([, v]) => v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const spanX = (x1 - x0) || 1;
  const spanY = (y1 - y0) || 1;   // a flat line sits mid-height
  const px = x => ((x - x0) / spanX) * W;
  const py = y => H - PAD - ((y - y0) / spanY) * (H - PAD * 2);

  const coords = pts.map(([k, v]) => [px(dayNumber(k)), py(v)]);
  const line = coords.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';
  const last = coords[coords.length - 1];

  svg.innerHTML =
    '<path class="sp-area" d="' + area + '"/>' +
    '<path class="sp-line" d="' + line + '"/>' +
    '<circle class="sp-dot" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.5"/>';
}

function logBodyweight() {
  const input = $('bw-input');
  const raw = input.value.trim();
  const k = today();
  if (!raw) { delete body[k]; }
  else {
    const v = parseFloat(raw);
    if (!isFinite(v) || v <= 0) return;
    body[k] = Math.round(v * 10) / 10;
  }
  persist();
  input.blur();
  renderBodyweight();
}

/* ======================= maxes ======================= */


let maxSheetId = null;

function openMaxSheet(exId, presetWeight, presetReps) {
  const ex = exById(exId);
  if (!ex) return;
  maxSheetId = exId;
  $('max-sheet-title').textContent = ex.name;
  const existing = maxes[exId];
  $('max-weight').value = presetWeight != null ? presetWeight : (existing ? existing.weight : '');
  $('max-reps').value   = presetReps   != null ? presetReps   : (existing ? existing.reps : 1);
  $('max-clear').hidden = !existing;
  updateMaxEstimate();
  $('lift-sheet').hidden = true;
  $('max-sheet').hidden = false;
}

function updateMaxEstimate() {
  const w = $('max-weight').value, r = $('max-reps').value;
  const est = e1rm(w, r);
  $('max-e1rm').textContent = (est && parseInt(r, 10) > 1)
    ? 'Estimated 1RM: ' + est + ' ' + settings.units
    : (parseInt(r, 10) > 12 ? 'Above 12 reps the 1RM estimate is not reliable.' : '');
}

function openLiftPicker() {
  const box = $('lift-options');
  box.innerHTML = '';
  MAXABLE.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(ex => {
    const b = document.createElement('button');
    b.className = 'focus-opt' + (maxes[ex.id] ? ' on' : '');
    b.innerHTML = '<span>' + esc(ex.name) +
      (maxes[ex.id] ? '<small>' + esc(maxes[ex.id].weight) + ' ' + settings.units +
        ' × ' + esc(maxes[ex.id].reps) + '</small>' : '') + '</span>';
    b.onclick = () => openMaxSheet(ex.id);
    box.appendChild(b);
  });
  $('lift-sheet').hidden = false;
}

/* ======================= goals ======================= */

const MAX_ACTIVE_GOALS = 3;

/* Where a goal stands right now. Load goals measure best estimated 1RM
   across every logged session and the recorded max; rep goals measure the
   best single logged set. */
function goalCurrent(exId, g) {
  if (g.type === 'reps') {
    let best = 0;
    for (const r of Object.values(logs)) {
      for (const n of ((r && r.reps && r.reps[exId]) || [])) {
        if (Number.isFinite(n) && n > best) best = n;
      }
    }
    return best;
  }
  let best = 0;
  const m = maxes[exId];
  if (m) best = e1rm(m.weight, m.reps) || parseFloat(m.weight) || 0;
  for (const r of Object.values(logs)) {
    const w = r && r.weights ? parseFloat(r.weights[exId]) : NaN;
    if (!isFinite(w) || w <= 0) continue;
    const reps = ((r.reps && r.reps[exId]) || []).filter(n => Number.isFinite(n) && n > 0);
    const est = reps.length ? (e1rm(w, Math.max(...reps)) || w) : w;
    if (est > best) best = est;
  }
  return Math.round(best);
}

/* Called after anything that could move a goal: a logged set, a weight
   entry, a banked max. Marks freshly crossed targets and celebrates. */
function checkGoals() {
  let crossed = false;
  for (const [id, g] of Object.entries(goals)) {
    if (!g || g.achieved) continue;
    if (goalCurrent(id, g) >= g.target) {
      g.achieved = today();
      crossed = true;
    }
  }
  if (crossed) {
    persist();
    if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 120]);
  }
  return crossed;
}

function goalUnitLabel(g) {
  return g.type === 'reps' ? 'reps' : settings.units;
}


let goalSheetId = null;

function openGoalSheet(exId) {
  const ex = exById(exId);
  if (!ex) return;
  goalSheetId = exId;
  const type = ex.load ? 'load' : 'reps';
  const existing = goals[exId];
  const cur = goalCurrent(exId, existing || { type });
  $('goal-sheet-title').textContent = ex.name;
  $('goal-current').textContent = type === 'reps'
    ? (cur ? 'Best single set so far: ' + cur + ' reps.' : 'No sets logged yet.')
    : (cur ? 'Best estimated 1RM so far: ' + cur + ' ' + settings.units + '.' : 'Nothing logged yet for this lift.');
  $('goal-target-label').firstChild.textContent = type === 'reps' ? 'Target reps (one set)' : 'Target 1RM (' + settings.units + ')';
  $('goal-target').value = existing ? existing.target : '';
  $('goal-delete').hidden = !existing;
  $('goal-pick-sheet').hidden = true;
  $('goal-sheet').hidden = false;
}

function openGoalPicker() {
  const activeCount = Object.values(goals).filter(g => g && !g.achieved).length;
  const box = $('goal-pick-options');
  box.innerHTML = '';
  if (activeCount >= MAX_ACTIVE_GOALS) {
    $('goal-pick-hint').textContent =
      MAX_ACTIVE_GOALS + ' active goals is the cap — a program that chases everything catches nothing. Finish or remove one first.';
  } else {
    $('goal-pick-hint').textContent =
      'Load goals aim for an estimated 1RM. Bodyweight goals aim for a best single set.';
    const loaded = Engine.maxableLifts();
    const bodywt = EXERCISES.filter(e =>
      !e.load && ['compound', 'accessory'].includes(e.type) && repRange(SCHEMES[e.type].standard.reps));
    const addGroup = (title, items, tag) => {
      const h = document.createElement('div');
      h.className = 'goal-group';
      h.textContent = title;
      box.appendChild(h);
      items.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(ex => {
        const b = document.createElement('button');
        b.className = 'focus-opt' + (goals[ex.id] ? ' on' : '');
        b.innerHTML = '<span>' + esc(ex.name) +
          (goals[ex.id] ? '<small>' + esc(goals[ex.id].target) + ' ' + esc(tag) + ' goal</small>' : '') + '</span>';
        b.onclick = () => openGoalSheet(ex.id);
        box.appendChild(b);
      });
    };
    addGroup('Add weight to', loaded, settings.units);
    addGroup('Add reps to', bodywt, 'rep');
  }
  $('goal-pick-sheet').hidden = false;
}

/* ======================= lift trends ======================= */

/* One point per session for a lift, valued at the Epley estimate of its top
   logged set — reps count, so 155×8 charts higher than 155×6 — falling back
   to the raw weight when reps were not logged. */
function liftSeries(exId) {
  const pts = [];
  for (const [k, r] of Object.entries(logs)) {
    const w = r && r.weights ? parseFloat(r.weights[exId]) : NaN;
    if (!isFinite(w) || w <= 0) continue;
    const reps = ((r.reps && r.reps[exId]) || []).filter(n => Number.isFinite(n) && n > 0);
    const top = reps.length ? Math.max(...reps) : 0;
    pts.push([k, (top && e1rm(w, top)) || w]);
  }
  return pts.sort((a, b) => a[0].localeCompare(b[0]));
}

function sparkSvg(pts, W, H) {
  const PAD = 3;
  const xs = pts.map(([k]) => dayNumber(k));
  const ys = pts.map(([, v]) => v);
  const x0 = Math.min(...xs), spanX = (Math.max(...xs) - x0) || 1;
  const y0 = Math.min(...ys), spanY = (Math.max(...ys) - y0) || 1;
  const px = x => PAD + ((x - x0) / spanX) * (W - PAD * 2);
  const py = y => H - PAD - ((y - y0) / spanY) * (H - PAD * 2);
  const line = pts.map(([k, v], i) =>
    (i ? 'L' : 'M') + px(dayNumber(k)).toFixed(1) + ' ' + py(v).toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return '<svg class="spark lift-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<path class="sp-line" d="' + line + '"/>' +
    '<circle class="sp-dot" cx="' + px(dayNumber(last[0])).toFixed(1) + '" cy="' + py(last[1]).toFixed(1) + '" r="2.5"/>' +
    '</svg>';
}

/* One row per lift.

   This replaces four lists that each named the same lifts from a different
   angle — maxes, goals, trends, and last working weights — and so said a
   lift's name four times down one page while never showing you the whole
   picture of any of them in one place. Nothing new is stored: the row is a
   join over data that already existed. */
function renderLifts() {
  const list = $('lift-list');
  list.innerHTML = '';

  const cutoff = dayNumber(today()) - 90;
  const ids = new Set([...Object.keys(weights), ...Object.keys(maxes), ...Object.keys(goals)]);

  const rows = [...ids]
    .map(id => {
      const ex = exById(id);
      return ex ? { id, ex, m: maxes[id], g: goals[id], w: weights[id],
                    pts: liftSeries(id).filter(([k]) => dayNumber(k) >= cutoff) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.ex.name.localeCompare(b.ex.name));

  if (!rows.length) {
    list.innerHTML = '<li class="empty">Log a lift with a weight, or add a max, and it shows up here.</li>';
    return;
  }

  for (const r of rows) {
    /* the sub-line carries whatever is known, in a fixed order, so rows stay
       scannable even when a lift has only some of it */
    const bits = [];
    if (r.w) bits.push(esc(r.w) + ' ' + settings.units + ' working');
    if (r.m) {
      const est = e1rm(r.m.weight, r.m.reps);
      bits.push(est && r.m.reps > 1 ? 'est. 1RM ' + est
                                    : 'best ' + esc(r.m.weight) + ' ' + settings.units);
    }

    let goalHtml = '';
    if (r.g) {
      goalHtml = r.g.achieved
        ? '<span class="lift-goal hit">&#10003; ' + esc(r.g.target) + '</span>'
        : '<span class="lift-goal">&#8594; ' + esc(r.g.target) + '</span>';
    }

    const li = document.createElement('li');
    li.className = 'lift tappable';
    li.innerHTML =
      '<span class="lift-main">' +
        '<span class="lift-name">' + esc(r.ex.name) + '</span>' +
        (bits.length ? '<span class="lift-sub">' + bits.join(' · ') + '</span>' : '') +
      '</span>' +
      (r.pts.length >= 2 ? sparkSvg(r.pts, 62, 24) : '<span class="lift-spark-gap"></span>') +
      '<span class="lift-val">' +
        '<span class="lift-now">' + (r.m ? esc(r.m.weight) : (r.w ? esc(r.w) : '—')) + '</span>' +
        goalHtml +
      '</span>';

    /* the row edits the max; the goal chip edits the goal */
    li.onclick = () => openMaxSheet(r.id);
    const chip = li.querySelector('.lift-goal');
    if (chip) chip.onclick = e => { e.stopPropagation(); openGoalSheet(r.id); };

    list.appendChild(li);
  }
}

function renderHistory() {
  renderBodyweight();
  renderLifts();
  const done = Object.entries(logs).filter(([, v]) => v.complete);
  $('stat-streak').textContent = streak();
  $('stat-total').textContent = done.length;
  const mk = today().slice(0, 7);
  $('stat-month').textContent = done.filter(([k]) => k.startsWith(mk)).length;

  /* how long this has been going, for the Consistency chapter */
  const first = done.map(([k]) => k).sort()[0];
  $('consistency-note').textContent = first
    ? Math.max(1, Math.round((dayNumber(today()) - dayNumber(first)) / 7)) + ' weeks in'
    : 'just starting';

  /* 6-week calendar, weeks starting Sunday */
  const cal = $('cal');
  cal.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'cal-row';
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(x => {
    const c = document.createElement('div');
    c.className = 'cal-head';
    c.textContent = x;
    head.appendChild(c);
  });
  cal.appendChild(head);

  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + (6 - end.getDay())); // Saturday of this week
  const start = new Date(end);
  start.setDate(start.getDate() - 41); // 6 weeks

  for (let w = 0; w < 6; w++) {
    const row = document.createElement('div');
    row.className = 'cal-row';
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + w * 7 + i);
      const k = dateKey(d);
      const c = document.createElement('div');
      c.className = 'cal-cell';
      if (logs[k] && logs[k].complete) c.classList.add('done');
      if (k === today()) c.classList.add('today');
      if (d > now && k !== today()) c.classList.add('future');
      c.textContent = d.getDate();
      c.title = k;
      // any day with a record opens the read-only day view
      if ((logs[k] || body[k] != null) && !(d > now && k !== today())) {
        c.classList.add('has-log');
        c.onclick = () => openDaySheet(k);
      }
      row.appendChild(c);
    }
    cal.appendChild(row);
  }

  /* "Recent sessions" and "Last working weights" used to render here. The
     calendar above already shows which days were trained and its cells open
     the day; the working weight now sits on each lift's row. */
}

/* ======================= past day viewer ======================= */

/* Read-only view of what a day's log actually recorded. Rendered from the
   exercise-id-keyed reps/weights maps, NOT by rebuilding the plan — settings
   may have changed since, but the record is the record. */
function openDaySheet(key) {
  const r = logs[key];
  $('day-sheet-title').textContent = keyToDate(key)
    .toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const bits = [];
  const focus = r && r.focus && FOCI[r.focus] ? FOCI[r.focus].label : null;
  if (focus) bits.push(focus + (r.complete ? ' · completed' : ' · not marked complete'));
  if (body[key] != null) bits.push('body weight ' + body[key] + ' ' + settings.units);
  $('day-sheet-sub').textContent = bits.join(' — ') || 'Nothing logged this day.';

  const list = $('day-sheet-list');
  list.innerHTML = '';
  const ids = [...new Set([
    ...Object.keys((r && r.reps) || {}),
    ...Object.keys((r && r.weights) || {}),
  ])].map(id => exById(id)).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const ex of ids) {
    const w = r.weights && r.weights[ex.id];
    const reps = ((r.reps && r.reps[ex.id]) || []).filter(n => Number.isFinite(n) && n > 0);
    const load = w != null && w !== '' ? esc(w) + ' ' + settings.units + (reps.length ? ' × ' : '') : '';
    const li = document.createElement('li');
    li.innerHTML = '<span>' + esc(ex.name) + '</span>' +
      '<span class="l-val">' + load + esc(reps.join('·')) + '</span>';
    list.appendChild(li);
  }
  if (!ids.length) {
    list.innerHTML = '<li class="empty">' +
      (r ? 'No individual sets were logged.' : 'No workout logged.') + '</li>';
  }
  $('day-sheet').hidden = false;
}

/* ======================= import ======================= */

let pendingImport = null;

function validateBackup(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const sections = ['settings', 'logs', 'weights', 'overrides', 'body', 'maxes', 'goals'];
  // a section that is present at all must be a plain object — an array or a
  // scalar here means the file is not what it claims to be, even if some
  // other section happens to look right
  for (const k of sections) {
    if (d[k] == null) continue;
    if (typeof d[k] !== 'object' || Array.isArray(d[k])) return false;
  }
  const present = sections.filter(k => d[k] && typeof d[k] === 'object');
  if (!present.length) return false;
  // date-keyed sections must actually be keyed by dates
  for (const k of ['logs', 'overrides', 'body']) {
    if (d[k] && Object.keys(d[k]).some(key => !/^\d{4}-\d{2}-\d{2}$/.test(key))) return false;
  }
  return true;
}

function describeBackup(d) {
  const n = obj => Object.keys(obj || {}).length;
  const days = n(d.logs), weighins = n(d.body), maxCount = n(d.maxes);
  return `This backup holds ${days} logged day${days === 1 ? '' : 's'}, ` +
    `${weighins} weigh-in${weighins === 1 ? '' : 's'} and ${maxCount} max${maxCount === 1 ? '' : 'es'}. ` +
    `Replace wipes this device first. Merge keeps this device's entry wherever both logged the same day.`;
}

function openImportSheet(message, importable) {
  $('import-summary').textContent = message;
  $('import-replace').hidden = !importable;
  $('import-merge').hidden = !importable;
  $('import-sheet').hidden = false;
}

function applyImport(mode) {
  const d = pendingImport;
  if (!d) return;
  if (mode === 'replace') {
    settings  = normalizeSettings(d.settings);
    logs      = d.logs      || {};
    weights   = d.weights   || {};
    overrides = d.overrides || {};
    body      = d.body      || {};
    maxes     = d.maxes     || {};
    goals     = d.goals     || {};
  } else {
    // merge: this device wins date and lift conflicts; a max keeps whichever
    // record is heavier, because a max is a best, not a latest
    logs      = Object.assign({}, d.logs || {}, logs);
    overrides = Object.assign({}, d.overrides || {}, overrides);
    body      = Object.assign({}, d.body || {}, body);
    weights   = Object.assign({}, d.weights || {}, weights);
    goals     = Object.assign({}, d.goals || {}, goals);
    for (const [id, m] of Object.entries(d.maxes || {})) {
      const cur = maxes[id];
      if (!cur || (parseFloat(m && m.weight) || 0) > (parseFloat(cur.weight) || 0)) maxes[id] = m;
    }
  }
  save(KEY.settings, settings);
  persist();
  pendingImport = null;
  $('import-sheet').hidden = true;
  renderSettings();
  renderToday();
  renderHistory();
  if (navigator.vibrate) navigator.vibrate(30);
}

/* ======================= settings ======================= */

const EQUIP_LABELS = [
  ['bw',     'Bodyweight',      'Floor space, always on'],
  ['db',     'Dumbbells',       'A pair, or adjustables'],
  ['kb',     'Kettlebell',      'For swings and high pulls'],
  ['bar',    'Barbell + rack',  'Squat rack, pull-up bar'],
  ['bench',  'Bench',           'Flat or adjustable'],
  ['cable',  'Cable',           'Single adjustable pulley'],
  ['cardio', 'Cardio machine',  'Treadmill, bike, rower, outdoors'],
];

function renderSettings() {
  const activeEl = document.activeElement;
  if (activeEl !== $('prof-name')) $('prof-name').value = settings.profile.name || '';
  if (activeEl !== $('prof-age')) $('prof-age').value = settings.profile.age != null ? settings.profile.age : '';
  document.querySelectorAll('#seg-exp button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === (settings.profile.experience || 'regular')));
  document.querySelectorAll('#seg-length button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === settings.length));
  document.querySelectorAll('#seg-units button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === settings.units));

  buildEquipToggles($('equip-toggles'));
  renderReminderSettings();
}

/* The whole block only exists inside the app. On the website there is no way
   to schedule anything for tomorrow, so offering the switch would be a lie. */
function renderReminderSettings() {
  const native = !!(window.NativeShell && NativeShell.setReminders);
  $('reminders-block').hidden = !native;
  if (!native) return;

  [['morning', 'rem-morning'], ['evening', 'rem-evening']].forEach(([slot, id]) => {
    const cfg = settings.reminders[slot];
    const on = $(id + '-on');
    const time = $(id + '-time');
    on.checked = !!cfg.on;
    if (document.activeElement !== time) time.value = cfg.time;
    time.disabled = !cfg.on;

    /* save(KEY.settings) rather than persist() — persist() writes the logs and
       the lift records and pointedly not the settings, which live under their
       own key. Calling the wrong one here looked like it worked and then lost
       the choice on next launch. */
    on.onchange = () => {
      cfg.on = on.checked;
      time.disabled = !cfg.on;
      save(KEY.settings, settings);
      reconcileReminders();
    };
    time.onchange = () => {
      if (/^\d{2}:\d{2}$/.test(time.value)) {
        cfg.time = time.value;
        save(KEY.settings, settings);
        reconcileReminders();
      } else {
        time.value = cfg.time;   // an empty or half-typed field must not stick
      }
    };
  });
}

/* Hands the whole reminder schedule to the shell, which replaces whatever it
   had pending.

   iOS cannot decide anything at the moment a notification fires, so "only
   remind me if I have not trained" has to be resolved here, in advance: work
   out which of the next few days still need a nudge and schedule exactly
   those. Completing a workout drops that day's requests on the next reconcile.

   A week of lead time means the reminders keep working even if the app is not
   opened for days — which is precisely when a reminder earns its keep. */
const REMINDER_DAYS = 7;

function reconcileReminders() {
  if (!(window.NativeShell && NativeShell.setReminders)) return;

  const slots = [
    ['morning', settings.reminders.morning, 'Today’s workout'],
    ['evening', settings.reminders.evening, 'Still time today'],
  ];
  const now = new Date();
  const items = [];

  for (const [slot, cfg, title] of slots) {
    if (!cfg.on) continue;
    const [hh, mm] = String(cfg.time || '').split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;

    for (let i = 0; i < REMINDER_DAYS; i++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm, 0, 0);
      if (at <= now) continue;                        // that moment has gone
      const key = dateKey(at);
      if (logs[key] && logs[key].complete) continue;  // already trained that day

      /* buildPlan is pure and deterministic for a date, so the reminder can
         name the session you are actually going to get. */
      const p = Engine.buildPlan(key, settings, overrides[key], activeGoals());
      const sets = p.main.reduce((a, m) => a + m.sets, 0);

      items.push({
        id: slot + '-' + key,
        year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate(),
        hour: hh, minute: mm,
        title,
        body: p.focus.label + ' — ' + sets + ' sets, about ' + p.minutes + ' min',
      });
    }
  }

  NativeShell.setReminders(items);
}

/* Equipment toggles render into the Settings page and into the first-open
   setup sheet from the same code, so they can never drift apart. */
function buildEquipToggles(box) {
  box.innerHTML = '';
  EQUIP_LABELS.forEach(([code, name, sub]) => {
    const label = document.createElement('label');
    label.innerHTML =
      '<span><strong style="font-weight:600">' + esc(name) + '</strong><span class="t-sub">' + esc(sub) + '</span></span>' +
      '<input type="checkbox"' + (settings.equip[code] ? ' checked' : '') + '><span class="switch"></span>';
    label.querySelector('input').onchange = e => {
      settings.equip[code] = e.target.checked;
      // never let every option be off
      if (!Object.values(settings.equip).some(Boolean)) {
        settings.equip.bw = true;
        buildEquipToggles(box);
      }
      save(KEY.settings, settings);
      renderToday();
    };
    box.appendChild(label);
  });
}

/* ======================= rest timer ======================= */

/* The timer counts against a wall-clock deadline, not a decrementing tick —
   backgrounding the app or locking the screen cannot freeze it, and coming
   back mid-rest shows the honest remainder (or ends it if time is up). A
   screen wake lock keeps the phone awake while resting, where supported. */
let restTimer = null, restEndsAt = 0;
let wakeLock = null;

/* The native iOS shell (see ios/) exposes a few things the web platform will
   not give us. It is absent in a browser, so every call site guards — the web
   version simply goes without. */
const shell = typeof window !== 'undefined' ? (window.NativeShell || null) : null;

/* Hand the rest deadline to the system so it can announce the end even if the
   app is backgrounded, where JS intervals stop firing. iOS suppresses the
   notification while the app is in front, so it only ever appears if you
   actually left — no duplicate of the beep-and-flash you are watching. */
function syncRestNotice() {
  if (!shell) return;
  const left = restLeftNow();
  if (left > 0) shell.scheduleRestEnd(left, $('rest-next').textContent || '');
  else shell.cancelRestEnd();
}

function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen')
    .then(l => { wakeLock = l; })
    .catch(() => { wakeLock = null; });
}
function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) { /* already gone */ } }
  wakeLock = null;
}

function restLeftNow() {
  return Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000));
}
/* How long the "GO" flash holds after a rest ends, before the overlay closes.
   Matches the 4 × 0.42s pulse in the stylesheet, with a little slack. */
const REST_FLASH_MS = 1700;
let restFlashTimer = null;

function tickRest() {
  paintRest();
  if (restLeftNow() <= 0) endRest();
}

function startRest(seconds, nextLabel) {
  clearTimeout(restFlashTimer);
  restFlashTimer = null;
  const el = $('rest');
  el.classList.remove('over');
  $('rest-label').textContent = 'Rest';
  restEndsAt = Date.now() + seconds * 1000;
  $('rest-next').textContent = nextLabel || '';
  el.hidden = false;
  paintRest();
  clearInterval(restTimer);
  restTimer = setInterval(tickRest, 250);
  acquireWakeLock();
  syncRestNotice();
}

/* A rest that runs out announces itself twice: the tone, and a green flash.
   The flash is not decoration — it is the only cue that survives a phone on
   silent, where Web Audio is muted and Safari offers no vibration. */
function endRest() {
  clearInterval(restTimer);
  restTimer = null;
  // we are in front and about to announce it ourselves
  if (shell) shell.cancelRestEnd();
  beep();
  $('rest').classList.add('over');
  $('rest-label').textContent = 'Rest over';
  $('rest-time').textContent = 'GO';
  clearTimeout(restFlashTimer);
  restFlashTimer = setTimeout(stopRest, REST_FLASH_MS);
}

function paintRest() {
  const left = restLeftNow();
  $('rest-time').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
}
function stopRest() {
  clearInterval(restTimer);
  restTimer = null;
  clearTimeout(restFlashTimer);
  restFlashTimer = null;
  if (shell) shell.cancelRestEnd();
  const el = $('rest');
  el.hidden = true;
  el.classList.remove('over');
  releaseWakeLock();
}

/* One AudioContext, unlocked by a user gesture and kept alive.

   This has to work this way on iOS, which is the whole point of the timer: a
   context constructed outside a user gesture starts SUSPENDED and stays
   silent, and the timer fires from an interval, which is not a gesture. Safari
   also has no navigator.vibrate, so if the tone does not play there is no
   fallback signal at all — the rest just ends with nothing.

   Unlocking on every pointerdown rather than once is deliberate: iOS suspends
   the context again when the app is backgrounded, which is exactly what
   happens when you put the phone down between sets. */
let audioCtx = null;

function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  } catch (e) { audioCtx = null; }
}
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

function beep() {
  /* A rest timer only ever starts from a tap, so by the time this fires the
     context has been unlocked at least once. */
  unlockAudio();
  try {
    if (audioCtx && audioCtx.state === 'running') {
      const t0 = audioCtx.currentTime;
      [0, 0.18, 0.36].forEach(t => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880;
        o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.0001, t0 + t);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.13);
        o.start(t0 + t);
        o.stop(t0 + t + 0.14);
      });
    }
  } catch (e) { /* audio blocked */ }
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
}

/* ======================= focus sheet ======================= */

function openFocusSheet() {
  const key = today();
  const cur = buildPlan(key).focusId;
  const box = $('focus-options');
  box.innerHTML = '';
  // recovery appears twice in the weekly rotation; list each focus once
  [...new Set(FOCUS_ORDER)].forEach(id => {
    const b = document.createElement('button');
    b.className = 'focus-opt' + (id === cur ? ' on' : '');
    b.innerHTML = '<span>' + esc(FOCI[id].label) + '<small>' + esc(FOCI[id].blurb) + '</small></span>';
    b.onclick = () => {
      const ov = overrides[key] || (overrides[key] = {});
      ov.focus = id;
      ov.rerolls = {};
      const rec = record(key);
      // the whole day is being rebuilt — clear every trace, weights and timed
      // completions included, so nothing from the old focus haunts history
      rec.sets = {};
      rec.reps = {};
      rec.weights = {};
      rec.timed = {};
      persist();
      $('focus-sheet').hidden = true;
      renderToday();
    };
    box.appendChild(b);
  });
  $('focus-sheet').hidden = false;
}

/* ======================= wiring ======================= */

/* The header belongs to the view, not to the day. It used to keep announcing
   "Engine + Core · 10 sets · ~30 min" while you were looking at three months
   of history, which read as a bug. The streak hides on the other two views —
   Progress already gives it a tile of its own, and Settings has no use for it. */
function setHeader(view) {
  if (view === 'today') { renderToday(); return; }

  if (view === 'progress') {
    const done = Object.values(logs).filter(v => v.complete).length;
    $('hdr-date').textContent = 'Your training';
    $('hdr-focus').textContent = 'Progress';
    $('hdr-blurb').textContent = done + ' session' + (done === 1 ? '' : 's') + ' logged';
  } else {
    $('hdr-date').textContent = 'Daily Workout';
    $('hdr-focus').textContent = 'Settings';
    $('hdr-blurb').textContent = 'Everything stays on this device';
  }
  $('hdr-streak').hidden = true;
}

document.querySelectorAll('.tabbar button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabbar button').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    b.classList.add('active');
    $('view-' + b.dataset.view).classList.add('active');
    if (b.dataset.view === 'progress') renderHistory();
    if (b.dataset.view === 'settings') renderSettings();
    setHeader(b.dataset.view);
    window.scrollTo(0, 0);
  };
});

$('finish-btn').onclick = () => {
  const key = today();
  const rec = record(key);
  rec.complete = !rec.complete;
  rec.focus = plan.focusId;
  rec.ts = Date.now();
  persist();
  renderToday();
  /* finishing withdraws today's nudges; un-finishing puts them back if their
     time has not passed */
  reconcileReminders();
  if (rec.complete && navigator.vibrate) navigator.vibrate(30);
};

$('change-focus-btn').onclick = openFocusSheet;
$('focus-cancel').onclick = () => { $('focus-sheet').hidden = true; };
$('focus-sheet').onclick = e => { if (e.target.id === 'focus-sheet') $('focus-sheet').hidden = true; };

$('reroll-finisher').onclick = () => {
  const key = today();
  const ov = overrides[key] || (overrides[key] = {});
  ov.finisherRoll = (ov.finisherRoll || 0) + 1;
  persist();
  renderToday();
};

$('rest-skip').onclick = stopRest;
$('rest-add').onclick = () => {
  // +30s during the GO flash means "I need more" — restart the countdown
  // rather than adding time to a timer that already stopped ticking
  if (!restTimer) {
    clearTimeout(restFlashTimer);
    restFlashTimer = null;
    $('rest').classList.remove('over');
    $('rest-label').textContent = 'Rest';
    restEndsAt = Date.now();
    restTimer = setInterval(tickRest, 250);
    acquireWakeLock();
  }
  restEndsAt += 30000;
  paintRest();
  syncRestNotice();   // the deadline moved; the system needs the new one
};

/* body weight */
$('bw-log').onclick = logBodyweight;
$('bw-input').addEventListener('keydown', e => { if (e.key === 'Enter') logBodyweight(); });

/* maxes */
$('max-add').onclick = openLiftPicker;
$('lift-cancel').onclick = () => { $('lift-sheet').hidden = true; };
$('lift-sheet').onclick = e => { if (e.target.id === 'lift-sheet') $('lift-sheet').hidden = true; };
$('max-cancel').onclick = () => { $('max-sheet').hidden = true; };
$('max-sheet').onclick = e => { if (e.target.id === 'max-sheet') $('max-sheet').hidden = true; };
$('max-weight').oninput = updateMaxEstimate;
$('max-reps').oninput = updateMaxEstimate;

$('max-save').onclick = () => {
  const w = parseFloat($('max-weight').value);
  const r = parseInt($('max-reps').value, 10);
  if (!maxSheetId || !isFinite(w) || w <= 0 || !isFinite(r) || r < 1) return;
  maxes[maxSheetId] = { weight: Math.round(w * 10) / 10, reps: r, date: today() };
  persist();
  checkGoals();
  $('max-sheet').hidden = true;
  renderLifts();
  renderToday();   // clears the PR chip now that the max is banked
  if (navigator.vibrate) navigator.vibrate(30);
};

$('max-clear').onclick = () => {
  if (maxSheetId) delete maxes[maxSheetId];
  persist();
  $('max-sheet').hidden = true;
  renderLifts();
  renderToday();
};

document.querySelectorAll('#seg-length button').forEach(b => {
  b.onclick = () => {
    settings.length = b.dataset.val;
    save(KEY.settings, settings);
    renderSettings();
    renderToday();
  };
});

/* profile */
$('prof-name').onchange = () => {
  settings.profile.name = $('prof-name').value.trim().slice(0, 30);
  save(KEY.settings, settings);
  renderToday();
};
$('prof-age').onchange = () => {
  const v = parseInt($('prof-age').value, 10);
  settings.profile.age = (Number.isFinite(v) && v >= 10 && v <= 100) ? v : null;
  save(KEY.settings, settings);
  renderSettings();  // clears a rejected entry
  renderToday();     // warm-up length and HR hints may change
};
document.querySelectorAll('#seg-exp button').forEach(b => {
  b.onclick = () => {
    settings.profile.experience = b.dataset.val;
    save(KEY.settings, settings);
    renderSettings();
    renderToday();   // block length changes the primary picks
  };
});
/* ---- unit switching ---- */

const LB_PER_KG = 2.20462;
let pendingUnits = null;

function countLoggedWeights() {
  let n = Object.keys(weights).length + Object.keys(maxes).length + Object.keys(body).length;
  n += Object.values(goals).filter(g => g && g.type === 'load').length;
  for (const r of Object.values(logs)) n += Object.keys((r && r.weights) || {}).length;
  return n;
}

/* Lift loads round to the nearest 0.5, body weight to 0.1 — this is a
   record being restated, not a plate-math suggestion, so keep it close. */
function convertAllWeights(to) {
  const conv = (v, perUnit) => {
    const x = parseFloat(v);
    if (!isFinite(x)) return v;
    const y = to === 'kg' ? x / LB_PER_KG : x * LB_PER_KG;
    return Math.round(y * perUnit) / perUnit;
  };
  const lift = v => conv(v, 2);   // nearest 0.5
  const bw   = v => conv(v, 10);  // nearest 0.1
  for (const id of Object.keys(weights)) weights[id] = String(lift(weights[id]));
  for (const r of Object.values(logs)) {
    if (!r || !r.weights) continue;
    for (const id of Object.keys(r.weights)) r.weights[id] = String(lift(r.weights[id]));
  }
  for (const m of Object.values(maxes)) m.weight = lift(m.weight);
  for (const k of Object.keys(body)) body[k] = bw(body[k]);
  // load-goal targets are weights too — a 250 lb bench goal must not
  // silently become a 250 kg one. Rep goals carry no unit.
  for (const g of Object.values(goals)) {
    if (g && g.type === 'load') g.target = lift(g.target);
  }
}

function applyUnits(to, convert) {
  if (convert) convertAllWeights(to);
  settings.units = to;
  save(KEY.settings, settings);
  persist();
  pendingUnits = null;
  $('units-sheet').hidden = true;
  renderSettings();
  renderToday();
  renderHistory();
}

document.querySelectorAll('#seg-units button').forEach(b => {
  b.onclick = () => {
    const to = b.dataset.val;
    if (to === settings.units) return;
    const n = countLoggedWeights();
    if (!n) { applyUnits(to, false); return; }
    pendingUnits = to;
    $('units-sheet-title').textContent = 'Switch to ' + (to === 'kg' ? 'kilograms' : 'pounds') + '?';
    $('units-summary').textContent =
      n + ' stored number' + (n === 1 ? '' : 's') + ' can be converted (' +
      (to === 'kg' ? '÷' : '×') + ' 2.2) so your history still reads true, ' +
      'or left as-is with only the label changing.';
    $('units-sheet').hidden = false;
  };
});
$('units-convert').onclick = () => { if (pendingUnits) applyUnits(pendingUnits, true); };
$('units-relabel').onclick = () => { if (pendingUnits) applyUnits(pendingUnits, false); };
$('units-cancel').onclick = () => { pendingUnits = null; $('units-sheet').hidden = true; };
$('units-sheet').onclick = e => {
  if (e.target.id === 'units-sheet') { pendingUnits = null; $('units-sheet').hidden = true; }
};

/* import */
$('import-btn').onclick = () => $('import-file').click();
$('import-file').onchange = e => {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-picking the same file after a cancel
  if (!file) return;
  file.text().then(text => {
    let data = null;
    try { data = JSON.parse(text); } catch (err) { /* fall through */ }
    if (!data) {
      pendingImport = null;
      openImportSheet('That file is not readable JSON.', false);
    } else if (!validateBackup(data)) {
      pendingImport = null;
      openImportSheet('That file does not look like a Daily Workout backup.', false);
    } else {
      pendingImport = data;
      openImportSheet(describeBackup(data), true);
    }
  });
};
$('import-replace').onclick = () => applyImport('replace');
$('import-merge').onclick = () => applyImport('merge');
$('import-cancel').onclick = () => { pendingImport = null; $('import-sheet').hidden = true; };
$('import-sheet').onclick = e => {
  if (e.target.id === 'import-sheet') { pendingImport = null; $('import-sheet').hidden = true; }
};

/* goals */
$('goal-add').onclick = openGoalPicker;
$('goal-pick-cancel').onclick = () => { $('goal-pick-sheet').hidden = true; };
$('goal-pick-sheet').onclick = e => { if (e.target.id === 'goal-pick-sheet') $('goal-pick-sheet').hidden = true; };
$('goal-cancel').onclick = () => { goalSheetId = null; $('goal-sheet').hidden = true; };
$('goal-sheet').onclick = e => { if (e.target.id === 'goal-sheet') { goalSheetId = null; $('goal-sheet').hidden = true; } };
$('goal-save').onclick = () => {
  const t = parseFloat($('goal-target').value);
  const ex = goalSheetId && exById(goalSheetId);
  if (!ex || !isFinite(t) || t <= 0) return;
  const type = ex.load ? 'load' : 'reps';
  const existing = goals[goalSheetId];
  const g = {
    type,
    target: type === 'reps' ? Math.round(t) : Math.round(t * 10) / 10,
    set: existing ? existing.set : today(),
    achieved: null,
  };
  // already there? mark it achieved rather than pretending it is a chase
  if (goalCurrent(goalSheetId, g) >= g.target) g.achieved = today();
  goals[goalSheetId] = g;
  persist();
  goalSheetId = null;
  $('goal-sheet').hidden = true;
  renderLifts();
  renderToday();   // pin may change today's plan
  if (navigator.vibrate) navigator.vibrate(30);
};
$('goal-delete').onclick = () => {
  if (goalSheetId) delete goals[goalSheetId];
  persist();
  goalSheetId = null;
  $('goal-sheet').hidden = true;
  renderLifts();
  renderToday();
};

/* past day viewer */
$('day-cancel').onclick = () => { $('day-sheet').hidden = true; };
$('day-sheet').onclick = e => { if (e.target.id === 'day-sheet') $('day-sheet').hidden = true; };

/* first-run card */
$('onboard-done').onclick = () => {
  save(KEY.onboard, true);
  $('onboard').hidden = true;
};
$('onboard').hidden = !!load(KEY.onboard, false);

/* PT test: a capacity field test whose results live in profile.pt and
   recalibrate bodyweight rep windows, core doses, and conditioning volume. */
function fmtRun(sec) {
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

function updatePtCard() {
  $('pt-card').hidden = !!settings.profile.pt || !!load(KEY.ptcard, false);
  const pt = settings.profile.pt;
  $('pt-open').textContent = pt
    ? 'Retake the PT test (' +
      [pt.pushups != null ? pt.pushups + ' push' : null,
       pt.situps != null ? pt.situps + ' sit' : null,
       pt.squats != null ? pt.squats + ' squat' : null,
       pt.runSec != null ? fmtRun(pt.runSec) + ' mile' : null]
        .filter(Boolean).join(' · ') + ')'
    : 'Take the PT test — sizes the rep targets to you';
}

function openPtSheet() {
  const pt = settings.profile.pt || {};
  $('pt-pushups').value = pt.pushups != null ? pt.pushups : '';
  $('pt-situps').value  = pt.situps  != null ? pt.situps  : '';
  $('pt-squats').value  = pt.squats  != null ? pt.squats  : '';
  $('pt-run-min').value = pt.runSec != null ? Math.floor(pt.runSec / 60) : '';
  $('pt-run-sec').value = pt.runSec != null ? pt.runSec % 60 : '';
  $('pt-sheet').hidden = false;
}

$('pt-take').onclick = openPtSheet;
$('pt-open').onclick = openPtSheet;
$('pt-later').onclick = () => { save(KEY.ptcard, true); updatePtCard(); };
$('pt-timer').onclick = () => startRest(120, 'Max clean reps — go!');
$('pt-cancel').onclick = () => { $('pt-sheet').hidden = true; };
$('pt-sheet').onclick = e => { if (e.target.id === 'pt-sheet') $('pt-sheet').hidden = true; };
$('pt-save').onclick = () => {
  const count = id => {
    const v = parseInt($(id).value, 10);
    return (Number.isFinite(v) && v >= 1 && v <= 200) ? v : null;
  };
  const mm = parseInt($('pt-run-min').value, 10);
  const ss = parseInt($('pt-run-sec').value, 10);
  const runSec = Number.isFinite(mm) && mm >= 4 && mm <= 30
    ? mm * 60 + (Number.isFinite(ss) && ss >= 0 && ss <= 59 ? ss : 0)
    : null;
  const pt = { pushups: count('pt-pushups'), situps: count('pt-situps'),
               squats: count('pt-squats'), runSec, date: today() };
  if (pt.pushups == null && pt.situps == null && pt.squats == null && pt.runSec == null) return;
  settings.profile.pt = pt;
  save(KEY.settings, settings);
  $('pt-sheet').hidden = true;
  updatePtCard();
  renderToday();   // the prescriptions just changed
  if (navigator.vibrate) navigator.vibrate(30);
};
updatePtCard();

/* first-open setup sheet: profile + equipment, shown once. The seg and the
   toggles write straight into settings; Start banks the typed fields too. */
function renderSetupExp() {
  document.querySelectorAll('#setup-exp button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === (settings.profile.experience || 'regular')));
}
function closeSetup(applyFields) {
  if (applyFields) {
    settings.profile.name = $('setup-name').value.trim().slice(0, 30);
    const v = parseInt($('setup-age').value, 10);
    settings.profile.age = (Number.isFinite(v) && v >= 10 && v <= 100) ? v : null;
    save(KEY.settings, settings);
  }
  save(KEY.setup, true);
  $('setup-sheet').hidden = true;
  renderSettings();
  renderToday();
  if (applyFields && navigator.vibrate) navigator.vibrate(30);
}
document.querySelectorAll('#setup-exp button').forEach(b => {
  b.onclick = () => {
    settings.profile.experience = b.dataset.val;
    save(KEY.settings, settings);
    renderSetupExp();
  };
});
$('setup-save').onclick = () => closeSetup(true);
$('setup-skip').onclick = () => closeSetup(false);
if (!load(KEY.setup, false)) {
  buildEquipToggles($('setup-equip'));
  renderSetupExp();
  $('setup-name').value = settings.profile.name || '';
  $('setup-age').value = settings.profile.age != null ? settings.profile.age : '';
  $('setup-sheet').hidden = false;
}

$('export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify({ settings, logs, weights, overrides, body, maxes, goals }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'daily-workout-' + today() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

$('reset-btn').onclick = () => {
  // two taps to confirm, rather than a modal dialog
  const b = $('reset-btn');
  if (b.dataset.armed) {
    Object.values(KEY).forEach(k => localStorage.removeItem(k));
    location.reload();
    return;
  }
  b.dataset.armed = '1';
  b.textContent = 'Tap again to erase everything';
  setTimeout(() => { delete b.dataset.armed; b.textContent = 'Erase all data'; }, 4000);
};

/* roll over to the new day if the app was left open overnight */
let lastKey = today();
setInterval(() => {
  if (today() !== lastKey) { lastKey = today(); renderToday(); }
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (today() !== lastKey) { lastKey = today(); renderToday(); }
  // the audio context is suspended while backgrounded; give it a chance to
  // come back before the rest ends, in case the user never taps again
  unlockAudio();
  // wake locks auto-release in the background; refresh the timer on return
  if (restTimer) {
    paintRest();
    if (restLeftNow() <= 0) endRest();
    else acquireWakeLock();
  }
});

/* Collapse the sticky header once you are into the workout. Two thresholds
   rather than one so the bar cannot flicker when a scroll settles right on the
   boundary, and the read is deferred to rAF so it never lands mid-frame. */
(function stickyHeader() {
  const COLLAPSE = 56, EXPAND = 24;
  let collapsed = false, queued = false;

  function measure() {
    queued = false;
    const y = window.scrollY;
    if (!collapsed && y > COLLAPSE) {
      collapsed = true;
      document.body.classList.add('scrolled');
    } else if (collapsed && y < EXPAND) {
      collapsed = false;
      document.body.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  }, { passive: true });
})();

renderToday();

/* Top the schedule back up on every open. The window is finite, so a run of
   days without opening the app would otherwise walk off the end of it. */
reconcileReminders();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
