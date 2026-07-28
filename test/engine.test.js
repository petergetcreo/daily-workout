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
  full:       { bw: 1, db: 1, bar: 1, bench: 1, cable: 1, cardio: 1 },
  bodyweight: { bw: 1, db: 0, bar: 0, bench: 0, cable: 0, cardio: 0 },
  hotel:      { bw: 1, db: 0, bar: 0, bench: 0, cable: 0, cardio: 1 },
  dumbbells:  { bw: 1, db: 1, bar: 0, bench: 0, cable: 0, cardio: 0 },
  garage:     { bw: 1, db: 1, bar: 1, bench: 1, cable: 1, cardio: 0 }, // Peter's setup
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

/* ---------- rotation ---------- */

test('rotation cycles through every focus in order', () => {
  const keys = datesFrom('2026-01-01', FOCUS_ORDER.length * 3);
  const seen = keys.map(k => Engine.focusForDate(k));
  // the sequence must repeat with the rotation's period
  for (let i = FOCUS_ORDER.length; i < seen.length; i++) {
    assert.strictEqual(seen[i], seen[i - FOCUS_ORDER.length],
      'rotation is not periodic at ' + keys[i]);
  }
  assert.strictEqual(new Set(seen).size, FOCUS_ORDER.length, 'not every focus appears');
});

test('a 30-day stretch is evenly spread across focuses', () => {
  const counts = {};
  for (const k of datesFrom('2026-03-01', 30)) {
    const f = Engine.focusForDate(k);
    counts[f] = (counts[f] || 0) + 1;
  }
  assert.strictEqual(Object.keys(counts).length, FOCUS_ORDER.length);
  for (const [f, n] of Object.entries(counts)) {
    assert.strictEqual(n, 5, f + ' appeared ' + n + ' times in 30 days, expected 5');
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
