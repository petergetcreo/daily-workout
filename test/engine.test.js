/* Engine tests. No dependencies — run with:  node --test test/
   (or `node test/engine.test.js` for a single file)

   These cover the properties that are easy to break silently when editing the
   exercise library: that every day produces a usable session, that nothing
   lands on a day it does not belong to, and that plans stay stable for a
   given date. */

const { test } = require('node:test');
const assert = require('node:assert');

const Engine = require('../engine.js');
const LIB = require('../exercises.js');
const { EXERCISES, FINISHERS, FOCI, FOCUS_ORDER, SCHEMES, REST } = LIB;

/* ---------- fixtures ---------- */

const EQUIP = {
  full:       { bw: 1, db: 1, kb: 1, bar: 1, bench: 1, cable: 1, cardio: 1 },
  bodyweight: { bw: 1, db: 0, kb: 0, bar: 0, bench: 0, cable: 0, cardio: 0 },
  hotel:      { bw: 1, db: 0, kb: 0, bar: 0, bench: 0, cable: 0, cardio: 1 },
  dumbbells:  { bw: 1, db: 1, kb: 0, bar: 0, bench: 0, cable: 0, cardio: 0 }, // DBs but no kettlebell
  garage:     { bw: 1, db: 1, kb: 1, bar: 1, bench: 1, cable: 1, cardio: 0 }, // Peter's setup
};
const LENGTHS = ['short', 'standard', 'long'];

