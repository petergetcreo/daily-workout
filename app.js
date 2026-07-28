/* Daily Workout — offline PWA.
   All state is in localStorage. No network, no accounts, no backend. */

'use strict';

/* ======================= storage ======================= */

const KEY = {
  settings: 'dw.settings',
  log:      'dw.log',       // { "2026-07-27": { focus, complete, sets:{i:n}, warm:{i:true}, weights:{exId:val} } }
  weights:  'dw.weights',   // { exId: "135" }  most recent working weight
  overrides:'dw.overrides', // { "2026-07-27": { focus, rerolls:{i:n}, finisherRoll:n } }
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

/* ======================= dates & randomness ======================= */

function dateKey(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* Deterministic pick: same date + same slot always yields the same exercise,
   so the workout does not reshuffle when you reopen the app mid-session. */
function pick(pool, seedStr) {
  if (!pool.length) return null;
  return pool[Math.floor(mulberry32(hash(seedStr))() * pool.length)];
}

/* ======================= plan generation ======================= */

const SLOT_FALLBACK = {
  push_main:  ['push_second', 'fb_push'],
  push_second:['push_acc', 'fb_push'],
  push_acc:   ['fb_push', 'triceps'],
  triceps:    ['push_acc', 'fb_push'],
  pull_horiz: ['pull_vert', 'fb_pull'],
  pull_vert:  ['pull_horiz', 'fb_pull'],
  pull_acc:   ['fb_pull', 'biceps'],
  biceps:     ['pull_acc', 'fb_pull'],
  squat:      ['fb_lower', 'unilateral'],
  hinge:      ['fb_lower', 'unilateral'],
  unilateral: ['fb_lower', 'squat'],
  calves:     ['core'],
  carry:      ['core'],
  cardio:     ['core'],
  core:       ['mobility'],
  fb_lower:   ['squat', 'hinge'],
  fb_push:    ['push_second', 'push_acc'],
  fb_pull:    ['pull_horiz', 'pull_acc'],
  mobility:   ['warmup'],
  warmup:     ['mobility'],
};

function eligible(item) {
  return item.equip.every(code => settings.equip[code]);
}

/* Slots that carry the heavy work of the session. If any loaded option is
   available here, prefer it — with a rack in the garage, "Push day" should
   open with a bench press, not a push-up. */
const PRIMARY_SLOTS = new Set(['push_main', 'push_second', 'pull_horiz', 'pull_vert', 'squat', 'hinge']);

function poolFor(slot, used) {
  const primary = PRIMARY_SLOTS.has(slot);
  const chain = [slot].concat(SLOT_FALLBACK[slot] || []);
  for (const s of chain) {
    let pool = EXERCISES.filter(e => e.slots.includes(s) && eligible(e) && !used.has(e.id));
    if (primary) {
      const loaded = pool.filter(e => !(e.equip.length === 1 && e.equip[0] === 'bw'));
      if (loaded.length) pool = loaded;
    }
    if (pool.length) return pool;
  }
  return [];
}

function buildPlan(key) {
  const ov = overrides[key] || {};
  const focusId = (ov.focus && FOCI[ov.focus]) ? ov.focus
                : FOCUS_ORDER[((dayNumber(key) % FOCUS_ORDER.length) + FOCUS_ORDER.length) % FOCUS_ORDER.length];
  const focus = FOCI[focusId];
  const len = settings.length;

  /* slot list scaled by session length */
  let slots = focus.slots.slice();
  if (len === 'short') slots = slots.slice(0, Math.max(2, Math.ceil(slots.length * 0.6)));
  if (len === 'long')  slots = slots.concat(focus.extra || []);

  /* main work */
  const used = new Set();
  const main = [];
  slots.forEach((slot, i) => {
    const pool = poolFor(slot, used);
    if (!pool.length) return;
    const roll = (ov.rerolls && ov.rerolls[i]) || 0;
    // Re-rolling walks deterministically through a shuffled view of the pool.
    const start = Math.floor(mulberry32(hash(key + '|' + slot + '|' + i))() * pool.length);
    const ex = pool[(start + roll) % pool.length];
    used.add(ex.id);
    const scheme = SCHEMES[ex.type][len];
    main.push({ slot, index: i, ex, sets: scheme.sets, reps: scheme.reps, rest: REST[ex.type] || 60 });
  });

  /* warm-up: 3 movements, cardio primer first if a machine is available */
  const warmPool = EXERCISES.filter(e => e.slots.includes('warmup') && eligible(e));
  const warm = [];
  const wUsed = new Set();
  for (let i = 0; i < 3; i++) {
    const p = warmPool.filter(e => !wUsed.has(e.id));
    if (!p.length) break;
    const w = pick(p, key + '|warm|' + i);
    wUsed.add(w.id);
    warm.push({ ex: w, dose: w.id === 'light-cardio' ? '3 min' : '30 sec' });
  }

  /* finisher */
  let finisher = null;
  if (focus.finisher) {
    const fPool = FINISHERS.filter(eligible);
    if (fPool.length) {
      const roll = ov.finisherRoll || 0;
      const start = Math.floor(mulberry32(hash(key + '|fin'))() * fPool.length);
      finisher = fPool[(start + roll) % fPool.length];
    }
  }

  const minutes = estimateMinutes(main, !!finisher);
  return { key, focusId, focus, main, warm, finisher, minutes };
}

function estimateMinutes(main, hasFinisher) {
  let sec = 4 * 60; // warm-up
  for (const m of main) {
    let work;
    if (/min/.test(m.reps))      work = parseInt(m.reps, 10) * 60 * m.sets;
    else if (/sec/.test(m.reps)) work = parseInt(m.reps, 10) * m.sets;
    else                         work = m.sets * 40; // ~40s for a straight set of reps
    sec += work + (m.sets - 1) * m.rest;
  }
  if (hasFinisher) sec += 6 * 60;
  return Math.round(sec / 60);
}

/* ======================= day record ======================= */

function today() { return dateKey(new Date()); }

function record(key) {
  if (!logs[key]) logs[key] = { sets: {}, warm: {}, weights: {}, complete: false };
  const r = logs[key];
  r.sets = r.sets || {}; r.warm = r.warm || {}; r.weights = r.weights || {};
  return r;
}
function persist() { save(KEY.log, logs); save(KEY.weights, weights); save(KEY.overrides, overrides); }

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
      };
      w.appendChild(input);
      const u = document.createElement('span');
      u.textContent = settings.units;
      w.appendChild(u);
      bottom.appendChild(w);
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

function renderHistory() {
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
    if (b.dataset.view === 'history') renderHistory();
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
  const blob = new Blob([JSON.stringify({ settings, logs, weights, overrides }, null, 2)], { type: 'application/json' });
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
