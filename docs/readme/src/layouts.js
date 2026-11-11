// Evalbench in Glass. The app's real screens, in its dark theme for the dark scenes and its light theme for the
// light ones, as frosted-glass windows: copy flush left on the page colour, glass on the right, and one element
// lifted out of its screen. Positions are the apparent centre in CSS px (y down); sizes are apparent CSS px;
// z is depth (+ toward the viewer). Textures are capture.cjs's screenshots, `<screen>-dark.png` and
// `<screen>-light.png`, at 2x (desktop) and 3x (phone). A lifted element names its box (`box: 'say'`).

// Night: an ink-black tasting room, a little azure (the colour of a face-down card) low in the haze.
const NIGHT = {
  page: '#0d1117',
  env: { top: '#0c0d11', bot: '#060709', haze: '#1d2130', hazeStr: 0.10, ray: '#c4cbdb',
    shafts: [[0.50, 0.05, 0.04, 0.09], [0.70, 0.025, 0.02, 0.06], [0.88, 0.07, -0.04, 0.09], [0.72, 0.22, 0.0, 0.035]],
    glows: [[0.72, 1.1, 0.6, 0.07, '#c8c0aa'], [0.70, 0.30, 0.42, 0.07, '#2457f0']] },
  glass: { tint: [0.064, 0.066, 0.074], transmit: 0.80, fog: '#0c0d11', light: [-700, 800, 900], rim: 0.9, spec: 0.40, glow: 0.45, shadow: 0.30, levels: 5, caustic: 0 },
  motes: { n: 60, color: '#dfe6f5', amt: 0.45 },
  bloom: 0.36, bloomThresh: 0.6,
};
// Day: warm paper in a sunlit room, the app's own light theme.
const DAY = {
  page: '#ffffff',
  env: { top: '#f3f1ec', bot: '#f9f8f5', haze: '#ffffff', hazeStr: 0.04, shadeCol: '#eeece6', sun: [0.42, 0, -1.15, 1.0], dapple: 0.6, sunStr: 0.075, sunCol: '#fff3dc',
    shadow: 0.55, caustic: 0.10, shadowDir: [0.05, -0.075], glows: [] },
  glass: { tint: [0.076, 0.076, 0.076], transmit: 0.88, fog: '#f1f0eb', light: [-700, 800, 900], rim: 0.95, spec: 0.30, glow: 0.0, shadow: 0.12, levels: 5, caustic: 0 },
  motes: { n: 36, color: '#fffaf0', amt: 0.45 },
  bloom: 0.0, bloomThresh: 0.95,
};
const merge = (a, b) => { const o = { ...a }; for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? merge(a[k] || {}, b[k]) : b[k]; return o; };

const C = {
  kick: { night: { color: 'rgba(205,212,228,0.58)' }, day: { color: '#7d7a72' } },
  name: { night: { color: '#f5f6f9' }, day: { color: '#0e0f12' } },
  head: { night: { color: '#f5f6f9' }, day: { color: '#0e0f12' } },
  line: { night: { color: 'rgba(225,229,238,0.74)' }, day: { color: '#4b4d54' } },
  fact: { night: { color: '#eef1f6' }, day: { color: '#121318' } },
  big: { night: { color: '#f1f3f8' }, day: { color: '#121318' } },
  rule: { night: { background: 'rgba(205,215,235,0.16)' }, day: { background: 'rgba(20,24,40,0.12)' } },
};
const T = (cls, html, x, y, style = {}, align) => ({ cls, html, x, y, align, style, ...C[cls] });
const FACT = (v, l) => `<b>${v}</b><span>${l}</span>`;
const BG = (n) => n ? '#121110' : '#F3F0E8';     // the app's page colour in each theme, keyed away by the glass
const tx = (screen, n) => `${screen}-${n ? 'dark' : 'light'}.png`;
const LIFT = (n) => ({ key: 'auto', keyAmt: n ? 0.35 : 0.85, shadowOff: n ? [0, -16, 40] : [10, -22, 26], shadow: n ? 0.45 : 0.22, align: 0.9 });
const DESK = (n, screen, crop, pos, extra = {}) => ({ tex: tx(screen, n), crop, ...pos, key: BG(n), keyAmt: n ? 0.5 : 0.7, bezel: 10, ...extra });
const PHONE = (n, screen, crop, pos, extra = {}) => ({ tex: tx(screen, n), crop, ...pos, key: BG(n), keyAmt: n ? 0.45 : 0.6, bezel: 8, ...extra });

