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

  /* Training blocks. Primary lifts hold steady for a whole block — double
     progression only bites when the same lift shows up week after week — and
     rotate when the block turns over. Accessories still vary day to day.

     Experience sets the block length: a new lifter needs repetition to learn
     the lifts, a seasoned one has earned the variety. */
  const BLOCK_DAYS = 21;
  const EXPERIENCE_BLOCKS = { new: 28, regular: 21, seasoned: 14 };
  function blockFor(key, days) {
    return Math.floor(dayNumber(key) / (days || BLOCK_DAYS));
  }

  /* Heart-rate guidance for conditioning, from the plain 220-minus-age
     estimate. Rough, but rough is what a phone can offer without a strap. */
  function hrZones(age) {
    const a = parseInt(age, 10);
    if (!Number.isFinite(a) || a < 10 || a > 100) return null;
    const max = 220 - a;
    const z = p => Math.round(max * p);
    return { max, easy: [z(0.6), z(0.7)], hard: [z(0.8), z(0.9)] };
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

  /* Which half of the body each focus day trains. Warm-ups lean TOWARD the
     day's bias (warm up what you are about to load); finishers steer AWAY
     from it (no swing ladder on top of a leg day). */
  const FOCUS_BIAS  = { push: 'upper', pull: 'upper', legs: 'lower', engine: 'full', full: 'full', recover: 'full' };
  const FOCUS_AVOID = { push: 'upper', pull: 'upper', legs: 'lower' };

  /* ---------------- goals ---------------- */

  /* A goal lift is PINNED: any slot that can host it, gets it — frequency is
     most of how a target is reached. Load goals also train in a strength rep
     window (with longer rests) on their primary day, while the full-body
     touch stays lighter. Rep goals just pin; the bodyweight rep-target
     machinery already knows what to do with them. */
  const GOAL_SCHEME = {
    short:    { sets: 3, reps: '4-6' },
    standard: { sets: 4, reps: '4-6' },
    long:     { sets: 5, reps: '4-6' },
  };
  const GOAL_REST = 150;

  /* Full-body slots whose fallback chains stop short of a category's
     heaviest slot — a bench or chin-up goal should still land on full-body
     day, so goal matching reaches one hop further than poolFor does. */
  const GOAL_REACH = { fb_push: ['push_main'], fb_pull: ['pull_vert'] };

  function goalPick(slot, goalIds, used, equip) {
    const chain = [slot]
      .concat(SLOT_FALLBACK[slot] || [])
      .concat(GOAL_REACH[slot] || []);
    for (const id of goalIds) {
      const ex = exerciseById(id);
      if (!ex || used.has(id) || !eligible(ex, equip)) continue;
      if (ex.slots.some(s => chain.includes(s))) return ex;
    }
    return null;
  }

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

  function buildPlan(key, settings, override, goals) {
    const ov = override || {};
    const equip = settings.equip;
    const len = settings.length;
    const prof = settings.profile || {};
    const blockDays = EXPERIENCE_BLOCKS[prof.experience] || BLOCK_DAYS;
    // callers pass ACTIVE goals only; sorted so pinning order is stable
    const goalIds = goals ? Object.keys(goals).sort() : [];
    const focusId = focusForDate(key, ov);
    const focus = FOCI[focusId];

    /* slot list scaled by session length. Short days cut slots chosen by the
       date rather than always the same tail, so triceps or calves are trimmed
       some days instead of never happening at all. The lead slot and the
       heavy work are never cut.

       Each slot keeps its ORIGINAL position as `i` — logged sets and rerolls
       are keyed by that index in storage, so it must not shift when the
       session length changes mid-day. */
    let slots = focus.slots.map((s, i) => ({ s, i }));
    if (len === 'short') {
      const keep = Math.max(2, Math.ceil(slots.length * 0.6));
      const spare = slots.filter(x => x.i > 0 && !PRIMARY_SLOTS.has(x.s));
      const drop = new Set();
      const start = spare.length ? seededIndex(key + '|trim', spare.length) : 0;
      for (let j = 0; j < spare.length && slots.length - drop.size > keep; j++) {
        drop.add(spare[(start + j) % spare.length].i);
      }
      slots = slots.filter(x => !drop.has(x.i));
      if (slots.length > keep) slots = slots.slice(0, keep);
    }
    if (len === 'long') {
      (focus.extra || []).forEach((s, j) => slots.push({ s, i: focus.slots.length + j }));
    }

    /* main work */
    const used = new Set();
    const main = [];
    let rampAssigned = false;
    slots.forEach(({ s: slot, i }) => {
      const roll = (ov.rerolls && ov.rerolls[i]) || 0;
      const sticky = PRIMARY_SLOTS.has(slot);

      // a goal lift takes any slot that can host it; rerolling escapes the
      // pin for the day and walks the normal pool instead
      let ex = roll ? null : goalPick(slot, goalIds, used, equip);
      const isGoal = !!ex;
      if (!ex) {
        const pool = poolFor(slot, used, equip);
        if (!pool.length) return;
        // Re-rolling walks deterministically through a shuffled view of the
        // pool. Primary slots seed from the training block, not the date, so
        // the same heavy lifts recur all block and progression has grip.
        const seed = (sticky ? 'b' + blockFor(key, blockDays) : key) + '|' + slot + '|' + i;
        const start = seededIndex(seed, pool.length);
        ex = pool[(start + roll) % pool.length];
      }
      used.add(ex.id);

      let scheme = SCHEMES[ex.type][len];
      let rest = REST[ex.type] || 60;
      if (isGoal && goals[ex.id].type === 'load' && sticky && ex.load && ex.type === 'compound') {
        scheme = GOAL_SCHEME[len];
        rest = GOAL_REST;
      }
      // the day's first heavy compound gets ramp-up sets before its work sets
      const ramp = !rampAssigned && sticky && ex.load && ex.type === 'compound';
      if (ramp) rampAssigned = true;
      main.push({ slot, index: i, ex, sets: scheme.sets, reps: scheme.reps, rest, primary: sticky, ramp, goal: isGoal });
    });

    /* warm-up: three movements, leaning toward the half of the body the day
       trains, topped up from the full pool if the biased one runs dry.
       Past fifty, cold starts cost more: a fourth movement and longer doses. */
    const older = Number.isFinite(parseInt(prof.age, 10)) && parseInt(prof.age, 10) >= 50;
    const warmCount = older ? 4 : 3;
    const warmDose = older ? '40 sec' : '30 sec';
    const bias = FOCUS_BIAS[focusId] || 'full';
    const warmAll = EXERCISES.filter(e => e.slots.includes('warmup') && eligible(e, equip));
    const warmPool = bias === 'full' ? warmAll : warmAll.filter(e => e.bias === bias || e.bias === 'full');
    const warm = [];
    const wUsed = new Set();
    for (let i = 0; i < warmCount; i++) {
      let p = warmPool.filter(e => !wUsed.has(e.id));
      if (!p.length) p = warmAll.filter(e => !wUsed.has(e.id));
      if (!p.length) break;
      const w = pick(p, key + '|warm|' + i);
      wUsed.add(w.id);
      warm.push({ ex: w, dose: w.id === 'light-cardio' ? '3 min' : warmDose });
    }

    /* finisher — never one that hammers what the day already trained */
    let finisher = null;
    if (focus.finisher) {
      let fPool = FINISHERS.filter(f => eligible(f, equip));
      const avoid = FOCUS_AVOID[focusId];
      if (avoid) {
        const kept = fPool.filter(f => f.stress !== avoid);
        if (kept.length) fPool = kept;
      }
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
     good set. An unfinished session holds instead.

     `holds` is how many consecutive recent sessions stalled at this load (see
     countHolds). Without an exit, a stalled lift would be told to repeat the
     same weight forever — after STALL_SESSIONS stalls the suggestion becomes
     a ~10% deload to rebuild from. */
  const STALL_SESSIONS = 3;

  function deloadWeight(weight, step) {
    // strictly below the current load — rounding to plate math must not climb
    // back up to the stalled weight — but never below a single step
    const rounded = Math.round((weight * 0.9) / step) * step;
    return Math.max(step, Math.min(rounded, weight - step));
  }

  /* Count consecutive recent sessions, newest first, completed at the same
     load without every set reaching the top of the window. A load change, an
     incomplete session, or a session that earned an advance ends the streak. */
  function countHolds(history, range, minSets) {
    if (!Array.isArray(history) || !history.length || !range) return 0;
    const w0 = parseFloat(history[0] && history[0].weight);
    if (!isFinite(w0) || w0 <= 0) return 0;
    const need = (Number.isFinite(minSets) && minSets > 0) ? minSets : 1;
    let n = 0;
    for (const h of history) {
      const w = parseFloat(h && h.weight);
      if (w !== w0) break;
      const reps = Array.isArray(h.reps) ? h.reps.filter(r => Number.isFinite(r) && r > 0) : [];
      if (reps.length < need) break;
      if (reps.every(r => r >= range.hi)) break;
      n++;
    }
    return n;
  }

  function progression(last, range, step, minSets, holds) {
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
    if (Number.isFinite(holds) && holds >= STALL_SESSIONS) {
      return { weight: deloadWeight(weight, step), advance: false, deload: true, reason: 'deload', reps };
    }
    return { weight, advance: false, reason: 'hold', reps };
  }

  /* Smallest jump worth making. Plate math in pounds bottoms out at 5 (a pair
     of 2.5s); in kilos, 2.5 (a pair of 1.25s). Dumbbell loads are logged per
     hand, so the same step applies. Cable stacks move in coarser jumps —
     roughly double the free-weight step. */
  function loadStep(units, ex) {
    const base = units === 'kg' ? 2.5 : 5;
    if (ex && Array.isArray(ex.equip) && ex.equip.includes('cable')) return base * 2;
    return base;
  }

  /* Bodyweight progression: there is no load to add, so the target is reps.
     Below the top of the window, aim one rep past the weakest set from last
     time. At the top of the window on every prescribed set, the movement is
     outgrown — callers should point at the library's `harder` variation. */
  function repTarget(last, range, minSets) {
    if (!last || !range) return null;
    const reps = Array.isArray(last.reps) ? last.reps.filter(r => Number.isFinite(r) && r > 0) : [];
    if (!reps.length) return null;
    const need = (Number.isFinite(minSets) && minSets > 0) ? minSets : 1;
    if (reps.length >= need && reps.every(r => r >= range.hi)) return { reason: 'top-out' };
    return { reason: 'add-rep', target: Math.min(range.hi, Math.min(...reps) + 1) };
  }

  /* History goes stale. A suggestion computed from a session more than four
     weeks back — a rotated-out block, a vacation — must not push the weight
     on: repeat the old load instead, and past eight weeks knock it down a
     notch. Applied on top of progression()'s output. */
  const STALE_DAYS = 28;
  function staleAdjust(prog, gapDays, step) {
    if (!prog || prog.weight == null) return prog;
    if (!Number.isFinite(gapDays) || gapDays <= STALE_DAYS) return prog;
    const lastW = prog.advance ? Math.round((prog.weight - step) * 10) / 10 : prog.weight;
    const weight = gapDays > STALE_DAYS * 2 ? deloadWeight(lastW, step) : lastW;
    return { weight, advance: false, reason: 'stale', reps: prog.reps, gapDays };
  }

  /* Timed work progresses by duration: after `streak` consecutive sessions
     completing every prescribed set, stretch each set by 5 seconds, capped
     at +30 so the scheme stays recognizable. Only second-doses progress —
     minutes of steady cardio are a different animal. */
  function timedTarget(reps, streak) {
    const m = String(reps).trim().match(/^(\d+)\s*sec$/i);
    if (!m || !Number.isFinite(streak) || streak <= 0) return null;
    const base = +m[1];
    return { seconds: base + Math.min(streak * 5, 30), base };
  }

  /* First session of a lift with no history but a recorded max: invert Epley
     to the load repeatable at the top of the rep window, rounded DOWN to
     plate math — a first session should start under the estimate, not over. */
  function startingWeight(maxEntry, range, units, ex) {
    if (!maxEntry || !range) return null;
    const est = e1rm(maxEntry.weight, maxEntry.reps);
    if (!est) return null;
    const step = loadStep(units, ex);
    const w = Math.floor((est / (1 + range.hi / 30)) / step) * step;
    return w >= step ? w : null;
  }

  /* Ramp-up sets before the day's first heavy compound: ascending sets at
     ~50% and ~75% of the working load, rounded to plate math, before jumping
     into work sets. Trivial loads get no ramp — there is nothing to warm up
     to under an empty-bar's worth of weight. */
  function rampSets(weight, units, ex) {
    const w = parseFloat(weight);
    const step = loadStep(units, ex);
    if (!isFinite(w) || w <= step * 2) return [];
    const at = pct => Math.max(step, Math.round((w * pct) / step) * step);
    const out = [];
    for (const r of [{ pct: 0.5, reps: 5 }, { pct: 0.75, reps: 3 }]) {
      const rw = at(r.pct);
      if (rw >= w) continue;
      if (out.length && out[out.length - 1].weight === rw) continue;
      out.push({ weight: rw, reps: r.reps });
    }
    return out;
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
    dateKey, dayNumber, keyToDate, blockFor,
    focusForDate, buildPlan, estimateMinutes,
    repRange, progression, countHolds, loadStep, rampSets,
    repTarget, staleAdjust, startingWeight, timedTarget, hrZones,
    maxableLifts, e1rm, exerciseById,
    // exposed for tests and for anything that needs to reason about slots
    SLOT_FALLBACK, PRIMARY_SLOTS, FOCUS_BIAS, FOCUS_AVOID,
    BLOCK_DAYS, STALL_SESSIONS, STALE_DAYS, GOAL_SCHEME, EXPERIENCE_BLOCKS,
  };
}));