function settingsFor(equipName, length) {
  return { length, units: 'lb', equip: EQUIP[equipName] };
}
function datesFrom(startKey, count) {
  const out = [];
  const d = Engine.keyToDate(startKey);
  for (let i = 0; i < count; i++) {
    out.push(Engine.dateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function everyCombo(fn) {
  for (const eq of Object.keys(EQUIP)) {
    for (const len of LENGTHS) {
      fn(settingsFor(eq, len), eq, len);
    }
  }
}

/* Which muscle category each slot trains, and which categories are allowed to
   appear on each focus day. This is the guard against a bad fallback chain
   quietly dropping a bicep curl onto leg day. */
const SLOT_CATEGORY = {
  push_main: 'push', push_second: 'push', push_acc: 'push', triceps: 'push',
  pull_horiz: 'pull', pull_vert: 'pull', pull_acc: 'pull', biceps: 'pull',
  squat: 'legs', hinge: 'legs', unilateral: 'legs', calves: 'legs',
  core: 'core', carry: 'core', cardio: 'cardio',
  mobility: 'mobility', warmup: 'mobility',
  fb_lower: 'legs', fb_push: 'push', fb_pull: 'pull',
};
const ALLOWED_CATEGORIES = {
  push:    ['push', 'core'],
  pull:    ['pull', 'core'],
  legs:    ['legs', 'core'],
  engine:  ['cardio', 'core', 'legs'],
  full:    ['legs', 'push', 'pull', 'core', 'cardio'],
  recover: ['mobility', 'cardio'],
};

/* ---------- library integrity ---------- */

test('every exercise is well formed', () => {
  const ids = new Set();
  for (const e of EXERCISES) {
    assert.ok(e.id && typeof e.id === 'string', 'missing id: ' + e.name);
    assert.ok(!ids.has(e.id), 'duplicate id: ' + e.id);
    ids.add(e.id);
    assert.ok(e.name, 'missing name: ' + e.id);
    assert.ok(Array.isArray(e.slots) && e.slots.length, 'no slots: ' + e.id);
    assert.ok(Array.isArray(e.equip) && e.equip.length, 'no equip: ' + e.id);
    assert.ok(SCHEMES[e.type], 'unknown type "' + e.type + '" on ' + e.id);
    assert.ok(REST[e.type] != null, 'no rest defined for type ' + e.type);
    assert.ok(e.cue && e.cue.length > 5, 'missing cue: ' + e.id);
    assert.strictEqual(typeof e.load, 'boolean', 'load must be boolean: ' + e.id);
    for (const s of e.slots) {
      assert.ok(SLOT_CATEGORY[s], 'exercise ' + e.id + ' uses unknown slot ' + s);
    }
    for (const c of e.equip) {
      assert.ok(c in EQUIP.full, 'exercise ' + e.id + ' uses unknown equipment ' + c);
    }
  }
});

/* The placement test below accepts an exercise if ANY of its slots suits the
   day, which means a mislabelled entry — a curl also tagged as a squat — would
   slip past it. Slot typos are the realistic failure mode when editing the
   library, so guard the data directly: one movement trains one of push, pull
   or legs, never two. Overlaps with core, cardio and mobility are fine and
   intentional (carries, swings, back extensions). */
test('no exercise spans two primary muscle categories', () => {
  const PRIMARY = ['push', 'pull', 'legs'];
  for (const e of EXERCISES) {
    const cats = new Set(e.slots.map(s => SLOT_CATEGORY[s]).filter(c => PRIMARY.includes(c)));
    assert.ok(cats.size <= 1,
      `"${e.name}" (${e.id}) claims to train ${[...cats].join(' and ')} — check its slots: ${e.slots.join(', ')}`);
  }
});

test('every focus references slots that some exercise can fill', () => {
  for (const id of FOCUS_ORDER) {
    const focus = FOCI[id];
    assert.ok(focus, 'FOCUS_ORDER names a missing focus: ' + id);
    for (const slot of focus.slots.concat(focus.extra || [])) {
      const any = EXERCISES.some(e => e.slots.includes(slot));
      assert.ok(any, 'no exercise can fill slot "' + slot + '" used by focus ' + id);
    }
  }
});

test('every scheme covers all three session lengths', () => {
  for (const [type, byLen] of Object.entries(SCHEMES)) {
    for (const len of LENGTHS) {
      assert.ok(byLen[len], 'scheme ' + type + ' missing length ' + len);
      assert.ok(byLen[len].sets >= 1, 'scheme ' + type + '/' + len + ' has no sets');
      assert.ok(byLen[len].reps, 'scheme ' + type + '/' + len + ' has no reps');
    }
  }
});

test('finishers only require known equipment', () => {
  for (const f of FINISHERS) {
    assert.ok(f.id && f.name && f.detail, 'malformed finisher: ' + JSON.stringify(f));
    for (const c of f.equip) assert.ok(c in EQUIP.full, 'finisher ' + f.id + ' unknown equip ' + c);
  }
});

test('every warm-up movement declares a bias', () => {
  for (const e of EXERCISES.filter(e => e.slots.includes('warmup'))) {
    assert.ok(['upper', 'lower', 'full'].includes(e.bias),
      e.id + ' can appear in a warm-up but has bias "' + e.bias + '"');
  }
});

test('every finisher declares the stress it loads', () => {
  for (const f of FINISHERS) {
    assert.ok(['upper', 'lower', 'mixed', 'cardio', 'core'].includes(f.stress),
      f.id + ' has stress "' + f.stress + '"');
  }
});

test('every focus has a warm-up bias', () => {
  for (const id of Object.keys(FOCI)) {
    assert.ok(['upper', 'lower', 'full'].includes(Engine.FOCUS_BIAS[id]),
      'focus ' + id + ' has no usable bias');
  }
});

/* ---------- rotation ---------- */

test('rotation cycles through every focus in order', () => {
  const keys = datesFrom('2026-01-01', FOCUS_ORDER.length * 3);
  const seen = keys.map(k => Engine.focusForDate(k));
  // the sequence must repeat with the rotation's period
  for (let i = FOCUS_ORDER.length; i < seen.length; i++) {
    assert.strictEqual(seen[i], seen[i - FOCUS_ORDER.length],
      'rotation is not periodic at ' + keys[i]);
  }
  assert.strictEqual(new Set(seen).size, new Set(FOCUS_ORDER).size, 'not every focus appears');
});

test('the rotation is one calendar week: each pattern once, recovery twice', () => {
  assert.strictEqual(FOCUS_ORDER.length, 7, 'rotation must span exactly a week');
  const counts = {};
  FOCUS_ORDER.forEach(f => { counts[f] = (counts[f] || 0) + 1; });
  assert.strictEqual(counts.recover, 2, 'expected two recovery days per week');
  for (const f of ['push', 'pull', 'legs', 'engine', 'full']) {
    assert.strictEqual(counts[f], 1, f + ' should appear exactly once per week');
  }
  // recovery days must not be adjacent, even across the cycle boundary
  for (let i = 0; i < FOCUS_ORDER.length; i++) {
    const next = FOCUS_ORDER[(i + 1) % FOCUS_ORDER.length];
    assert.ok(!(FOCUS_ORDER[i] === 'recover' && next === 'recover'),
      'back-to-back recovery days at position ' + i);
  }
});

test('a 10-week stretch spreads focuses in proportion to the rotation', () => {
  const freq = {};
  FOCUS_ORDER.forEach(f => { freq[f] = (freq[f] || 0) + 1; });
  const counts = {};
  for (const k of datesFrom('2026-03-01', FOCUS_ORDER.length * 10)) {
    const f = Engine.focusForDate(k);
    counts[f] = (counts[f] || 0) + 1;
  }
  for (const [f, n] of Object.entries(freq)) {
    assert.strictEqual(counts[f], n * 10,
      f + ' appeared ' + counts[f] + ' times in 10 weeks, expected ' + n * 10);
  }
});

test('an override changes the focus for that day only', () => {
  const key = '2026-05-04';
  const natural = Engine.focusForDate(key);
  const other = FOCUS_ORDER.find(f => f !== natural);
  assert.strictEqual(Engine.focusForDate(key, { focus: other }), other);
  assert.strictEqual(Engine.focusForDate(key), natural, 'override leaked into the default');
});

test('a bogus override falls back to the rotation', () => {
  const key = '2026-05-04';
  assert.strictEqual(Engine.focusForDate(key, { focus: 'nonsense' }), Engine.focusForDate(key));
});

/* ---------- plan generation ---------- */

test('every day in a year produces a usable session, on every setup', () => {
  const keys = datesFrom('2026-01-01', 365);
  everyCombo((settings, eq, len) => {
    for (const key of keys) {
      const plan = Engine.buildPlan(key, settings);
      const where = `${eq}/${len} ${key} (${plan.focusId})`;
      assert.ok(plan.main.length > 0, 'no exercises: ' + where);
      assert.ok(plan.warm.length > 0, 'no warm-up: ' + where);
      const ids = plan.main.map(m => m.ex.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'duplicate exercise: ' + where);
      for (const m of plan.main) {
        assert.ok(m.sets >= 1, 'zero sets: ' + where);
        assert.ok(m.reps, 'no reps: ' + where);
        assert.ok(m.rest > 0, 'no rest: ' + where);
      }
    }
  });
});

test('no movement lands on a day it does not belong to', () => {
  const keys = datesFrom('2026-01-01', 180);
  everyCombo((settings, eq, len) => {
    for (const key of keys) {
      const plan = Engine.buildPlan(key, settings);
      const allowed = ALLOWED_CATEGORIES[plan.focusId];
      for (const m of plan.main) {
        const cats = [...new Set(m.ex.slots.map(s => SLOT_CATEGORY[s]).filter(Boolean))];
        assert.ok(cats.some(c => allowed.includes(c)),
          `${eq}/${len} ${plan.focusId} day got "${m.ex.name}" (${cats}) via slot ${m.slot}`);
      }
    }
  });
});

test('only available equipment is ever prescribed', () => {
  const keys = datesFrom('2026-02-01', 120);
  everyCombo((settings, eq, len) => {
    for (const key of keys) {
      const plan = Engine.buildPlan(key, settings);
      const items = plan.main.map(m => m.ex).concat(plan.warm.map(w => w.ex));
      if (plan.finisher) items.push(plan.finisher);
      for (const item of items) {
        for (const code of item.equip) {
          assert.ok(settings.equip[code],
            `${eq}/${len} prescribed "${item.name}" which needs ${code}`);
        }
      }
    }
  });
});

test('primary slots prefer loaded movements when equipment allows', () => {
  const settings = settingsFor('full', 'standard');
  // across a month of push/pull/legs days the opening movement should never be
  // bare bodyweight when a rack and dumbbells are available
  let checked = 0;
  for (const key of datesFrom('2026-01-01', 60)) {
    const plan = Engine.buildPlan(key, settings);
    if (!['push', 'pull', 'legs'].includes(plan.focusId)) continue;
    const first = plan.main[0];
    if (!Engine.PRIMARY_SLOTS.has(first.slot)) continue;
    checked++;
    const bodyweightOnly = first.ex.equip.length === 1 && first.ex.equip[0] === 'bw';
    assert.ok(!bodyweightOnly,
      `${key} ${plan.focusId} opened with bodyweight "${first.ex.name}" despite a full gym`);
  }
  assert.ok(checked > 10, 'expected to check more primary slots, only saw ' + checked);
});

test('bodyweight-only still fills primary slots rather than dropping them', () => {
  const settings = settingsFor('bodyweight', 'standard');
  for (const key of datesFrom('2026-01-01', 60)) {
    const plan = Engine.buildPlan(key, settings);
    assert.ok(plan.main.length >= 2,
      `${key} ${plan.focusId} thinned to ${plan.main.length} exercise(s) on bodyweight only`);
  }
});

test('session length moves duration in the right direction', () => {
  for (const key of datesFrom('2026-01-01', 12)) {
    const short = Engine.buildPlan(key, settingsFor('full', 'short')).minutes;
    const std   = Engine.buildPlan(key, settingsFor('full', 'standard')).minutes;
    const long  = Engine.buildPlan(key, settingsFor('full', 'long')).minutes;
    assert.ok(short <= std, `${key}: short (${short}) exceeded standard (${std})`);
    assert.ok(std <= long, `${key}: standard (${std}) exceeded long (${long})`);
  }
});

test('estimated durations stay within sane bounds', () => {
  const BOUNDS = { short: [5, 32], standard: [10, 40], long: [12, 62] };
  const keys = datesFrom('2026-01-01', 90);
  everyCombo((settings, eq, len) => {
    for (const key of keys) {
      const { minutes, focusId } = Engine.buildPlan(key, settings);
      const [lo, hi] = BOUNDS[len];
      assert.ok(minutes >= lo && minutes <= hi,
        `${eq}/${len} ${focusId} ${key} estimated ${minutes} min, expected ${lo}-${hi}`);
    }
  });
});

test('recovery days carry no finisher; training days do', () => {
  for (const key of datesFrom('2026-01-01', 24)) {
    const plan = Engine.buildPlan(key, settingsFor('full', 'standard'));
    if (plan.focusId === 'recover') {
      assert.strictEqual(plan.finisher, null, 'recovery day got a finisher on ' + key);
    } else {
      assert.ok(plan.finisher, 'training day has no finisher on ' + key);
    }
  }
});

/* ---------- training blocks ---------- */

test('primary lifts hold steady within a block and rotate across blocks', () => {
  const settings = settingsFor('garage', 'standard');
  const byBlock = new Map();
  for (const key of datesFrom('2026-01-01', Engine.BLOCK_DAYS * 6)) {
    const plan = Engine.buildPlan(key, settings);
    if (plan.focusId !== 'push') continue;
    const primaries = plan.main
      .filter(m => Engine.PRIMARY_SLOTS.has(m.slot))
      .map(m => m.ex.id).join();
    const b = Engine.blockFor(key);
    if (!byBlock.has(b)) byBlock.set(b, new Set());
    byBlock.get(b).add(primaries);
  }
  for (const [b, picks] of byBlock) {
    assert.strictEqual(picks.size, 1,
      'block ' + b + ' reshuffled its primary lifts: ' + [...picks].join(' vs '));
  }
  const across = new Set([...byBlock.values()].map(s => [...s][0]));
  assert.ok(across.size > 1, 'primaries never rotated across ' + byBlock.size + ' blocks');
});

test('accessories still vary between days inside a block', () => {
  const settings = settingsFor('garage', 'standard');
  const byBlock = new Map();
  for (const key of datesFrom('2026-01-01', Engine.BLOCK_DAYS * 3)) {
    const plan = Engine.buildPlan(key, settings);
    if (plan.focusId !== 'push') continue;
    const acc = plan.main
      .filter(m => !Engine.PRIMARY_SLOTS.has(m.slot))
      .map(m => m.ex.id).join();
    const b = Engine.blockFor(key);
    if (!byBlock.has(b)) byBlock.set(b, new Set());
    byBlock.get(b).add(acc);
  }
  const varied = [...byBlock.values()].some(s => s.size > 1);
  assert.ok(varied, 'accessories were identical on every push day of every block');
});

/* ---------- short sessions ---------- */

test('short sessions never cut the lead slot or the heavy work', () => {
  for (const key of datesFrom('2026-01-01', 84)) {
    const short = Engine.buildPlan(key, settingsFor('full', 'short'));
    const std   = Engine.buildPlan(key, settingsFor('full', 'standard'));
    const shortSlots = short.main.map(m => m.slot);
    assert.strictEqual(shortSlots[0], std.main[0].slot,
      key + ' short day changed its lead slot');
    for (const m of std.main) {
      if (!Engine.PRIMARY_SLOTS.has(m.slot)) continue;
      assert.ok(shortSlots.includes(m.slot),
        key + ' short day cut primary slot ' + m.slot);
    }
  }
});

test('slot indices are stable across session-length changes', () => {
  // rec.sets and rerolls are keyed by item.index in storage; changing the
  // session length mid-day must not shift logged work onto other exercises
  for (const key of datesFrom('2026-01-01', 56)) {
    const std = Engine.buildPlan(key, settingsFor('full', 'standard'));
    const stdByIndex = new Map(std.main.map(m => [m.index, m.slot]));
    for (const len of ['short', 'long']) {
      const plan = Engine.buildPlan(key, settingsFor('full', len));
      for (const m of plan.main) {
        if (!stdByIndex.has(m.index)) continue; // long-mode extras extend past standard
        assert.strictEqual(stdByIndex.get(m.index), m.slot,
          `${key} ${len} index ${m.index} is ${m.slot} but ${stdByIndex.get(m.index)} in standard`);
      }
    }
  }
});

test('short sessions rotate which extras are cut instead of always the tail', () => {
  const seen = new Set();
  for (const key of datesFrom('2026-01-01', 120)) {
    const plan = Engine.buildPlan(key, settingsFor('full', 'short'));
    if (plan.focusId !== 'push') continue;
    plan.main.forEach(m => seen.add(m.slot));
  }
  assert.ok(seen.has('triceps'), 'triceps never made it into a short push day');
  assert.ok(seen.has('push_acc'), 'push_acc never made it into a short push day');
});

/* ---------- focus-aware warm-ups & finishers ---------- */

test('warm-ups lean toward the half of the body being trained', () => {
  everyCombo((settings, eq) => {
    for (const key of datesFrom('2026-01-01', 56)) {
      const plan = Engine.buildPlan(key, settings);
      const bias = Engine.FOCUS_BIAS[plan.focusId];
      if (bias === 'full') continue;
      const off = bias === 'upper' ? 'lower' : 'upper';
      for (const w of plan.warm) {
        assert.notStrictEqual(w.ex.bias, off,
          `${eq} ${plan.focusId} day warmed up with "${w.ex.name}" (${w.ex.bias})`);
      }
    }
  });
});

test('the finisher never hammers what the day already trained', () => {
  everyCombo((settings, eq) => {
    for (const key of datesFrom('2026-01-01', 56)) {
      for (let roll = 0; roll < 4; roll++) {
        const plan = Engine.buildPlan(key, settings, { finisherRoll: roll });
        if (!plan.finisher) continue;
        const avoid = Engine.FOCUS_AVOID[plan.focusId];
        if (!avoid) continue;
        assert.notStrictEqual(plan.finisher.stress, avoid,
          `${eq} ${plan.focusId} day got finisher "${plan.finisher.name}" (${plan.finisher.stress})`);
      }
    }
  });
});

test('kettlebell movements require the kettlebell toggle, not dumbbells', () => {
  assert.deepStrictEqual(Engine.exerciseById('kb-swing').equip, ['kb']);
  assert.deepStrictEqual(Engine.exerciseById('kb-high-pull').equip, ['kb']);
  assert.deepStrictEqual(FINISHERS.find(f => f.id === 'f-swings').equip, ['kb']);

  // a dumbbells-only setup is never prescribed kettlebell work
  const settings = settingsFor('dumbbells', 'standard');
  for (const key of datesFrom('2026-01-01', 84)) {
    const plan = Engine.buildPlan(key, settings);
    const items = plan.main.map(m => m.ex).concat(plan.warm.map(w => w.ex));
    if (plan.finisher) items.push(plan.finisher);
    for (const it of items) {
      assert.ok(!it.equip.includes('kb'), key + ' prescribed "' + it.name + '" without a kettlebell');
    }
  }

  // and with the toggle on, swings actually appear
  const kbSettings = { length: 'standard', units: 'lb',
    equip: { bw: 1, db: 1, kb: 1, bar: 0, bench: 0, cable: 0, cardio: 0 } };
  const seen = new Set();
  for (const key of datesFrom('2026-01-01', 180)) {
    Engine.buildPlan(key, kbSettings).main.forEach(m => seen.add(m.ex.id));
  }
  assert.ok(seen.has('kb-swing'), 'a kettlebell owner never got swings in 180 days');
});

/* ---------- goals ---------- */

test('a load goal pins its lift and trains it in a strength window', () => {
  const settings = settingsFor('garage', 'standard');
  const goals = { 'bb-bench': { type: 'load', target: 250 } };
  let pushDays = 0, fullDays = 0;
  for (const key of datesFrom('2026-01-01', 84)) {
    const plan = Engine.buildPlan(key, settings, null, goals);
    if (plan.focusId === 'push') {
      pushDays++;
      const first = plan.main[0];
      assert.strictEqual(first.ex.id, 'bb-bench', key + ' push day did not open with the goal lift');
      assert.strictEqual(first.goal, true);
      assert.strictEqual(first.reps, Engine.GOAL_SCHEME.standard.reps, 'goal lift not in the strength window');
      assert.strictEqual(first.sets, Engine.GOAL_SCHEME.standard.sets);
      assert.ok(first.rest > 100, 'heavy goal sets deserve longer rests');
      assert.ok(first.ramp, 'the pinned heavy lift still ramps');
    }
    if (plan.focusId === 'full') {
      fullDays++;
      const hit = plan.main.find(m => m.ex.id === 'bb-bench');
      assert.ok(hit, key + ' full day skipped the goal lift');
      assert.strictEqual(hit.reps, SCHEMES.compound.standard.reps,
        'the full-body touch should stay in the normal window, not grind heavy twice');
    }
  }
  assert.ok(pushDays >= 10 && fullDays >= 10, 'expected to see both day types');
});

test('a rep goal pins a bodyweight movement even when loaded options exist', () => {
  const settings = settingsFor('full', 'standard');
  const goals = { 'pushup': { type: 'reps', target: 20 } };
  for (const key of datesFrom('2026-01-01', 42)) {
    const plan = Engine.buildPlan(key, settings, null, goals);
    if (plan.focusId !== 'push') continue;
    assert.strictEqual(plan.main[0].ex.id, 'pushup',
      key + ' push day did not open with the goal movement');
    assert.strictEqual(plan.main[0].reps, SCHEMES.compound.standard.reps,
      'rep goals keep the normal rep window');
  }
});

test('two goals share a day without fighting over one slot', () => {
  const settings = settingsFor('garage', 'standard');
  const goals = {
    'bb-bench': { type: 'load', target: 250 },
    'pushup':   { type: 'reps', target: 20 },
  };
  for (const key of datesFrom('2026-01-01', 42)) {
    const plan = Engine.buildPlan(key, settings, null, goals);
    if (plan.focusId !== 'push') continue;
    assert.strictEqual(plan.main[0].ex.id, 'bb-bench');
    assert.strictEqual(plan.main[1].ex.id, 'pushup', key + ' second goal did not take the next slot');
    const ids = plan.main.map(m => m.ex.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'goal pinning produced a duplicate');
  }
});

test('a goal reaches full-body day even when its slot has no direct pool entry', () => {
  const settings = settingsFor('garage', 'standard');
  const goals = { 'chinup': { type: 'reps', target: 15 } };
  let checked = 0;
  for (const key of datesFrom('2026-01-01', 42)) {
    const plan = Engine.buildPlan(key, settings, null, goals);
    if (plan.focusId !== 'full') continue;
    checked++;
    assert.ok(plan.main.some(m => m.ex.id === 'chinup' && m.goal),
      key + ' full day did not host the chin-up goal');
  }
  assert.ok(checked >= 4);
});

test('rerolling escapes the pin for the day', () => {
  const settings = settingsFor('garage', 'standard');
  const goals = { 'bb-bench': { type: 'load', target: 250 } };
  const pushKey = datesFrom('2026-01-01', 14).find(k =>
    Engine.buildPlan(k, settings, null, goals).focusId === 'push');
  const rolled = Engine.buildPlan(pushKey, settings, { rerolls: { 0: 1 } }, goals);
  assert.notStrictEqual(rolled.main[0].ex.id, 'bb-bench', 'reroll should escape the pin');
  assert.strictEqual(rolled.main[0].goal, false);
});

test('goals the equipment cannot support neither pin nor break the plan', () => {
  const settings = settingsFor('bodyweight', 'standard');
  const goals = { 'bb-bench': { type: 'load', target: 250 } };
  for (const key of datesFrom('2026-01-01', 28)) {
    const plan = Engine.buildPlan(key, settings, null, goals);
    assert.ok(!plan.main.some(m => m.ex.id === 'bb-bench'), key + ' prescribed a barbell without a rack');
    assert.ok(plan.main.length >= 2, key + ' plan thinned out');
  }
});

test('goal plans stay deterministic', () => {
  const settings = settingsFor('garage', 'standard');
  const goals = { 'bb-bench': { type: 'load', target: 250 }, 'pushup': { type: 'reps', target: 20 } };
  for (const key of datesFrom('2026-06-01', 21)) {
    const a = Engine.buildPlan(key, settings, null, goals);
    const b = Engine.buildPlan(key, settings, null, goals);
    assert.deepStrictEqual(a.main.map(m => m.ex.id), b.main.map(m => m.ex.id), 'goal plan differs on ' + key);
  }
});

/* ---------- timed-work progression ---------- */

test('timed work stretches by 5 seconds per completed session, capped at +30', () => {
  assert.deepStrictEqual(Engine.timedTarget('40 sec', 1), { seconds: 45, base: 40 });
  assert.deepStrictEqual(Engine.timedTarget('40 sec', 3), { seconds: 55, base: 40 });
  assert.deepStrictEqual(Engine.timedTarget('30 sec', 12), { seconds: 60, base: 30 },
    'the bonus must cap at +30');
});

test('duration progression only applies to second-doses with a streak', () => {
  assert.strictEqual(Engine.timedTarget('40 sec', 0), null, 'no streak, no suggestion');
  assert.strictEqual(Engine.timedTarget('10 min', 4), null, 'steady cardio does not grind longer');
  assert.strictEqual(Engine.timedTarget('6-8', 4), null, 'rep work progresses by load, not time');
  assert.strictEqual(Engine.timedTarget('40 sec', NaN), null);
  assert.strictEqual(Engine.timedTarget(null, 3), null);
});

/* ---------- ramp-up sets ---------- */

test('ramp sets ascend through plate-rounded fractions of the work weight', () => {
  assert.deepStrictEqual(Engine.rampSets(135, 'lb'),
    [{ weight: 70, reps: 5 }, { weight: 100, reps: 3 }]);
  assert.deepStrictEqual(Engine.rampSets(225, 'lb'),
    [{ weight: 115, reps: 5 }, { weight: 170, reps: 3 }]);
  assert.deepStrictEqual(Engine.rampSets(100, 'kg'),
    [{ weight: 50, reps: 5 }, { weight: 75, reps: 3 }]);
});

test('trivial or junk loads produce no ramp', () => {
  assert.deepStrictEqual(Engine.rampSets(10, 'lb'), []);
  assert.deepStrictEqual(Engine.rampSets(0, 'lb'), []);
  assert.deepStrictEqual(Engine.rampSets(-50, 'lb'), []);
  assert.deepStrictEqual(Engine.rampSets('heavy', 'lb'), []);
  assert.deepStrictEqual(Engine.rampSets(null, 'lb'), []);
});

test('ramp weights stay strictly below the working weight and ascend', () => {
  for (let w = 15; w <= 500; w += 5) {
    const ramp = Engine.rampSets(w, 'lb');
    for (let i = 0; i < ramp.length; i++) {
      assert.ok(ramp[i].weight < w, `ramp for ${w} reached the work weight`);
      if (i) assert.ok(ramp[i].weight > ramp[i - 1].weight, `ramp for ${w} did not ascend`);
    }
  }
});

test('exactly the first heavy compound of a session is flagged for a ramp', () => {
  const keys = datesFrom('2026-01-01', 60);
  everyCombo((settings, eq, len) => {
    for (const key of keys) {
      const plan = Engine.buildPlan(key, settings);
      const flagged = plan.main.filter(m => m.ramp);
      const candidates = plan.main.filter(m =>
        Engine.PRIMARY_SLOTS.has(m.slot) && m.ex.load && m.ex.type === 'compound');
      if (candidates.length) {
        assert.strictEqual(flagged.length, 1,
          `${eq}/${len} ${key} flagged ${flagged.length} ramps`);
        assert.strictEqual(flagged[0].ex.id, candidates[0].ex.id,
          `${eq}/${len} ${key} ramp is not on the first heavy compound`);
      } else {
        assert.strictEqual(flagged.length, 0,
          `${eq}/${len} ${key} flagged a ramp without a heavy compound`);
      }
    }
  });
});

/* ---------- determinism ---------- */

test('the same date and settings always produce the same plan', () => {
  const settings = settingsFor('garage', 'standard');
  for (const key of datesFrom('2026-06-01', 30)) {
    const a = Engine.buildPlan(key, settings);
    const b = Engine.buildPlan(key, settings);
    assert.deepStrictEqual(a.main.map(m => m.ex.id), b.main.map(m => m.ex.id), 'main differs on ' + key);
    assert.deepStrictEqual(a.warm.map(w => w.ex.id), b.warm.map(w => w.ex.id), 'warm-up differs on ' + key);
    assert.strictEqual(a.finisher && a.finisher.id, b.finisher && b.finisher.id, 'finisher differs on ' + key);
  }
});

test('consecutive days differ', () => {
  const settings = settingsFor('garage', 'standard');
  const keys = datesFrom('2026-06-01', 20);
  for (let i = 1; i < keys.length; i++) {
    const prev = Engine.buildPlan(keys[i - 1], settings).main.map(m => m.ex.id).join();
    const cur  = Engine.buildPlan(keys[i], settings).main.map(m => m.ex.id).join();
    assert.notStrictEqual(cur, prev, keys[i] + ' repeated the previous day exactly');
  }
});

test('rerolling a slot swaps that exercise and leaves the others alone', () => {
  const settings = settingsFor('full', 'standard');
  const key = '2026-06-15';
  const base = Engine.buildPlan(key, settings);
  const target = base.main[0];
  const rolled = Engine.buildPlan(key, settings, { rerolls: { [target.index]: 1 } });
  assert.notStrictEqual(rolled.main[0].ex.id, target.ex.id, 'reroll did not change the exercise');
  assert.deepStrictEqual(
    rolled.main.slice(1).map(m => m.ex.id),
    base.main.slice(1).map(m => m.ex.id),
    'reroll disturbed the other slots'
  );
});

test('rerolling repeatedly cycles without ever producing nothing', () => {
  const settings = settingsFor('full', 'standard');
  const key = '2026-06-15';
  for (let roll = 0; roll < 25; roll++) {
    const plan = Engine.buildPlan(key, settings, { rerolls: { 0: roll } });
    assert.ok(plan.main[0] && plan.main[0].ex, 'reroll ' + roll + ' produced no exercise');
  }
});

test('the finisher can be rerolled independently of the exercises', () => {
  const settings = settingsFor('full', 'standard');
  const key = '2026-06-15';
  const base = Engine.buildPlan(key, settings);
  const rolled = Engine.buildPlan(key, settings, { finisherRoll: 1 });
  assert.notStrictEqual(rolled.finisher.id, base.finisher.id, 'finisher did not change');
  assert.deepStrictEqual(rolled.main.map(m => m.ex.id), base.main.map(m => m.ex.id),
    'finisher reroll disturbed the main work');
});

/* ---------- dates ---------- */

test('date keys use the local calendar day, not UTC', () => {
  // 11:30pm local on the 27th is already the 28th in UTC east of the meridian;
  // the key must still say the 27th
  const late = new Date(2026, 6, 27, 23, 30);
  assert.strictEqual(Engine.dateKey(late), '2026-07-27');
  assert.strictEqual(Engine.dateKey(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
});

test('dateKey and keyToDate round-trip', () => {
  for (const key of ['2026-01-01', '2026-02-28', '2026-07-27', '2026-12-31', '2028-02-29']) {
    assert.strictEqual(Engine.dateKey(Engine.keyToDate(key)), key);
  }
});

test('dayNumber advances by exactly one per calendar day across boundaries', () => {
  const spans = [
    ['2026-02-27', '2026-02-28'],
    ['2026-02-28', '2026-03-01'],   // non-leap year
    ['2028-02-28', '2028-02-29'],   // leap year
    ['2026-12-31', '2027-01-01'],
  ];
  for (const [a, b] of spans) {
    assert.strictEqual(Engine.dayNumber(b) - Engine.dayNumber(a), 1, a + ' -> ' + b);
  }
});

/* ---------- progression ---------- */

test('repRange reads explicit windows, bare numbers, and timed work', () => {
  assert.deepStrictEqual(Engine.repRange('6-8'), { lo: 6, hi: 8 });
  assert.deepStrictEqual(Engine.repRange('10-12'), { lo: 10, hi: 12 });
  assert.deepStrictEqual(Engine.repRange('12 - 15'), { lo: 12, hi: 15 });
  // a bare number gets a small band below it so a miss is loggable
  assert.deepStrictEqual(Engine.repRange('8'), { lo: 6, hi: 8 });
  assert.deepStrictEqual(Engine.repRange('2'), { lo: 1, hi: 2 }, 'must not produce a floor below 1');
  // timed work has no rep window
  assert.strictEqual(Engine.repRange('40 sec'), null);
  assert.strictEqual(Engine.repRange('10 min'), null);
  assert.strictEqual(Engine.repRange('45 sec'), null);
  assert.strictEqual(Engine.repRange(null), null);
  assert.strictEqual(Engine.repRange(''), null);
});

test('every scheme in the library yields either a rep window or timed work', () => {
  for (const [type, byLen] of Object.entries(SCHEMES)) {
    for (const len of LENGTHS) {
      const reps = byLen[len].reps;
      const range = Engine.repRange(reps);
      const timed = /sec|min/i.test(String(reps));
      assert.ok(range || timed, `scheme ${type}/${len} reps "${reps}" parses as neither`);
      if (range) assert.ok(range.lo >= 1 && range.lo <= range.hi, `bad range for ${type}/${len}`);
    }
  }
});

test('progression advances only when every prescribed set reached the top', () => {
  const range = { lo: 6, hi: 8 };
  const step = 5, sets = 3;
  // all sets at the top -> add weight
  let p = Engine.progression({ weight: 155, reps: [8, 8, 8] }, range, step, sets);
  assert.strictEqual(p.advance, true);
  assert.strictEqual(p.weight, 160);
  // one short set -> hold
  p = Engine.progression({ weight: 155, reps: [8, 8, 7] }, range, step, sets);
  assert.strictEqual(p.advance, false);
  assert.strictEqual(p.weight, 155, 'should repeat the same load');
  // exceeding the top still counts
  p = Engine.progression({ weight: 155, reps: [9, 10, 8] }, range, step, sets);
  assert.strictEqual(p.advance, true);
  // bottom of the range -> hold
  p = Engine.progression({ weight: 155, reps: [6, 6, 6] }, range, step, sets);
  assert.strictEqual(p.advance, false);
});

test('an abandoned session does not earn a load increase', () => {
  const range = { lo: 6, hi: 8 };
  // one strong set out of three prescribed: the session never happened
  let p = Engine.progression({ weight: 155, reps: [8] }, range, 5, 3);
  assert.strictEqual(p.advance, false, 'a single set must not ratchet the load up');
  assert.strictEqual(p.reason, 'incomplete');
  assert.strictEqual(p.weight, 155);

  p = Engine.progression({ weight: 155, reps: [8, 8] }, range, 5, 3);
  assert.strictEqual(p.advance, false, 'two of three sets is still incomplete');

  // and the moment it IS complete, it advances
  p = Engine.progression({ weight: 155, reps: [8, 8, 8] }, range, 5, 3);
  assert.strictEqual(p.advance, true);
});

test('extra sets beyond the prescription still advance', () => {
  const p = Engine.progression({ weight: 155, reps: [8, 8, 8, 8] }, { lo: 6, hi: 8 }, 5, 3);
  assert.strictEqual(p.advance, true, 'doing more than asked should not block progress');
});

test('progression holds when reps were never logged', () => {
  const p = Engine.progression({ weight: 155, reps: [] }, { lo: 6, hi: 8 }, 5);
  assert.strictEqual(p.advance, false);
  assert.strictEqual(p.reason, 'no-reps');
  assert.strictEqual(p.weight, 155, 'should still suggest repeating the load');
});

test('progression refuses to guess from missing or junk input', () => {
  const range = { lo: 6, hi: 8 };
  assert.strictEqual(Engine.progression(null, range, 5), null);
  assert.strictEqual(Engine.progression({ weight: 155 }, null, 5), null);
  assert.strictEqual(Engine.progression({ weight: 0, reps: [8] }, range, 5), null);
  assert.strictEqual(Engine.progression({ weight: 'heavy', reps: [8] }, range, 5), null);
  assert.strictEqual(Engine.progression({ weight: -100, reps: [8] }, range, 5), null);
});

test('progression ignores corrupt entries inside the reps array', () => {
  const range = { lo: 6, hi: 8 };
  const p = Engine.progression({ weight: 155, reps: [8, null, 8, undefined, NaN] }, range, 5);
  assert.deepStrictEqual(p.reps, [8, 8], 'should filter to the real numbers');
  assert.strictEqual(p.advance, true);
});

test('progression accepts weights stored as strings, which is how they arrive', () => {
  const p = Engine.progression({ weight: '155', reps: [8, 8, 8] }, { lo: 6, hi: 8 }, 5);
  assert.strictEqual(p.advance, true);
  assert.strictEqual(p.weight, 160, 'string weight must still do arithmetic, not concatenate');
});

test('load step matches the smallest real plate jump', () => {
  assert.strictEqual(Engine.loadStep('lb'), 5);
  assert.strictEqual(Engine.loadStep('kg'), 2.5);
  assert.strictEqual(Engine.loadStep(undefined), 5, 'defaults to pounds');
  // free weights step at the base; cable stacks jump roughly double
  assert.strictEqual(Engine.loadStep('lb', Engine.exerciseById('bb-bench')), 5);
  assert.strictEqual(Engine.loadStep('lb', Engine.exerciseById('db-row')), 5);
  assert.strictEqual(Engine.loadStep('lb', Engine.exerciseById('cable-fly')), 10);
  assert.strictEqual(Engine.loadStep('kg', Engine.exerciseById('cable-row')), 5);
});

test('a kilo progression does not produce unloadable fractions', () => {
  const p = Engine.progression({ weight: 100, reps: [8, 8, 8] }, { lo: 6, hi: 8 }, Engine.loadStep('kg'));
  assert.strictEqual(p.weight, 102.5);
});

test('repeated advancement climbs steadily rather than drifting', () => {
  const range = { lo: 6, hi: 8 };
  let weight = 135;
  for (let week = 0; week < 10; week++) {
    weight = Engine.progression({ weight, reps: [8, 8, 8] }, range, 5).weight;
  }
  assert.strictEqual(weight, 185, '10 weeks of hitting the top should be +50 lb, exactly');
});

/* ---------- stalls & deloads ---------- */

test('three stalled sessions at one load trigger a deload suggestion', () => {
  const range = { lo: 6, hi: 8 };
  const hist = [
    { weight: 155, reps: [7, 7, 6] },
    { weight: 155, reps: [8, 7, 7] },
    { weight: 155, reps: [7, 6, 6] },
    { weight: 150, reps: [8, 8, 8] },   // older, different load — must not count
  ];
  assert.strictEqual(Engine.countHolds(hist, range, 3), 3);
  const p = Engine.progression(hist[0], range, 5, 3, 3);
  assert.strictEqual(p.advance, false);
  assert.strictEqual(p.reason, 'deload');
  assert.strictEqual(p.deload, true);
  assert.strictEqual(p.weight, 140, '155 minus ~10% should land on the 140 plate');
});

test('fewer stalls than the threshold just hold the load', () => {
  const p = Engine.progression({ weight: 155, reps: [7, 7, 7] }, { lo: 6, hi: 8 }, 5, 3, 2);
  assert.strictEqual(p.reason, 'hold');
  assert.strictEqual(p.weight, 155);
});

test('a session that hits the top advances regardless of earlier stalls', () => {
  const p = Engine.progression({ weight: 155, reps: [8, 8, 8] }, { lo: 6, hi: 8 }, 5, 3, 5);
  assert.strictEqual(p.advance, true);
  assert.strictEqual(p.weight, 160);
});

test('countHolds ends the streak on load changes, advances, and incomplete sessions', () => {
  const range = { lo: 6, hi: 8 };
  // load changed one session back
  assert.strictEqual(Engine.countHolds([
    { weight: 155, reps: [7, 7, 7] },
    { weight: 150, reps: [7, 7, 7] },
  ], range, 3), 1);
  // an advance-worthy session interrupts the streak
  assert.strictEqual(Engine.countHolds([
    { weight: 155, reps: [7, 7, 7] },
    { weight: 155, reps: [8, 8, 8] },
    { weight: 155, reps: [7, 7, 7] },
  ], range, 3), 1);
  // an abandoned session is not evidence of a stall
  assert.strictEqual(Engine.countHolds([
    { weight: 155, reps: [7, 7, 7] },
    { weight: 155, reps: [7] },
    { weight: 155, reps: [7, 7, 7] },
  ], range, 3), 1);
  // junk in, zero out
  assert.strictEqual(Engine.countHolds(null, range, 3), 0);
  assert.strictEqual(Engine.countHolds([], range, 3), 0);
  assert.strictEqual(Engine.countHolds([{ weight: 'heavy', reps: [7, 7, 7] }], range, 3), 0);
  assert.strictEqual(Engine.countHolds([{ weight: 155, reps: [7, 7, 7] }], null, 3), 0);
});

test('a deload rounds to plate math and never drops below one step', () => {
  const range = { lo: 6, hi: 8 };
  const kg = Engine.progression({ weight: 60, reps: [7, 7, 7] }, range, 2.5, 3, 3);
  assert.strictEqual(kg.weight, 55, '60 kg minus ~10% is 54, which loads as 55');
  const tiny = Engine.progression({ weight: 5, reps: [7, 7, 7] }, range, 5, 3, 3);
  assert.strictEqual(tiny.weight, 5, 'a deload must never suggest less than one step');
});

test('a deload always lands strictly below the stalled weight', () => {
  const range = { lo: 6, hi: 8 };
  // light loads: 10% is less than half a step, so naive rounding would climb
  // straight back to the stalled weight and the deload would be a no-op
  for (const w of [15, 20, 25, 40]) {
    const p = Engine.progression({ weight: w, reps: [7, 7, 7] }, range, 5, 3, 3);
    assert.ok(p.weight < w, `deload from ${w} lb suggested ${p.weight}, not a reduction`);
    assert.ok(p.weight >= 5, `deload from ${w} lb dropped below one step`);
  }
  for (const w of [7.5, 10, 12.5]) {
    const p = Engine.progression({ weight: w, reps: [7, 7, 7] }, range, 2.5, 3, 3);
    assert.ok(p.weight < w, `deload from ${w} kg suggested ${p.weight}, not a reduction`);
  }
});

/* ---------- bodyweight rep targets ---------- */

test('below the top of the window, the target is one rep past the weakest set', () => {
  const range = { lo: 6, hi: 8 };
  let t = Engine.repTarget({ reps: [7, 6, 8] }, range, 3);
  assert.deepStrictEqual(t, { reason: 'add-rep', target: 7 });
  // never target past the top of the window
  t = Engine.repTarget({ reps: [8] }, range, 3);
  assert.deepStrictEqual(t, { reason: 'add-rep', target: 8 }, 'incomplete session still gets a rep goal');
});

test('topping the window on every prescribed set means the movement is outgrown', () => {
  const range = { lo: 6, hi: 8 };
  assert.deepStrictEqual(Engine.repTarget({ reps: [8, 8, 8] }, range, 3), { reason: 'top-out' });
  // one short set is not a top-out
  assert.strictEqual(Engine.repTarget({ reps: [8, 8, 7] }, range, 3).reason, 'add-rep');
});

test('repTarget refuses junk', () => {
  const range = { lo: 6, hi: 8 };
  assert.strictEqual(Engine.repTarget(null, range, 3), null);
  assert.strictEqual(Engine.repTarget({ reps: [] }, range, 3), null);
  assert.strictEqual(Engine.repTarget({ reps: [8, 8] }, null, 3), null);
});

test('harder pointers reference real, unloaded movements in the same category', () => {
  const PRIMARY = ['push', 'pull', 'legs'];
  const cat = ex => new Set(ex.slots.map(s => SLOT_CATEGORY[s]).filter(c => PRIMARY.includes(c)));
  const tagged = EXERCISES.filter(e => e.harder);
  assert.ok(tagged.length >= 4, 'suspiciously few harder pointers: ' + tagged.length);
  for (const e of tagged) {
    const h = EXERCISES.find(x => x.id === e.harder);
    assert.ok(h, e.id + ' points at unknown harder variation ' + e.harder);
    assert.notStrictEqual(h.id, e.id, e.id + ' points at itself');
    assert.strictEqual(e.load, false, e.id + ' is loaded; progression should add weight, not variations');
    const a = [...cat(e)], b = [...cat(h)];
    if (a.length && b.length) {
      assert.deepStrictEqual(b, a, e.id + ' escalates into a different muscle category');
    }
    // the chain must terminate
    let cur = h, hops = 0;
    while (cur && cur.harder && hops++ < 10) cur = EXERCISES.find(x => x.id === cur.harder);
    assert.ok(hops < 10, 'harder chain from ' + e.id + ' does not terminate');
  }
});

/* ---------- stale history ---------- */

test('fresh history passes through staleAdjust untouched', () => {
  const prog = { weight: 160, advance: true, reason: 'hit-top', reps: [8, 8, 8] };
  assert.deepStrictEqual(Engine.staleAdjust(prog, Engine.STALE_DAYS, 5), prog);
  assert.deepStrictEqual(Engine.staleAdjust(prog, 3, 5), prog);
  assert.strictEqual(Engine.staleAdjust(null, 60, 5), null);
});

test('a month-old session repeats its load instead of advancing', () => {
  const prog = { weight: 160, advance: true, reason: 'hit-top', reps: [8, 8, 8] };
  const adj = Engine.staleAdjust(prog, Engine.STALE_DAYS + 1, 5);
  assert.strictEqual(adj.advance, false);
  assert.strictEqual(adj.reason, 'stale');
  assert.strictEqual(adj.weight, 155, 'should undo the advance back to the last real load');
});

test('a two-month-old session knocks the load down a notch', () => {
  const prog = { weight: 155, advance: false, reason: 'hold', reps: [7, 7, 7] };
  const adj = Engine.staleAdjust(prog, Engine.STALE_DAYS * 2 + 1, 5);
  assert.strictEqual(adj.reason, 'stale');
  assert.strictEqual(adj.weight, 140, '155 after a long layoff should restart around 140');
});

test('bodyweight progressions have no load for staleness to touch', () => {
  const prog = { weight: null, advance: false, reason: 'bodyweight', reps: [8, 8] };
  assert.deepStrictEqual(Engine.staleAdjust(prog, 90, 5), prog);
});

/* ---------- starting weights from maxes ---------- */

test('a recorded max seeds a conservative starting weight for a new lift', () => {
  const range = { lo: 6, hi: 8 };
  // 225x3 -> e1RM 248 -> repeatable for 8 ≈ 195.8 -> floor to plate math
  assert.strictEqual(Engine.startingWeight({ weight: 225, reps: 3 }, range, 'lb'), 195);
  // kg rounds down on the 2.5 grid
  assert.strictEqual(Engine.startingWeight({ weight: 100, reps: 5 }, range, 'kg'), 90);
  // a cable lift rounds down on its coarser stack
  assert.strictEqual(
    Engine.startingWeight({ weight: 225, reps: 3 }, range, 'lb', Engine.exerciseById('cable-row')),
    190);
});

test('startingWeight refuses to guess without usable inputs', () => {
  const range = { lo: 6, hi: 8 };
  assert.strictEqual(Engine.startingWeight(null, range, 'lb'), null);
  assert.strictEqual(Engine.startingWeight({ weight: 225, reps: 3 }, null, 'lb'), null);
  assert.strictEqual(Engine.startingWeight({ weight: 225, reps: 13 }, range, 'lb'), null,
    'a max above 12 reps has no reliable e1RM to seed from');
  assert.strictEqual(Engine.startingWeight({ weight: 'big', reps: 3 }, range, 'lb'), null);
  assert.strictEqual(Engine.startingWeight({ weight: 4, reps: 1 }, range, 'lb'), null,
    'a seed below one plate step is not a suggestion');
});

/* ---------- maxes ---------- */

test('applicable lifts are loaded compounds only', () => {
  const lifts = Engine.maxableLifts();
  assert.ok(lifts.length >= 15, 'suspiciously few applicable lifts: ' + lifts.length);
  for (const l of lifts) {
    assert.strictEqual(l.load, true, l.id + ' is not a loaded movement');
    assert.strictEqual(l.type, 'compound', l.id + ' is not a compound');
  }
  const ids = lifts.map(l => l.id);
  for (const excluded of ['db-curl', 'db-lateral', 'db-calf', 'bw-calf', 'plank']) {
    assert.ok(!ids.includes(excluded), excluded + ' should not be an applicable lift');
  }
  for (const expected of ['bb-bench', 'bb-squat', 'bb-ohp', 'bb-row', 'bb-rdl']) {
    assert.ok(ids.includes(expected), expected + ' should be an applicable lift');
  }
});

test('Epley estimate matches the formula and is suppressed where it is unreliable', () => {
  assert.strictEqual(Engine.e1rm(225, 1), 225, 'a single is its own max');
  assert.strictEqual(Engine.e1rm(225, 3), 248);   // 225 * 1.1 = 247.5 -> 248
  assert.strictEqual(Engine.e1rm(185, 5), 216);   // 185 * (7/6)  = 215.83 -> 216
  assert.strictEqual(Engine.e1rm(100, 12), 140);  // boundary, still reported
  assert.strictEqual(Engine.e1rm(100, 13), null, 'should refuse above 12 reps');
  assert.strictEqual(Engine.e1rm(0, 5), null);
  assert.strictEqual(Engine.e1rm(225, 0), null);
  assert.strictEqual(Engine.e1rm('bad', 5), null);
  assert.strictEqual(Engine.e1rm(225, -1), null);
});

test('e1rm never reports less than the weight actually lifted', () => {
  for (let w = 45; w <= 500; w += 45) {
    for (let r = 1; r <= 12; r++) {
      assert.ok(Engine.e1rm(w, r) >= w, `e1rm(${w},${r}) came out below the load`);
    }
  }
});

test('exerciseById finds real ids and refuses invented ones', () => {
  assert.strictEqual(Engine.exerciseById('bb-bench').name, 'Barbell Bench Press');
  assert.strictEqual(Engine.exerciseById('does-not-exist'), null);
});