// Crops of the captures, in capture pixels. The home page is one long sheet, so three panels read three parts of it.
const CROP = {
  verdict: [0, 0, 2560, 1760], proof: [520, 1540, 1960, 1400], holds: [520, 5590, 1960, 1380],
  rate: [0, 880, 2560, 2000], suite: [0, 4790, 2560, 1900], compare: [0, 0, 2560, 2240], run: [0, 1290, 2560, 1700],
  phone: [0, 0, 1170, 2400],
};

function panel(o) {
  const DY = o.dy ?? -20, ty = (o.ty ?? 92) + DY, hl = o.headLines ?? 2;
  const headY = ty + 24, lineY = headY + hl * 38 + 18, ry = (o.ry ?? 318) + DY;
  return {
    css: [840, o.h || 420], fade: [36, 36, 30, 36], cam: [12, 5], pool: o.pool || [0.69, 0.52, 0.37, 0.66],
    night: merge(NIGHT, o.night || {}), day: merge(DAY, o.day || {}),
    windows: (n) => o.win(n, false).map((w) => (w.parent !== undefined ? w : { ...w, y: w.y + DY })),
    type: [
      T('kick', o.kick, 2, ty, { fontSize: '10.5px' }),
      T('head', o.head, 0, headY, { fontSize: '36px' }),
      T('line', o.line, 2, lineY, { fontSize: '15.5px', whiteSpace: 'normal', width: '286px' }),
      T('rule', '', 2, ry, { width: '300px' }),
      ...o.facts.map((fc, i) => T('fact', FACT(fc[0], fc[1]), 2 + i * 102, ry + 18, { width: '92px', whiteSpace: 'normal' })),
    ],
  };
}
function panelPhone(o) {
  const ry = o.ryp ?? 600;
  return {
    css: [381, o.hp || 730], dpr: 1080 / 381, fade: [18, 18, 24, 28], cam: [8, 4], pool: o.poolPhone || [0.5, 0.40, 0.70, 0.34],
    night: merge(NIGHT, o.night || {}), day: merge(DAY, o.day || {}),
    windows: (n) => o.win(n, true),
    type: [
      T('kick', o.kick, 4, 26, { fontSize: '9.5px' }),
      T('head', o.head, 2, 46, { fontSize: '31px', whiteSpace: 'normal', width: '372px' }),
      T('line', o.line, 4, 46 + (o.headLinesPhone ?? 2) * 33 + 14, { fontSize: '15px', whiteSpace: 'normal', width: '352px' }),
      T('rule', '', 4, ry, { width: '372px' }),
      ...o.facts.map((fc, i) => T('fact', FACT(fc[0], fc[1]), 4 + i * 124, ry + 18, { width: '112px', whiteSpace: 'normal' })),
    ],
  };
}

