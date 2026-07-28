/* Exercise library.
   Equipment codes:
     bw     bodyweight / floor space
     db     dumbbells or kettlebell
     kb     kettlebell specifically (swings, etc.)
     bar    barbell + squat/bench rack
     bench  flat bench
     cable  single adjustable cable
     cardio treadmill / bike / rower / outdoors

   An exercise is eligible only if EVERY code in `equip` is switched on
   in settings. Slots drive placement inside a workout.
*/

const EXERCISES = [
  /* ---------- PUSH ---------- */
  { id: 'bb-bench',      name: 'Barbell Bench Press',        slots: ['push_main'],                  equip: ['bar', 'bench'], type: 'compound',  load: true,  cue: 'Shoulder blades pinned, bar to lower chest.' },
  { id: 'db-bench',      name: 'Dumbbell Bench Press',       slots: ['push_main', 'push_second'],   equip: ['db', 'bench'],  type: 'compound',  load: true,  cue: 'Wrists stacked over elbows, full stretch at the bottom.' },
  { id: 'db-incline',    name: 'Incline Dumbbell Press',     slots: ['push_main', 'push_second'],   equip: ['db', 'bench'],  type: 'compound',  load: true,  cue: '30° incline. Drive the bells together at the top.' },
  { id: 'bb-ohp',        name: 'Barbell Overhead Press',     slots: ['push_main', 'push_second'],   equip: ['bar'],          type: 'compound',  load: true,  cue: 'Squeeze glutes, ribs down, head through at lockout.' },
  { id: 'db-ohp',        name: 'Dumbbell Shoulder Press',    slots: ['push_main', 'push_second'],   equip: ['db'],           type: 'compound',  load: true,  cue: 'Seated or standing. No lower-back arch.' },
  { id: 'db-floor',      name: 'Dumbbell Floor Press',       slots: ['push_main', 'push_second'],   equip: ['db'],           type: 'compound',  load: true,  cue: 'No bench needed. Triceps touch the floor, then drive.' },
  { id: 'pushup',        name: 'Push-Up',                    slots: ['push_main', 'push_second', 'fb_push'], equip: ['bw'], type: 'compound',  load: false, cue: 'Straight line ears to heels. Elbows ~45°.' },
  { id: 'pushup-deficit',name: 'Deficit Push-Up',            slots: ['push_second', 'push_acc'],    equip: ['bw', 'db'],     type: 'accessory', load: false, cue: 'Hands on the dumbbells, chest sinks below them.' },
  { id: 'pike-pushup',   name: 'Pike Push-Up',               slots: ['push_second', 'push_acc'],    equip: ['bw'],           type: 'accessory', load: false, cue: 'Hips high, crown of head to the floor.' },
  { id: 'bench-dip',     name: 'Bench Dip',                  slots: ['push_acc', 'triceps'],        equip: ['bw', 'bench'],  type: 'accessory', load: false, cue: 'Elbows back, not flared. Stop at 90°.' },
  { id: 'decline-pushup',name: 'Decline Push-Up',            slots: ['push_second', 'push_acc'],    equip: ['bw'],           type: 'compound',  load: false, cue: 'Feet up on a chair or step. Hits the upper chest.' },
  { id: 'diamond-pushup',name: 'Diamond Push-Up',            slots: ['triceps', 'push_acc'],        equip: ['bw'],           type: 'accessory', load: false, cue: 'Index fingers and thumbs touching. Elbows brush the ribs.' },
  { id: 'cable-fly',     name: 'Cable Chest Fly',            slots: ['push_acc'],                   equip: ['cable'],        type: 'accessory', load: true,  cue: 'Soft elbows, one arm at a time if single cable.' },
  { id: 'db-lateral',    name: 'Dumbbell Lateral Raise',     slots: ['push_acc'],                   equip: ['db'],           type: 'iso',       load: true,  cue: 'Lead with the elbows. Light weight, no swing.' },
  { id: 'db-front',      name: 'Dumbbell Front Raise',       slots: ['push_acc'],                   equip: ['db'],           type: 'iso',       load: true,  cue: 'Thumbs up, stop at eye level.' },
  { id: 'cable-lateral', name: 'Cable Lateral Raise',        slots: ['push_acc'],                   equip: ['cable'],        type: 'iso',       load: true,  cue: 'Cable at the low pin, one arm at a time.' },
  { id: 'cgbp',          name: 'Close-Grip Bench Press',     slots: ['push_second', 'triceps'],     equip: ['bar', 'bench'], type: 'compound',  load: true,  cue: 'Hands shoulder-width. Elbows tucked tight.' },
  { id: 'cable-pushdown',name: 'Cable Tricep Pushdown',      slots: ['triceps'],                    equip: ['cable'],        type: 'iso',       load: true,  cue: 'Upper arms glued to your sides.' },
  { id: 'db-skull',      name: 'Dumbbell Skullcrusher',      slots: ['triceps'],                    equip: ['db', 'bench'],  type: 'iso',       load: true,  cue: 'Lower to the ears, elbows stay pointed up.' },
  { id: 'db-oh-tri',     name: 'Overhead Dumbbell Extension',slots: ['triceps'],                    equip: ['db'],           type: 'iso',       load: true,  cue: 'One bell, both hands. Full stretch behind the head.' },

  /* ---------- PULL ---------- */
  { id: 'bb-row',        name: 'Bent-Over Barbell Row',      slots: ['pull_horiz'],                 equip: ['bar'],          type: 'compound',  load: true,  cue: 'Torso ~45°, pull to the belly button.' },
  { id: 'db-row',        name: 'One-Arm Dumbbell Row',       slots: ['pull_horiz', 'fb_pull'],      equip: ['db', 'bench'],  type: 'compound',  load: true,  cue: 'Flat back, drive the elbow past your ribs.' },
  { id: 'cable-row',     name: 'Cable Row',                  slots: ['pull_horiz', 'fb_pull'],      equip: ['cable'],        type: 'compound',  load: true,  cue: 'Chest tall, squeeze the shoulder blades at the end.' },
  { id: 'inverted-row',  name: 'Inverted Row',               slots: ['pull_horiz', 'fb_pull'],      equip: ['bar'],          type: 'compound',  load: false, cue: 'Bar set low in the rack. Body rigid, chest to bar.' },
  { id: 'pullup',        name: 'Pull-Up',                    slots: ['pull_vert', 'fb_pull'],       equip: ['bar'],          type: 'compound',  load: false, cue: 'Rack pull-up bar. Chin over, controlled down.' },
  { id: 'chinup',        name: 'Chin-Up',                    slots: ['pull_vert', 'biceps'],        equip: ['bar'],          type: 'compound',  load: false, cue: 'Underhand grip. Slow 3-count lowering.' },
  { id: 'cable-pulldown',name: 'Cable Lat Pulldown',         slots: ['pull_vert', 'fb_pull'],       equip: ['cable'],        type: 'compound',  load: true,  cue: 'Cable high, kneel if needed. Elbows to hips.' },
  { id: 'cable-pullover',name: 'Cable Straight-Arm Pullover',slots: ['pull_vert', 'pull_acc'],      equip: ['cable'],        type: 'accessory', load: true,  cue: 'Arms locked long, feel it in the lats not triceps.' },
  { id: 'cable-facepull',name: 'Cable Face Pull',            slots: ['pull_acc'],                   equip: ['cable'],        type: 'accessory', load: true,  cue: 'Cable at eye height. Pull to the forehead, thumbs back.' },
  { id: 'db-rear-fly',   name: 'Dumbbell Rear Delt Fly',     slots: ['pull_acc'],                   equip: ['db'],           type: 'iso',       load: true,  cue: 'Hinge forward, light bells, pinkies up.' },
  { id: 'db-shrug',      name: 'Dumbbell Shrug',             slots: ['pull_acc'],                   equip: ['db'],           type: 'iso',       load: true,  cue: 'Straight up, one-second squeeze at the top.' },
  { id: 'kb-high-pull',  name: 'Kettlebell High Pull',       slots: ['pull_acc'],                   equip: ['db'],           type: 'accessory', load: true,  cue: 'Hips snap first, the arm just follows.' },
  { id: 'table-row',     name: 'Table Row',                  slots: ['pull_horiz', 'fb_pull'],      equip: ['bw'],           type: 'accessory', load: false, cue: 'Under a sturdy table, heels out. Chest to the edge.' },
  { id: 'superman',      name: 'Superman Hold',              slots: ['pull_acc', 'core'],           equip: ['bw'],           type: 'core',      load: false, cue: 'Lift chest and thighs, reach long. Do not crank the neck.' },
  { id: 'prone-ytw',     name: 'Prone Y-T-W Raise',          slots: ['pull_acc'],                   equip: ['bw'],           type: 'iso',       load: false, cue: 'Face down, thumbs up. 8 reps in each letter position.' },
  { id: 'db-curl',       name: 'Dumbbell Curl',              slots: ['biceps'],                     equip: ['db'],           type: 'iso',       load: true,  cue: 'No elbow drift. Squeeze at the top.' },
  { id: 'db-hammer',     name: 'Hammer Curl',                slots: ['biceps'],                     equip: ['db'],           type: 'iso',       load: true,  cue: 'Neutral grip, brachialis does the work.' },
  { id: 'bb-curl',       name: 'Barbell Curl',               slots: ['biceps'],                     equip: ['bar'],          type: 'iso',       load: true,  cue: 'Strict. If your knees move, it is too heavy.' },
  { id: 'cable-curl',    name: 'Cable Curl',                 slots: ['biceps'],                     equip: ['cable'],        type: 'iso',       load: true,  cue: 'Constant tension. Never let the stack rest.' },

  /* ---------- LEGS ---------- */
  { id: 'bb-squat',      name: 'Back Squat',                 slots: ['squat', 'fb_lower'],          equip: ['bar'],          type: 'compound',  load: true,  cue: 'Brace hard, knees track over the toes, hit depth.' },
  { id: 'bb-front-squat',name: 'Front Squat',                slots: ['squat'],                      equip: ['bar'],          type: 'compound',  load: true,  cue: 'Elbows high, upright torso.' },
  { id: 'goblet-squat',  name: 'Goblet Squat',               slots: ['squat', 'fb_lower'],          equip: ['db'],           type: 'compound',  load: true,  cue: 'Bell at the chest, elbows inside the knees at the bottom.' },
  { id: 'bw-squat',      name: 'Bodyweight Squat',           slots: ['squat', 'fb_lower'],          equip: ['bw'],           type: 'accessory', load: false, cue: 'Slow 3 seconds down, explode up.' },
  { id: 'bb-rdl',        name: 'Barbell Romanian Deadlift',  slots: ['hinge', 'fb_lower'],          equip: ['bar'],          type: 'compound',  load: true,  cue: 'Push the hips back, bar shaves the thighs.' },
  { id: 'db-rdl',        name: 'Dumbbell Romanian Deadlift', slots: ['hinge', 'fb_lower'],          equip: ['db'],           type: 'compound',  load: true,  cue: 'Flat back. Stop when the hamstrings say stop.' },
  { id: 'kb-swing',      name: 'Kettlebell Swing',           slots: ['hinge', 'fb_lower', 'cardio'],equip: ['db'],           type: 'compound',  load: true,  cue: 'Hip snap, not a squat. Bell floats to chest height.' },
  { id: 'hip-thrust',    name: 'Barbell Hip Thrust',         slots: ['hinge'],                      equip: ['bar', 'bench'], type: 'compound',  load: true,  cue: 'Chin tucked, ribs down, full lockout squeeze.' },
  { id: 'cable-pullthru',name: 'Cable Pull-Through',         slots: ['hinge'],                      equip: ['cable'],        type: 'accessory', load: true,  cue: 'Face away, hinge back, snap the hips forward.' },
  { id: 'bulgarian',     name: 'Bulgarian Split Squat',      slots: ['unilateral'],                 equip: ['db', 'bench'],  type: 'compound',  load: true,  cue: 'Back foot on the bench, front shin near vertical.' },
  { id: 'walking-lunge', name: 'Walking Lunge',              slots: ['unilateral', 'fb_lower'],     equip: ['db'],           type: 'compound',  load: true,  cue: 'Long steps, back knee kisses the floor.' },
  { id: 'reverse-lunge', name: 'Reverse Lunge',              slots: ['unilateral'],                 equip: ['bw'],           type: 'accessory', load: false, cue: 'Step back, drop straight down, drive through the front heel.' },
  { id: 'sl-rdl',        name: 'Single-Leg RDL',             slots: ['hinge', 'unilateral'],        equip: ['bw'],           type: 'accessory', load: false, cue: 'Hips square, free leg straight back. Slow and balanced.' },
  { id: 'sl-bridge',     name: 'Single-Leg Glute Bridge',    slots: ['hinge', 'fb_lower'],          equip: ['bw'],           type: 'accessory', load: false, cue: 'One foot planted, other knee hugged in. Full lockout.' },
  { id: 'step-up',       name: 'Dumbbell Step-Up',           slots: ['unilateral'],                 equip: ['db', 'bench'],  type: 'compound',  load: true,  cue: 'No push off the back foot. All front leg.' },
  { id: 'db-calf',       name: 'Dumbbell Calf Raise',        slots: ['calves'],                     equip: ['db'],           type: 'iso',       load: true,  cue: 'Pause two seconds at the top and the bottom.' },
  { id: 'bw-calf',       name: 'Single-Leg Calf Raise',      slots: ['calves'],                     equip: ['bw'],           type: 'iso',       load: false, cue: 'Off a step if you have one. Full range.' },

  /* ---------- CORE ---------- */
  { id: 'plank',         name: 'Plank',                      slots: ['core'],                       equip: ['bw'],           type: 'core',      load: false, cue: 'Squeeze glutes, tuck the ribs. Do not sag.' },
  { id: 'side-plank',    name: 'Side Plank',                 slots: ['core'],                       equip: ['bw'],           type: 'core',      load: false, cue: 'Each side. Stack the hips, push the floor away.' },
  { id: 'hollow-hold',   name: 'Hollow Body Hold',           slots: ['core'],                       equip: ['bw'],           type: 'core',      load: false, cue: 'Low back glued to the floor. Lower legs to regress.' },
  { id: 'dead-bug',      name: 'Dead Bug',                   slots: ['core'],                       equip: ['bw'],           type: 'core',      load: false, cue: 'Slow. Opposite arm and leg, ribs stay down.' },
  { id: 'bird-dog',      name: 'Bird Dog',                   slots: ['core'],                       equip: ['bw'],           type: 'core',      load: false, cue: 'Pause 2s at full extension. No hip rotation.' },
  { id: 'hanging-raise', name: 'Hanging Knee Raise',         slots: ['core'],                       equip: ['bar'],          type: 'core',      load: false, cue: 'No swing. Curl the pelvis up at the top.' },
  { id: 'russian-twist', name: 'Russian Twist',              slots: ['core'],                       equip: ['db'],           type: 'core',      load: true,  cue: 'Chest tall, rotate through the ribs not the arms.' },
  { id: 'weighted-situp',name: 'Weighted Sit-Up',            slots: ['core'],                       equip: ['db'],           type: 'core',      load: true,  cue: 'Bell on the chest, controlled all the way down.' },
  { id: 'pallof',        name: 'Cable Pallof Press',         slots: ['core'],                       equip: ['cable'],        type: 'core',      load: true,  cue: 'Resist the rotation. Press straight out, hold 2s.' },
  { id: 'woodchop',      name: 'Cable Woodchop',             slots: ['core'],                       equip: ['cable'],        type: 'core',      load: true,  cue: 'High to low. Pivot the back foot, rotate the torso.' },
  { id: 'farmer-carry',  name: 'Farmer Carry',               slots: ['core', 'carry'],              equip: ['db'],           type: 'core',      load: true,  cue: 'Heavy. Tall posture, short quick steps.' },
  { id: 'suitcase-carry',name: 'Suitcase Carry',             slots: ['carry'],                      equip: ['db'],           type: 'core',      load: true,  cue: 'One side only, then switch. Do not lean.' },

  /* ---------- CONDITIONING (used as main work on cardio days) ---------- */
  { id: 'burpee',        name: 'Burpee Intervals',           slots: ['cardio'],                     equip: ['bw'],           type: 'interval',  load: false, cue: 'Chest to floor, full stand at the top. Hard effort each round.' },
  { id: 'mtn-climber',   name: 'Mountain Climbers',          slots: ['cardio'],                     equip: ['bw'],           type: 'interval',  load: false, cue: 'Hips low, fast knees, shoulders over the wrists.' },
  { id: 'high-knees',    name: 'High Knees',                 slots: ['cardio'],                     equip: ['bw'],           type: 'interval',  load: false, cue: 'Knees above hip height, stay on the balls of the feet.' },
  { id: 'jump-squat',    name: 'Jump Squat',                 slots: ['cardio'],                     equip: ['bw'],           type: 'interval',  load: false, cue: 'Land soft, absorb into the next rep.' },
  { id: 'shuttle',       name: 'Shuttle Runs',               slots: ['cardio'],                     equip: ['bw'],           type: 'interval',  load: false, cue: 'Touch the floor at each turn. Accelerate out of it.' },
  { id: 'machine-int',   name: 'Machine Intervals',          slots: ['cardio'],                     equip: ['cardio'],       type: 'cardio',    load: false, cue: 'Treadmill, bike, or rower. Hard effort, then easy.' },
  { id: 'machine-steady',name: 'Steady-State Cardio',        slots: ['cardio'],                     equip: ['cardio'],       type: 'cardio',    load: false, cue: 'Conversational pace. You should be able to talk.' },

  /* ---------- MOBILITY / RECOVERY ----------
     Anything that can appear in a warm-up carries a `bias` — upper, lower, or
     full — so the warm-up can lean toward the day being trained. */
  { id: 'wgs',           name: "World's Greatest Stretch",   slots: ['mobility', 'warmup'],         equip: ['bw'],           type: 'mobility',  load: false, bias: 'full',  cue: 'Lunge, elbow to instep, rotate and reach up.' },
  { id: 'cat-cow',       name: 'Cat-Cow',                    slots: ['mobility', 'warmup'],         equip: ['bw'],           type: 'mobility',  load: false, bias: 'full',  cue: 'Move one vertebra at a time. Breathe with it.' },
  { id: '90-90',         name: '90/90 Hip Switch',           slots: ['mobility'],                   equip: ['bw'],           type: 'mobility',  load: false, cue: 'Sit tall, rotate knee to knee without using hands.' },
  { id: 'couch-stretch', name: 'Couch Stretch',              slots: ['mobility'],                   equip: ['bw'],           type: 'mobility',  load: false, cue: 'Rear foot up a wall or bench. Squeeze that glute.' },
  { id: 'thoracic-rot',  name: 'Thoracic Rotation',          slots: ['mobility', 'warmup'],         equip: ['bw'],           type: 'mobility',  load: false, bias: 'upper', cue: 'Side-lying, open the top arm, follow it with your eyes.' },
  { id: 'pigeon',        name: 'Pigeon Stretch',             slots: ['mobility'],                   equip: ['bw'],           type: 'mobility',  load: false, cue: 'Front shin angled, hips square, sink slowly.' },
  { id: 'hamstring-str', name: 'Standing Hamstring Stretch', slots: ['mobility'],                   equip: ['bw'],           type: 'mobility',  load: false, cue: 'Hinge, flat back. Never round to reach further.' },
  { id: 'shoulder-dis',  name: 'Barbell Shoulder Dislocates',slots: ['mobility', 'warmup'],         equip: ['bar'],          type: 'mobility',  load: false, bias: 'upper', cue: 'Empty bar, wide grip. Slow arc overhead and back.' },
  { id: 'deep-squat-hold',name: 'Deep Squat Hold',           slots: ['mobility'],                   equip: ['bw'],           type: 'mobility',  load: false, cue: 'Sit in the bottom, elbows pry the knees open.' },
  { id: 'easy-walk',     name: 'Easy Walk or Spin',          slots: ['mobility'],                   equip: ['cardio'],       type: 'cardio',    load: false, cue: 'Nose breathing only. This is recovery, not training.' },

  /* ---------- WARM-UP ONLY ---------- */
  { id: 'arm-circles',   name: 'Arm Circles',                slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'upper', cue: 'Small to large, both directions.' },
  { id: 'leg-swings',    name: 'Leg Swings',                 slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'lower', cue: 'Front-to-back then side-to-side. Hold something.' },
  { id: 'inchworm',      name: 'Inchworm',                   slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'full',  cue: 'Walk the hands out to a plank, walk the feet in.' },
  { id: 'glute-bridge',  name: 'Glute Bridge',               slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'lower', cue: 'Wake the glutes up. Squeeze hard at the top.' },
  { id: 'jumping-jack',  name: 'Jumping Jacks',              slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'full',  cue: 'Just raising the heart rate. Stay light.' },
  { id: 'hip-circles',   name: 'Hip Circles',                slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'lower', cue: 'Hands on hips, big slow circles each way.' },
  { id: 'ankle-rock',    name: 'Ankle Rockers',              slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'lower', cue: 'Knee past the toes, heel stays down.' },
  { id: 'scap-pushup',   name: 'Scapular Push-Up',           slots: ['warmup'],                     equip: ['bw'],           type: 'mobility',  load: false, bias: 'upper', cue: 'Arms locked. Only the shoulder blades move.' },
  { id: 'light-cardio',  name: '3 min Easy Cardio',          slots: ['warmup'],                     equip: ['cardio'],       type: 'mobility',  load: false, bias: 'full',  cue: 'Bike, row, or brisk treadmill walk to get warm.' },
];

