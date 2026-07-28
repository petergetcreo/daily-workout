/* Daily Workout — generation engine.

   Pure logic. No DOM, no localStorage, no module-level mutable state: every
   function takes what it needs as an argument and returns a value. That makes
   it testable headlessly (see test/engine.test.js) and portable — this is the
   part that would move to Swift or Capacitor unchanged in spirit, while the
   rendering layer gets rebuilt per platform. */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./exercises.js'));
  } else {
    root.Engine = factory(root.LIBRARY);
  }
}(typeof self !== 'undefined' ? self : this, function (lib) {
  'use strict';

  const { EXERCISES, FINISHERS, FOCI, FOCUS_ORDER, SCHEMES, REST } = lib;

  /* ---------------- dates ---------------- */

  /* Keys are the LOCAL calendar day, deliberately — a late-night weigh-in
     should file under the day you were actually living in, not UTC's. */
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

  /* ---------------- deterministic randomness ---------------- */

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
  /* Same date + same slot always yields the same exercise, so a session does
     not reshuffle when the app is closed and reopened partway through. */
  function pick(pool, seedStr) {
    if (!pool.length) return null;
    return pool[Math.floor(mulberry32(hash(seedStr))() * pool.length)];
  }
  function seededIndex(seedStr, length) {
    return Math.floor(mulberry32(hash(seedStr))() * length);
  }

  /* ---------------- slots ---------------- */

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

  /* Slots that carry the heavy work. If any loaded option is available here,
     prefer it — with a rack in the garage, Push day should open with a bench
     press, not a push-up. */
  const PRIMARY_SLOTS = new Set(['push_main', 'push_second', 'pull_horiz', 'pull_vert', 'squat', 'hinge']);

  function eligible(item, equip) {
    return item.equip.every(code => equip[code]);
  }

  function poolFor(slot, used, equip) {
    const primary = PRIMARY_SLOTS.has(slot);
    const chain = [slot].concat(SLOT_FALLBACK[slot] || []);
    for (const s of chain) {
      let pool = EXERCISES.filter(e => e.slots.includes(s) && eligible(e, equip) && !used.has(e.id));
      if (primary) {
        const loaded = pool.filter(e => !(e.equip.length === 1 && e.equip[0] === 'bw'));
        if (loaded.length) pool = loaded;
      }
      if (pool.length) return pool;
    }
    return [];
  }

  /* ---------------- plan ---------------- */

  /* The focus needs only the date, which is why a notification can name the
     day without reading any of the user's stored settings. */
  function focusForDate(key, override) {
    const ov = override || {};
    if (ov.focus && FOCI[ov.focus]) return ov.focus;
    const n = dayNumber(key);
    return FOCUS_ORDER[((n % FOCUS_ORDER.length) + FOCUS_ORDER.length) % FOCUS_ORDER.length];
  }

  function buildPlan(key, settings, override) {
    const ov = override || {};
    const equip = settings.equip;
    const len = settings.length;
    const focusId = focusForDate(key, ov);
    const focus = FOCI[focusId];

    /* slot list scaled by session length */
    let slots = focus.slots.slice();
    if (len === 'short') slots = slots.slice(0, Math.max(2, Math.ceil(slots.length * 0.6)));
    if (len === 'long')  slots = slots.concat(focus.extra || []);

    /* main work */
    const used = new Set();
    const main = [];
    slots.forEach((slot, i) => {
      const pool = poolFor(slot, used, equip);
      if (!pool.length) return;
      const roll = (ov.rerolls && ov.rerolls[i]) || 0;
      // Re-rolling walks deterministically through a shuffled view of the pool.
      const start = seededIndex(key + '|' + slot + '|' + i, pool.length);
      const ex = pool[(start + roll) % pool.length];
      used.add(ex.id);
      const scheme = SCHEMES[ex.type][len];
      main.push({ slot, index: i, ex, sets: scheme.sets, reps: scheme.reps, rest: REST[ex.type] || 60 });
    });

    /* warm-up: three movements */
    const warmPool = EXERCISES.filter(e => e.slots.includes('warmup') && eligible(e, equip));
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
      const fPool = FINISHERS.filter(f => eligible(f, equip));
      if (fPool.length) {
        const roll = ov.finisherRoll || 0;
        const start = seededIndex(key + '|fin', fPool.length);
        finisher = fPool[(start + roll) % fPool.length];
      }
    }

    return { key, focusId, focus, main, warm, finisher, minutes: estimateMinutes(main, !!finisher) };
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

  /* ---------------- progression ---------------- */

  /* Turn a prescription into a rep window. "6-8" is explicit; a bare "8" gets
     a small band below it so there is somewhere to log a miss. Timed work
     ("40 sec", "10 min") has no rep window at all. */
  function repRange(reps) {
    if (reps == null) return null;
    const s = String(reps).trim();
    if (/sec|min/i.test(s)) return null;
    const span = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (span) {
      const lo = +span[1], hi = +span[2];
      return lo <= hi ? { lo, hi } : { lo: hi, hi: lo };
    }
    const one = s.match(/^(\d+)$/);
    if (one) {
      const n = +one[1];
      return { lo: Math.max(1, n - 2), hi: n };
    }
    return null;
  }

  /* Double progression: work inside the rep window at a fixed load, and once
     every prescribed set reaches the top of the window, add weight.

     `minSets` matters more than it looks. Without it, logging one strong set
     and then abandoning the session would earn a load increase for work that
     never happened, and the suggested weight would ratchet up off a single
     good set. An unfinished session holds instead. */
  function progression(last, range, step, minSets) {
    if (!last || !range) return null;
    const weight = parseFloat(last.weight);
    if (!isFinite(weight) || weight <= 0) return null;

    const reps = Array.isArray(last.reps) ? last.reps.filter(n => Number.isFinite(n) && n > 0) : [];
    const need = (Number.isFinite(minSets) && minSets > 0) ? minSets : 1;

    if (!reps.length)     return { weight, advance: false, reason: 'no-reps', reps };
    if (reps.length < need) return { weight, advance: false, reason: 'incomplete', reps };

    if (reps.every(r => r >= range.hi)) {
      return { weight: Math.round((weight + step) * 10) / 10, advance: true, reason: 'hit-top', reps };
    }
    return { weight, advance: false, reason: 'hold', reps };
  }

  /* Smallest jump worth making. Plate math in pounds bottoms out at 5 (a pair
     of 2.5s); in kilos, 2.5 (a pair of 1.25s). */
  function loadStep(units) {
    return units === 'kg' ? 2.5 : 5;
  }

  /* ---------------- lifts & maxes ---------------- */

  /* The loaded compound movements, where a recorded max is a meaningful
     number. Curls, lateral raises and calf raises are excluded on purpose. */
  function maxableLifts() {
    return EXERCISES.filter(e => e.load && e.type === 'compound');
  }

  /* Epley. An estimate only, and it drifts badly past ~10 reps, so callers
     get null above 12 rather than a number that reads as authoritative. */
  function e1rm(weight, reps) {
    const w = parseFloat(weight), r = parseInt(reps, 10);
    if (!w || !r || r < 1) return null;
    if (r === 1) return Math.round(w);
    if (r > 12) return null;
    return Math.round(w * (1 + r / 30));
  }

  function exerciseById(id) {
    return EXERCISES.find(e => e.id === id) || null;
  }

  return {
    dateKey, dayNumber, keyToDate,
    focusForDate, buildPlan, estimateMinutes,
    repRange, progression, loadStep,
    maxableLifts, e1rm, exerciseById,
    // exposed for tests and for anything that needs to reason about slots
    SLOT_FALLBACK, PRIMARY_SLOTS,
  };
}));