const one = (n, ph, screen, crop, box, child = {}, desk = { x: 566, y: 230, w: 392 }, phone = { x: 186, y: 384, w: 332 }) => [
  DESK(n, screen, crop, ph ? { z: -40, rot: [2, -8, 0], ...phone } : { z: -60, rot: [2, -16, 0], ...desk }, { breathe: [8, 0.0] }),
  { parent: 0, box, pad: [16, 12], lift: 64, breathe: [10, 0.25], bezel: 8, radius: 14, ...LIFT(n), glow: 0.2, ...child },
];
const VERDICT = {
  kick: 'The verdict', head: 'Set the bar,<br>get the answer',
  line: 'Say how good is good enough. Evalbench names the cheapest model that clears it, and says so when nothing does.',
  facts: [['22', 'of 24 right, for the pick'], ['$0.12', 'per 1,000 answers'], ['26×', 'the price of the most accurate']],
  win: (n, ph) => one(n, ph, 'verdict', CROP.verdict, 'chart', { pad: [10, 10], lift: 70 }, { x: 572, y: 228, w: 404 }, { x: 186, y: 380, w: 336 }),
};
const PROOF = {
  kick: 'The proof', head: 'See why it is<br>not the others',
  line: 'Every model sits above or below the bar with its accuracy, its cost and its speed, and the plain reason it lost.',
  facts: [['5', 'models on one sheet'], ['2', 'misses of the pick, by name'], ['74–98%', 'where its true pass rate lies']],
  win: (n, ph) => one(n, ph, 'verdict', CROP.proof, 'clears'),
};
const WRITE = {
  kick: 'Your job', head: 'Write down what<br>a good answer is',
  line: 'A job is real examples and the checks an answer must pass: the right label, a word limit, a phrase it must never say.',
  facts: [['7', 'kinds of check, up to Python tests'], ['152', 'checks in the triage job'], ['0', 'routes out of the code sandbox']],
  win: (n, ph) => one(n, ph, 'suite', CROP.suite, 'rule', { pad: [10, 10] }),
};
const JUDGE = {
  kick: 'Blind judging', head: 'Judge what checks<br>can’t count',
  line: 'Tone and judgement take a person. Two answers, names hidden, order shuffled: score them, pick a side, say why.',
  facts: [['7', 'stops on the preference scale'], ['0', 'model names on screen'], ['239', 'blind verdicts in the demo']],
  h: 440, ry: 330,
  win: (n, ph) => one(n, ph, 'rate', CROP.rate, 'verdict', { pad: [20, 16], lift: 80, glow: 0.25, glowColor: n ? '#4a1a14' : undefined }, { x: 584, y: 240, w: 404 }, { x: 188, y: 392, w: 340 }),
};
const HOLDS = {
  kick: 'Over time', head: 'Know when the<br>answer changes',
  line: 'The same rule runs over every past run and lists the examples each model gained or lost. In CI, one flag fails the build with no pick.',
  facts: [['3', 'runs in a row with the same pick'], ['4', 'examples that changed since last time'], ['1', 'flag to fail CI with no pick']],
  win: (n, ph) => one(n, ph, 'verdict', CROP.holds, 'since'),
};

// ---------- the hero ----------
const HERO_NIGHT = merge(NIGHT, { env: {
  shafts: [[0.30, 0.050, 0.05, 0.13], [0.42, 0.020, 0.02, 0.10], [0.58, 0.022, -0.02, 0.11], [0.71, 0.050, -0.05, 0.13], [0.50, 0.22, 0.0, 0.06]],
  glows: [[0.50, 0.32, 0.42, 0.10, '#2457f0'], [0.5, 1.15, 0.65, 0.09, '#c8c0aa'], [0.5, -0.15, 0.6, 0.05, '#3a4a78']] } });
const HERO_DAY = merge(DAY, { env: { sun: [0.10, 0, -0.80, 0.95] } });
// The hero is a loop. Its centre window plays a new run of the support triage job on the run page: capture.cjs
// photographs REPLAY.frames moments of it, the queued run first and the finished run last, and frame i between
// them is the first moment REPLAY.share(i / (frames - 1)) of the answers are in (slow, quicker, slow again).
const ease = (u) => u * u * (3 - 2 * u);
export const REPLAY = { frames: 38, share: (u) => u + (ease(u) - u) * 0.7 };
const replayFrames = (n) => Array.from({ length: REPLAY.frames }, (_, i) => `replay-${n ? 'dark' : 'light'}-${String(i).padStart(2, '0')}.png`);
// One turn of the loop, in frames at 12 a second. It opens on the finished state, the verdict with its headline
// lifted out, and holds it; the headline settles back into its page; the page turns to the new run, which plays
// one captured moment a frame and comes to rest on its scores; the page turns back and the headline lifts out again.
const HERO_LOOP = { hold: 24, settle: 6, turn: 6, run: REPLAY.frames - 1, rest: 7, back: 6, lift: 6, tail: 4 };
export const HERO_FRAMES = Object.values(HERO_LOOP).reduce((a, b) => a + b, 0);
function heroPlay(phase) {
  const T = HERO_LOOP, last = REPLAY.frames;       // sequence index 0 is the verdict, 1..last the run
  let f = Math.round((((phase % 1) + 1) % 1) * HERO_FRAMES * 1000) / 1000, u;
  const part = (n) => { u = (f + 1) / (n + 1); f -= n; return f < 0; };   // u: how far through this part the frame is
  if (part(T.hold)) return { from: 0, to: 0, mix: 0, lift: 1 };
  if (part(T.settle)) return { from: 0, to: 0, mix: 0, lift: 1 - ease(u) };
  if (part(T.turn)) return { from: 0, to: 1, mix: ease(u), lift: 0 };
  if (part(T.run)) return { from: 1 + Math.floor(f + T.run), to: 1, mix: 0, lift: 0 };
  // the finished page sits a little higher than the running one, so it fades in over two frames instead of jumping
  if (part(T.rest)) return { from: last - 1, to: last, mix: ease(Math.min(1, (f + T.rest + 1) / 3)), lift: 0 };
  if (part(T.back)) return { from: last, to: 0, mix: ease(u), lift: 0 };
  if (part(T.lift)) return { from: 0, to: 0, mix: 0, lift: ease(u) };
  return { from: 0, to: 0, mix: 0, lift: 1 };
}