/* Conditioning finishers. `equip` filters the same way. `stress` names the
   region a finisher hammers hardest, so the engine can steer it away from the
   day that already trained that region — no swing ladder straight after RDLs. */
const FINISHERS = [
  { id: 'f-emom',    name: 'EMOM 8',            equip: ['bw'],     stress: 'mixed',  detail: 'Every minute on the minute for 8 minutes: 10 burpees. Rest whatever is left of the minute.' },
  { id: 'f-tabata',  name: 'Tabata Intervals',  equip: ['bw'],     stress: 'lower',  detail: '20 seconds all out, 10 seconds rest, 8 rounds. Alternate jump squats and mountain climbers.' },
  { id: 'f-ladder',  name: 'Descending Ladder', equip: ['bw'],     stress: 'upper',  detail: '10-8-6-4-2 of push-ups and air squats. No rest until it is done.' },
  { id: 'f-swings',  name: 'Swing Ladder',      equip: ['db'],     stress: 'lower',  detail: 'Kettlebell swings: 10-15-20-15-10. Rest 30 seconds between sets.' },
  { id: 'f-carry',   name: 'Loaded Carry',      equip: ['db'],     stress: 'mixed',  detail: '4 rounds: 40 seconds heavy farmer carry, 40 seconds rest. Go heavy enough that grip is the limiter.' },
  { id: 'f-intervals',name:'Cardio Intervals',  equip: ['cardio'], stress: 'cardio', detail: '6 rounds: 30 seconds hard, 90 seconds easy. Treadmill, bike, or rower.' },
  { id: 'f-steady',  name: 'Steady Finish',     equip: ['cardio'], stress: 'cardio', detail: '8 minutes at a conversational pace. Cool the system down, do not race it.' },
  { id: 'f-amrap',   name: 'AMRAP 6',           equip: ['bw'],     stress: 'upper',  detail: 'As many rounds as possible in 6 minutes: 5 push-ups, 10 air squats, 15 mountain climbers.' },
  { id: 'f-core',    name: 'Core Triset',       equip: ['bw'],     stress: 'core',   detail: '3 rounds, no rest inside a round: 30s plank, 20 dead bugs, 30s hollow hold. Rest 45s between rounds.' },
];

