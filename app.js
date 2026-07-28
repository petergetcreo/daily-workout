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
const { dateKey, dayNumber, keyToDate, e1rm, exerciseById } = Engine;

function buildPlan(key) {
  return Engine.buildPlan(key, settings, overrides[key]);
}

/* ======================= day record ======================= */

function today() { return dateKey(new Date()); }

function record(key) {
  if (!logs[key]) logs[key] = { sets: {}, warm: {}, weights: {}, complete: false };
  const r = logs[key];
  r.sets = r.sets || {}; r.warm = r.warm || {}; r.weights = r.weights || {};
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
      persist();
      renderToday();
    };
    top.appendChild(swap);
    card.appendChild(top);

    const bottom = document.createElement('div');
    bottom.className = 'ex-bottom';

    const setWrap = document.createElement('div');
    setWrap.className = 'sets';
    for (let s = 1; s <= item.sets; s++) {
      const b = document.createElement('button');
      b.className = 'set' + (s <= doneSets ? ' done' : '');
      b.textContent = s;
      b.onclick = () => {
        // tapping a set marks everything up to it done; tapping the last done set clears it
        rec.sets[item.index] = (doneSets === s) ? s - 1 : s;
        persist();
        renderToday();
        if (rec.sets[item.index] === s && s < item.sets) {
          startRest(item.rest, 'Set ' + (s + 1) + ' of ' + item.sets + ' · ' + item.ex.name);
        }
      };
      setWrap.appendChild(b);
    }
    bottom.appendChild(setWrap);

    if (item.ex.load) {
      const w = document.createElement('div');
      w.className = 'weight';
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.placeholder = weights[item.ex.id] || '—';
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

function renderHistory() {
  renderBodyweight();
  renderMaxes();
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
  FOCUS_ORDER.forEach(id => {
    const b = document.createElement('button');
    b.className = 'focus-opt' + (id === cur ? ' on' : '');
    b.innerHTML = '<span>' + esc(FOCI[id].label) + '<small>' + esc(FOCI[id].blurb) + '</small></span>';
    b.onclick = () => {
      const ov = overrides[key] || (overrides[key] = {});
      ov.focus = id;
      ov.rerolls = {};
      const rec = record(key);
      rec.sets = {};
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