const heroWindows = (n, P) => [
  DESK(n, 'rate', CROP.rate, {}, { fog: n ? 0.58 : 0.38, lod: 1.2, defocus: 2.5, breathe: [16, 0.15], bezel: 8 }),
  DESK(n, 'run', CROP.run, {}, { fog: n ? 0.58 : 0.38, lod: 1.2, defocus: 2.5, breathe: [12, 0.8], bezel: 8 }),
  DESK(n, 'compare', CROP.compare, {}, { lod: 0.4, defocus: 0.8, fog: n ? 0.18 : 0.10, breathe: [12, 0.5] }),
  DESK(n, 'suite', CROP.suite, {}, { lod: 0.4, defocus: 0.8, fog: n ? 0.18 : 0.10, breathe: [12, 0.0] }),
  DESK(n, 'verdict', CROP.verdict, {}, { breathe: [10, 0.6], bezel: 11, glow: 0.6, still: true, seq: [tx('verdict', n), ...replayFrames(n)] }),
  PHONE(n, 'm-rate', CROP.phone, {}, { breathe: [9, 0.3], still: true }),
  { parent: 4, box: 'say', pad: [24, 18], lift: 110, breathe: [12, 0.85], bezel: 8, radius: 14, ...LIFT(n), align: 0.6, glow: 0.25 },
].map((w, i) => ({ ...w, ...(P[i] || {}) }));

const NUMBERS = [['2,924', 'checks run in<br>the demo workspace'], ['7', 'kinds of<br>automatic check'], ['291', 'tests in CI'], ['0', 'API keys stored,<br>read from the environment']];