/* Day rotation. `slots` are filled in order from the library above. */
const FOCI = {
  push:    { label: 'Push',          blurb: 'Chest, shoulders, triceps',   slots: ['push_main', 'push_second', 'push_acc', 'triceps'],           extra: ['push_acc', 'core'],       finisher: true  },
  pull:    { label: 'Pull',          blurb: 'Back, rear delts, biceps',    slots: ['pull_horiz', 'pull_vert', 'pull_acc', 'biceps'],             extra: ['pull_acc', 'core'],       finisher: true  },
  legs:    { label: 'Legs',          blurb: 'Squat, hinge, single leg',    slots: ['squat', 'hinge', 'unilateral', 'calves'],                    extra: ['unilateral', 'core'],     finisher: true  },
  engine:  { label: 'Engine + Core', blurb: 'Conditioning and midsection', slots: ['cardio', 'core', 'core', 'carry'],                           extra: ['cardio', 'core'],         finisher: true  },
  full:    { label: 'Full Body',     blurb: 'One of everything, moving',   slots: ['fb_lower', 'fb_push', 'fb_pull', 'core'],                    extra: ['fb_lower', 'cardio'],     finisher: true  },
  recover: { label: 'Recovery',      blurb: 'Mobility and easy movement',  slots: ['mobility', 'mobility', 'mobility', 'mobility', 'mobility'],  extra: ['mobility'],               finisher: false },
};

