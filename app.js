/* Daily Workout — offline PWA.
   All state is in localStorage. No network, no accounts, no backend. */

'use strict';

/* ======================= storage ======================= */

const KEY = {
  settings: 'dw.settings',
  log:      'dw.log',       // { "2026-07-27": { focus, complete, sets:{i:n}, warm:{i:true}, weights:{exId:val} } }
  weights:  'dw.weights',   // { exId: "135" }  most recent working weight
  overrides:'dw.overrides', // { "2026-07-27": { focus, rerolls:{i:n}, finisherRoll:n } }
  body:     'dw.body',      // { "2026-07-27": 182.4 }  body weight log
  maxes:    'dw.maxes',     // { exId: { weight: 225, reps: 3, date: "2026-07-27" } }
};

const DEFAULT_SETTINGS = {
  length: 'standard',
  units: 'lb',
  equip: { bw: true, db: true, bar: true, bench: true, cable: true, cardio: true },
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

let settings  = Object.assign(structuredClone(DEFAULT_SETTINGS), load(KEY.settings, {}));
settings.equip = Object.assign(structuredClone(DEFAULT_SETTINGS.equip), settings.equip || {});
let logs      = load(KEY.log, {});
let weights   = load(KEY.weights, {});
let overrides = load(KEY.overrides, {});
let body      = load(KEY.body, {});
let maxes     = load(KEY.maxes, {});

/* ======================= engine ======================= */

/* All generation logic lives in engine.js, which knows nothing about the DOM
   or storage. This layer owns state and rendering only. */
const { dateKey, dayNumber, keyToDate, e1rm, exerciseById, repRange } = Engine;

function buildPlan(key) {
  return Engine.buildPlan(key, settings, overrides[key]);
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

/* ======================= day record ======================= */

function today() { return dateKey(new Date()); }

function record(key) {
  if (!logs[key]) logs[key] = { sets: {}, warm: {}, weights: {}, reps: {}, complete: false };
  const r = logs[key];
  r.sets = r.sets || {}; r.warm = r.warm || {}; r.weights = r.weights || {}; r.reps = r.reps || {};
  return r;
}
function persist() {
  save(KEY.log, logs);
  save(KEY.weights, weights);
  save(KEY.overrides, overrides);
  save(KEY.body, body);
  save(KEY.maxes, maxes);
}

/* ======================= maxes ======================= */

const MAXABLE = Engine.maxableLifts();
const MAXABLE_IDS = new Set(MAXABLE.map(e => e.id));
const exById = exerciseById;

/* ======================= rendering ======================= */

let plan = null;
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
    rec.sets[item.index] = wasDone && doneSets === s ? s - 1 : s;
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
    rec.sets[item.index] = s;
  } else {
    const next = (reps[s - 1] || range.hi) - 1;
    if (next < range.lo) {
      rec.sets[item.index] = s - 1;
      reps.length = Math.max(0, s - 1);
    } else {
      reps[s - 1] = next;
    }
  }

  if (range) {
    reps.length = Math.min(reps.length, rec.sets[item.index] || 0);
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

  const nowDone = rec.sets[item.index] || 0;
  persist();
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

  $('hdr-date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  $('hdr-focus').textContent = plan.focus.label;
  $('hdr-blurb').textContent = plan.focus.blurb;
  $('main-note').textContent = '~' + plan.minutes + ' min total';

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
  const ml = $('main-list');
  ml.innerHTML = '';
  plan.main.forEach(item => {
    const doneSets = rec.sets[item.index] || 0;
    const card = document.createElement('div');
    card.className = 'ex' + (doneSets >= item.sets ? ' complete' : '');

    const dose = item.ex.type === 'cardio' || item.ex.type === 'mobility'
      ? (item.sets > 1 ? item.sets + ' × ' + item.reps : item.reps)
      : item.sets + ' × ' + item.reps;

    const top = document.createElement('div');
    top.className = 'ex-top';
    top.innerHTML =
      '<div style="flex:1;min-width:0">' +
        '<div class="ex-name">' + esc(item.ex.name) + '</div>' +
        '<div class="ex-cue">' + esc(item.ex.cue) + '</div>' +
      '</div>' +
      '<div class="ex-dose">' + esc(dose) + '</div>';
    const swap = document.createElement('button');
    swap.className = 'mini-btn';
    swap.innerHTML = '&#8635;';
    swap.setAttribute('aria-label', 'Swap ' + item.ex.name);
    swap.onclick = () => {
      const ov = overrides[key] || (overrides[key] = {});
      ov.rerolls = ov.rerolls || {};
      ov.rerolls[item.index] = (ov.rerolls[item.index] || 0) + 1;
      delete rec.sets[item.index];
      if (rec.reps) delete rec.reps[item.ex.id];
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
      b.className = 'set' + (isDone ? ' done' : '');

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
    $('finisher').innerHTML =
      '<div class="finisher-name">' + esc(plan.finisher.name) + '</div>' +
      '<div class="finisher-detail">' + esc(plan.finisher.detail) + '</div>';
  } else {
    $('finisher-block').hidden = true;
  }

  /* progress + finish button */
  const totalSets = plan.main.reduce((a, m) => a + m.sets, 0) + plan.warm.length;
  const doneAll = plan.main.reduce((a, m) => a + Math.min(rec.sets[m.index] || 0, m.sets), 0) +
                  plan.warm.filter((_, i) => rec.warm[i]).length;
  $('progress-fill').style.width = (totalSets ? (doneAll / totalSets) * 100 : 0) + '%';

  const btn = $('finish-btn');
  btn.textContent = rec.complete ? '✓ Logged for today' : 'Mark workout complete';
  btn.classList.toggle('done', !!rec.complete);

  $('hdr-streak').querySelector('.streak-num').textContent = streak();
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

function renderMaxes() {
  const list = $('max-list');
  list.innerHTML = '';
  const rows = Object.entries(maxes)
    .map(([id, m]) => [exById(id), m])
    .filter(([e]) => e)
    .sort((a, b) => a[0].name.localeCompare(b[0].name));

  if (!rows.length) {
    list.innerHTML = '<li class="empty">No maxes yet. Tap ＋ to add one, or hit “PR?” on a lift during a session.</li>';
    return;
  }
  for (const [ex, m] of rows) {
    const est = e1rm(m.weight, m.reps);
    const li = document.createElement('li');
    li.className = 'tappable';
    li.innerHTML =
      '<span class="max-main">' +
        '<span class="max-name">' + esc(ex.name) + '</span>' +
        '<span class="max-sub">' + esc(m.reps) + ' rep' + (m.reps == 1 ? '' : 's') +
          (m.date ? ' · ' + keyToDate(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '') +
        '</span>' +
      '</span>' +
      '<span class="max-val">' +
        '<span class="max-weight">' + esc(m.weight) + ' ' + settings.units + '</span>' +
        (est && m.reps > 1 ? '<span class="max-1rm">~' + est + ' est. 1RM</span>' : '') +
      '</span>';
    li.onclick = () => openMaxSheet(ex.id);
    list.appendChild(li);
  }
}

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

function renderLiftTrends() {
  const list = $('lift-trend-list');
  list.innerHTML = '';
  const cutoff = dayNumber(today()) - 90;
  const rows = Object.keys(weights)
    .map(id => [exById(id), liftSeries(id).filter(([k]) => dayNumber(k) >= cutoff)])
    .filter(([e, pts]) => e && e.load && pts.length >= 2)
    // most recently trained first
    .sort((a, b) => b[1][b[1].length - 1][0].localeCompare(a[1][a[1].length - 1][0]))
    .slice(0, 8);

  if (!rows.length) {
    list.innerHTML = '<li class="empty">Log a lift with a weight on two different days and its trend shows up here.</li>';
    return;
  }
  for (const [ex, pts] of rows) {
    const latest = pts[pts.length - 1][1];
    const diff = Math.round(latest - pts[0][1]);
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    const li = document.createElement('li');
    li.className = 'lift-trend';
    li.innerHTML =
      '<span class="max-main">' +
        '<span class="max-name">' + esc(ex.name) + '</span>' +
        '<span class="max-sub">' + sign + Math.abs(diff) + ' ' + settings.units + ' over ' + pts.length + ' sessions</span>' +
      '</span>' +
      sparkSvg(pts, 96, 30) +
      '<span class="lift-now">~' + Math.round(latest) + '</span>';
    list.appendChild(li);
  }
}

function renderHistory() {
  renderBodyweight();
  renderMaxes();
  renderLiftTrends();
  const done = Object.entries(logs).filter(([, v]) => v.complete);
  $('stat-streak').textContent = streak();
  $('stat-total').textContent = done.length;
  const mk = today().slice(0, 7);
  $('stat-month').textContent = done.filter(([k]) => k.startsWith(mk)).length;

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
      row.appendChild(c);
    }
    cal.appendChild(row);
  }

  /* recent sessions */
  const ll = $('log-list');
  ll.innerHTML = '';
  const recent = done.sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  if (!recent.length) {
    ll.innerHTML = '<li class="empty">Nothing logged yet. Go do today’s.</li>';
  } else {
    recent.forEach(([k, v]) => {
      const li = document.createElement('li');
      const label = (FOCI[v.focus] && FOCI[v.focus].label) || 'Workout';
      li.innerHTML =
        '<span class="l-date">' + keyToDate(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '</span>' +
        '<span>' + esc(label) + '</span>';
      ll.appendChild(li);
    });
  }

  /* working weights */
  const wl = $('weights-list');
  wl.innerHTML = '';
  const entries = Object.entries(weights);
  if (!entries.length) {
    wl.innerHTML = '<li class="empty">Log a weight and it shows up here.</li>';
  } else {
    entries
      .map(([id, v]) => [EXERCISES.find(e => e.id === id), v])
      .filter(([e]) => e)
      .sort((a, b) => a[0].name.localeCompare(b[0].name))
      .forEach(([e, v]) => {
        const li = document.createElement('li');
        li.innerHTML = '<span>' + esc(e.name) + '</span><span class="l-val">' + esc(v) + ' ' + settings.units + '</span>';
        wl.appendChild(li);
      });
  }
}

/* ======================= settings ======================= */

const EQUIP_LABELS = [
  ['bw',     'Bodyweight',      'Floor space, always on'],
  ['db',     'Dumbbells / KB',  'Free weights at hand'],
  ['bar',    'Barbell + rack',  'Squat rack, pull-up bar'],
  ['bench',  'Bench',           'Flat or adjustable'],
  ['cable',  'Cable',           'Single adjustable pulley'],
  ['cardio', 'Cardio machine',  'Treadmill, bike, rower, outdoors'],
];

function renderSettings() {
  document.querySelectorAll('#seg-length button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === settings.length));
  document.querySelectorAll('#seg-units button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === settings.units));

  const box = $('equip-toggles');
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
        renderSettings();
      }
      save(KEY.settings, settings);
      renderToday();
    };
    box.appendChild(label);
  });
}

/* ======================= rest timer ======================= */

let restTimer = null, restLeft = 0;

function startRest(seconds, nextLabel) {
  restLeft = seconds;
  $('rest-next').textContent = nextLabel || '';
  $('rest').hidden = false;
  paintRest();
  clearInterval(restTimer);
  restTimer = setInterval(() => {
    restLeft--;
    paintRest();
    if (restLeft <= 0) { beep(); stopRest(); }
  }, 1000);
}
function paintRest() {
  const m = Math.floor(Math.max(restLeft, 0) / 60);
  const s = Math.max(restLeft, 0) % 60;
  $('rest-time').textContent = m + ':' + String(s).padStart(2, '0');
}
function stopRest() {
  clearInterval(restTimer);
  restTimer = null;
  $('rest').hidden = true;
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.13);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.14);
    });
    setTimeout(() => ctx.close(), 900);
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
      rec.sets = {};
      rec.reps = {};
      persist();
      $('focus-sheet').hidden = true;
      renderToday();
    };
    box.appendChild(b);
  });
  $('focus-sheet').hidden = false;
}

/* ======================= wiring ======================= */

document.querySelectorAll('.tabbar button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabbar button').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    b.classList.add('active');
    $('view-' + b.dataset.view).classList.add('active');
    if (b.dataset.view === 'progress') renderHistory();
    if (b.dataset.view === 'settings') renderSettings();
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
$('rest-add').onclick = () => { restLeft += 30; paintRest(); };

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
  $('max-sheet').hidden = true;
  renderMaxes();
  renderToday();   // clears the PR chip now that the max is banked
  if (navigator.vibrate) navigator.vibrate(30);
};

$('max-clear').onclick = () => {
  if (maxSheetId) delete maxes[maxSheetId];
  persist();
  $('max-sheet').hidden = true;
  renderMaxes();
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
document.querySelectorAll('#seg-units button').forEach(b => {
  b.onclick = () => {
    settings.units = b.dataset.val;
    save(KEY.settings, settings);
    renderSettings();
    renderToday();
  };
});

$('export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify({ settings, logs, weights, overrides, body, maxes }, null, 2)], { type: 'application/json' });
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
  if (!document.hidden && today() !== lastKey) { lastKey = today(); renderToday(); }
});

renderToday();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