export const LAYOUTS = {
  hero: {
    css: [840, 560], fade: [40, 40, 30, 46], cam: [11, 4], motion: 0.75, pool: [0.5, 0.42, 0.62, 0.62], play: heroPlay, frames: HERO_FRAMES,
    night: HERO_NIGHT, day: HERO_DAY,
    windows: (n) => heroWindows(n, [
      { x: 104, y: 204, w: 116, z: -820, rot: [10, 18, 0] },
      { x: 738, y: 204, w: 112, z: -820, rot: [10, -18, 0] },
      { x: 128, y: 322, w: 200, z: -320, rot: [2, 32, 0] },
      { x: 716, y: 318, w: 206, z: -320, rot: [2, -32, 0] },
      { x: 404, y: 344, w: 380, z: 40, rot: [3, 0, 0] },
      { x: 646, y: 404, h: 236, z: 170, rot: [0, -14, 0] },
    ]),
    type: [
      T('name', 'Evalbench', 420, 34, { fontSize: '60px' }, 'center'),
      T('line', 'Which model should do your job? The cheapest one that clears your bar, with the proof.', 420, 110, { fontSize: '16.5px' }, 'center'),
    ],
  },
  'hero-phone': {
    css: [381, 640], dpr: 1080 / 381, fade: [16, 16, 24, 30], cam: [7, 3], motion: 0.75, pool: [0.5, 0.40, 0.75, 0.55], play: heroPlay, frames: HERO_FRAMES, driftEvery: 2,
    night: HERO_NIGHT, day: HERO_DAY,
    windows: (n) => heroWindows(n, [
      { x: 90, y: 228, w: 92, z: -820, rot: [10, 18, 0] },
      { x: 294, y: 226, w: 90, z: -820, rot: [10, -18, 0] },
      { x: 70, y: 318, w: 136, z: -320, rot: [2, 32, 0] },
      { x: 314, y: 306, w: 136, z: -320, rot: [2, -32, 0] },
      { x: 176, y: 390, w: 290, z: 40, rot: [3, 0, 0] },
      { x: 300, y: 468, h: 200, z: 170, rot: [0, -14, 0] },
    ]),
    type: [
      T('name', 'Evalbench', 190.5, 34, { fontSize: '52px' }, 'center'),
      T('line', 'Which model should do your job? The cheapest<br>one that clears your bar, with the proof.', 190.5, 102, { fontSize: '14.5px', textAlign: 'center' }, 'center'),
    ],
  },
  numbers: {
    css: [840, 168], fade: [30, 30, 20, 20], cam: [6, 2], pool: [0.5, 0.5, 0.75, 1.4],
    night: merge(NIGHT, { env: { glows: [[0.5, 0.5, 0.5, 0.06, '#2457f0']] }, motes: { n: 12 } }),
    day: merge(DAY, { motes: { n: 8 } }),
    windows: () => [{ x: 420, y: 84, w: 776, crop: [0, 0, 776, 100], z: 0, rot: [0, 0, 0], bar: false, bezel: 12, radius: 26, breathe: [4, 0], glow: 0.0, shadowOff: [0, -10, 36] }],
    type: NUMBERS.map(([v, l], i) => T('big', `<b style="font-size:42px">${v}</b><span style="font-size:13px;margin-top:9px">${l}</span>`, 58 + i * 196, 40)),
  },
  'numbers-phone': {
    css: [381, 330], dpr: 1080 / 381, fade: [16, 16, 18, 18], cam: [4, 2], pool: [0.5, 0.5, 0.8, 1.2],
    night: merge(NIGHT, { env: { glows: [[0.5, 0.5, 0.5, 0.06, '#2457f0']] }, motes: { n: 10 } }),
    day: merge(DAY, { motes: { n: 6 } }),
    windows: () => [{ x: 190.5, y: 165, w: 337, crop: [0, 0, 337, 266], z: 0, rot: [0, 0, 0], bar: false, bezel: 12, radius: 24, breathe: [3, 0], glow: 0.0, shadowOff: [0, -10, 30] }],
    type: NUMBERS.map(([v, l], i) => T('big', `<b style="font-size:40px">${v}</b><span style="font-size:13px;margin-top:8px">${l}</span>`, 38 + (i % 2) * 172, 46 + Math.floor(i / 2) * 134)),
  },
  verdict: panel(VERDICT), 'verdict-phone': panelPhone(VERDICT),
  proof: panel(PROOF), 'proof-phone': panelPhone(PROOF),
  write: panel(WRITE), 'write-phone': panelPhone(WRITE),
  judge: panel(JUDGE), 'judge-phone': panelPhone(JUDGE),
  holds: panel(HOLDS), 'holds-phone': panelPhone(HOLDS),

  // ---------- the social preview, 1280 x 640, dark ----------
  social: {
    css: [640, 320], fade: [26, 26, 22, 26], cam: [0, 0], motion: 0, pool: [0.70, 0.52, 0.42, 0.78],
    night: merge(NIGHT, { env: { glows: [[0.72, 1.1, 0.6, 0.07, '#c8c0aa'], [0.70, 0.36, 0.44, 0.09, '#2457f0']] } }), day: DAY,
    windows: (n) => [
      DESK(n, 'verdict', CROP.verdict, { x: 442, y: 146, w: 304, z: -80, rot: [2, -18, 0] }, { breathe: [0, 0], bezel: 9 }),
      PHONE(n, 'm-rate', CROP.phone, { x: 572, y: 204, h: 166, z: 60, rot: [0, -14, 0] }, { breathe: [0, 0] }),
      { parent: 0, box: 'say', pad: [24, 18], lift: 76, breathe: [0, 0], bezel: 8, radius: 14, ...LIFT(n), align: 0.6, glow: 0.25 },
    ],
    type: [
      T('kick', 'Self-hosted · Open source', 40, 104, { fontSize: '10px' }),
      T('name', 'Evalbench', 38, 122, { fontSize: '46px' }),
      T('line', 'Names the cheapest model that is good enough for your job.', 40, 182, { fontSize: '15.5px', whiteSpace: 'normal', width: '236px' }),
    ],
  },
};
for (const k in LAYOUTS) LAYOUTS[k].dpr = LAYOUTS[k].dpr || 2;