/* One full cycle per calendar week. Each pattern gets its direct day plus the
   full-body touch (~2× per muscle per week), and recovery lands twice,
   breaking up the hard days. Period 7 also means a given focus falls on the
   same weekday every week. */
const FOCUS_ORDER = ['push', 'pull', 'legs', 'recover', 'full', 'engine', 'recover'];

/* Set and rep schemes by exercise type, scaled by session length.
   `cardio` is one continuous block on a machine; `interval` is repeated
   hard efforts of a bodyweight movement — never one long grinding set. */
const SCHEMES = {
  compound:  { short: { sets: 3, reps: '8'      }, standard: { sets: 3, reps: '6-8'   }, long: { sets: 4, reps: '5-8'   } },
  accessory: { short: { sets: 2, reps: '10-12'  }, standard: { sets: 3, reps: '10-12' }, long: { sets: 4, reps: '10-12' } },
  iso:       { short: { sets: 2, reps: '12-15'  }, standard: { sets: 3, reps: '12-15' }, long: { sets: 3, reps: '12-15' } },
  core:      { short: { sets: 2, reps: '30 sec' }, standard: { sets: 3, reps: '40 sec'}, long: { sets: 4, reps: '45 sec'} },
  interval:  { short: { sets: 3, reps: '30 sec' }, standard: { sets: 4, reps: '40 sec'}, long: { sets: 5, reps: '45 sec'} },
  cardio:    { short: { sets: 1, reps: '6 min'  }, standard: { sets: 1, reps: '10 min'}, long: { sets: 1, reps: '15 min'} },
  mobility:  { short: { sets: 1, reps: '45 sec' }, standard: { sets: 2, reps: '45 sec'}, long: { sets: 2, reps: '60 sec'} },
};

/* Rest between sets, in seconds. */
const REST = { compound: 100, accessory: 70, iso: 50, core: 40, interval: 40, cardio: 60, mobility: 20 };

/* Publish the library for both the browser and Node (used by the tests).
   Top-level `const` in a classic script does not become a property of the
   global object, so this has to be explicit. */
const LIBRARY = { EXERCISES, FINISHERS, FOCI, FOCUS_ORDER, SCHEMES, REST };
if (typeof module === 'object' && module.exports) module.exports = LIBRARY;
else if (typeof self !== 'undefined') self.LIBRARY = LIBRARY;
