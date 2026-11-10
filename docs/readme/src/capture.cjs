// Capture the running app on the demo workspace, in its dark theme and its light theme, for the Glass scenes.
//   ORIGIN=http://127.0.0.1:8590 node capture.cjs            every screen, then the replayed run
//   node capture.cjs replay                                  only the replayed run (needs no server)
// Desktop screens are 1280 px wide at 2x, phone screens 390 px at 3x. Every capture is the real app: the
// scenes only crop, place and light them. Named elements are measured into build/shots/boxes.json
// ([x, y, w, h, background] in capture pixels) so a scene can lift one out of its screen by name.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8484';
const SHOTS = path.resolve(__dirname, '..', 'build', 'shots');
const DEMO = path.resolve(__dirname, '..', '..', '..', 'web', 'dist');
const ONLY = process.argv[2];

// Skip to the "Ages in twelve years" pair, then (on desktop) fill a complete verdict the way a judge would.
async function rateReady(page, fill) {
  for (let i = 0; i < 80; i++) {
    const title = await page.locator('main section h2').first().textContent();
    if (title && title.includes('Ages in twelve years')) break;
    await page.keyboard.press('s');
    await page.waitForTimeout(220);
  }
  if (!fill) return;
  const texts = await page.locator('article').allInnerTexts();
  const wrong = texts[0].includes('Answer: 24') ? 0 : 1;
  const scores = (i) => (i === wrong ? [4, 1, 3, 4] : [5, 5, 4, 5]);
  for (const i of [0, 1]) {
    const rows = page.locator('article').nth(i).locator('footer > div').filter({ has: page.locator('button') });
    for (let r = 0; r < 4; r++) await rows.nth(r).getByRole('button').nth(scores(i)[r] - 1).click();
  }
  await page.locator('article').nth(wrong).getByRole('button', { name: 'Factual or logic error' }).click();
  await page.mouse.click(4, 400);
  await page.keyboard.press(wrong === 0 ? '7' : '1');
  const right = wrong === 0 ? 'B' : 'A', bad = wrong === 0 ? 'A' : 'B';
  await page.getByPlaceholder(/Point at the parts/).fill(`${right} sets up 3t + 12 = 2(t + 12) and lands on 36. ${bad} slips in the algebra (t = 8) and answers 24, which fails the one thing that matters.`);
  await page.mouse.click(4, 400);
  await page.waitForTimeout(800);
}
const openTask = async (p) => { await p.getByRole('button', { name: /Binary search that hangs/ }).click(); await p.waitForTimeout(400); };
const scrollTo = (sel, offset = 80) => async (p) => {
  await p.evaluate(({ sel, offset }) => { const el = document.querySelector(sel); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset); }, { sel, offset });
  await p.waitForTimeout(400);
};

// [name, url, prepare, marks]; a mark is { css, text?, index? } (index -1 = the last match)
const DESK = [
  ['overview', '/', null, { lead: { css: 'main section.card > div.grid', index: 0 }, head: { css: 'main h1' } }],
  ['run', '/runs/6', null, { grid: { css: 'main section', index: 1 } }],
  ['compare', '/runs/6/tasks/c04-summary', null, { broke: { css: 'main article [title="3 sentences (max 2)"]' } }],
  ['rate', '/rate?run=6', (p) => rateReady(p, true), { verdict: { css: 'main section .grid-cols-7' }, cards: { css: 'main article', index: 0 } }],
  ['scoreboard', '/scoreboard', null, { top: { css: 'main section table tbody tr', index: 0 }, history: { css: 'main section', index: 1 }, changes: { css: 'main section', index: 3 } }],
  ['suite', '/suites/core-battery', openTask, { tests: { css: 'main .card textarea', index: -1 } }],
  ['data', '/data', null, { pairs: { css: 'main .grid > div', text: 'Preference pairs', index: -1 } }],
];
const PHONE = [
  ['m-overview', '/', null],
  ['m-rate', '/rate?run=6', async (p) => { await rateReady(p, false); await scrollTo('article', 76)(p); }],
  ['m-scoreboard', '/scoreboard', scrollTo('main section', 76)],
  ['m-run', '/runs/6', scrollTo('main section', 76)],
];

async function marksOf(page, marks, k) {
  const out = {};
  for (const [key, m] of Object.entries(marks || {})) {
    out[key] = await page.evaluate(({ m, k }) => {
      const els = [...document.querySelectorAll(m.css)].filter((el) => !m.text || el.textContent.includes(m.text));
      const el = els[m.index === -1 ? els.length - 1 : (m.index || 0)];
      if (!el) throw new Error('no mark ' + JSON.stringify(m));
      const r = el.getBoundingClientRect();
      let bg = 'rgba(0, 0, 0, 0)', e = el;
      while (e && /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(bg)) { bg = getComputedStyle(e).backgroundColor; e = e.parentElement; }
      const hex = '#' + bg.match(/\d+/g).slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('');
      return [r.left * k, (r.top + window.scrollY) * k, r.width * k, r.height * k].map(Math.round).concat(hex);
    }, { m, k });
  }
  return out;
}

// The hero's moving part: a new run of the core battery, start to finish, on the run page. The static demo
// (web/dist, from `npm --prefix web run build:demo`) plays it: the same app, answering in the browser with the
// answers recorded on the demo workspace. Its clock is stepped by hand, so every build photographs the same
// moments: frame 0 is the queued run, the last frame the finished one, and each frame between is the first
// moment its share of the answers is in (REPLAY.share in layouts.js). The demo's own notice is hidden.
async function replay(browser, scheme, { frames, share }) {
  const index = path.join(DEMO, 'index.html');
  if (!fs.existsSync(index)) throw new Error('no static demo in web/dist: run `npm --prefix web run build:demo` first');
  const base = (fs.readFileSync(index, 'utf8').match(/src="([^"]*\/)assets\//) || [0, '/'])[1];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 880 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.setItem('evalbench:rater', 'sam'));
  await ctx.route('http://demo.local/**', (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname);
    const f = path.join(DEMO, p.startsWith(base) ? p.slice(base.length) : p);
    r.fulfill({ path: fs.existsSync(f) && fs.statSync(f).isFile() ? f : index });
  });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto(`http://demo.local${base}runs`);
  await page.clock.runFor(1000);
  await page.addStyleTag({ content: 'aside[aria-label="About this demo"] { display: none !important; }' });
  await page.getByRole('button', { name: 'New run' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Select all' }).click();
  await dialog.getByLabel(/Label/).fill('weekly check');
  await dialog.getByRole('button', { name: /^Start/ }).click();
  await page.waitForURL(/runs\/\d+$/);
  const start = await page.evaluate(() => Date.now());
  // Jump the clock so that the run page's next poll (one a second) lands exactly `t` ms into the run.
  const at = async (t) => {
    await page.clock.setSystemTime(start + t - 1000);
    await page.clock.fastForward(1000);
    let text = '', seen;
    do { seen = text; await page.waitForTimeout(60); text = await page.locator('main').innerText(); } while (text !== seen);   // until the page has settled
    const m = text.match(/(\d+) of (\d+) answers/);
    return { status: (text.match(/^(Queued|Running|Done)$/m) || [])[1], done: m ? +m[1] : 0, total: m ? +m[2] : 0 };
  };
  const file = (i) => path.join(SHOTS, `replay-${scheme}-${String(i).padStart(2, '0')}.png`);
  let state = await at(300), total = state.total, next = 1, last = await page.screenshot();
  if (state.status !== 'Queued' || !total) throw new Error('the replayed run did not start queued: ' + JSON.stringify(state));
  fs.writeFileSync(file(0), last);
  const log = [0];
  for (let t = 750; state.status !== 'Done'; t += t < 6000 ? 50 : 100) {
    if (t > 90000) throw new Error('the replayed run never finished');
    state = await at(t);
    if (state.status !== 'Running') continue;
    const want = () => Math.min(total - 1, Math.round(total * share(next / (frames - 1))));
    if (next < frames - 1 && state.done >= want()) last = await page.screenshot();
    while (next < frames - 1 && state.done >= want()) { fs.writeFileSync(file(next++), last); log.push(state.done); }
  }
  while (next < frames - 1) { fs.writeFileSync(file(next++), last); log.push(log[log.length - 1]); }
  fs.writeFileSync(file(frames - 1), await page.screenshot());
  console.log(`replay-${scheme}: ${frames} frames, answers in at each: ${log.join(' ')} ${total}`);
  await ctx.close();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const { REPLAY } = await import(pathToFileURL(path.join(__dirname, 'layouts.js')).href);
  for (const scheme of ['dark', 'light']) await replay(browser, scheme, REPLAY);
  if (ONLY === 'replay') return browser.close();
  const boxes = {};
  for (const scheme of ['dark', 'light']) {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: scheme });
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: scheme, isMobile: true, hasTouch: true });
    for (const ctx of [desk, phone]) await ctx.addInitScript(() => localStorage.setItem('evalbench:rater', 'sam'));
    const d = await desk.newPage();
    for (const [name, url, prepare, marks] of DESK) {
      await d.setViewportSize({ width: 1280, height: 860 });
      await d.goto(ORIGIN + url, { waitUntil: 'networkidle' });
      if (prepare) await prepare(d);
      await d.waitForTimeout(700);
      const h = await d.evaluate(() => document.documentElement.scrollHeight);
      if (h > 860) { await d.setViewportSize({ width: 1280, height: Math.min(h, 4000) }); await d.waitForTimeout(500); }
      boxes[`${name}-${scheme}`] = await marksOf(d, marks, 2);
      await d.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
      console.log(`${name}-${scheme}`);
    }
    const m = await phone.newPage();
    for (const [name, url, prepare] of PHONE) {
      await m.goto(ORIGIN + url, { waitUntil: 'networkidle' });
      await m.waitForTimeout(600);
      if (prepare) await prepare(m);
      await m.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
      console.log(`${name}-${scheme}`);
    }
    await desk.close(); await phone.close();
  }
  fs.writeFileSync(path.join(SHOTS, 'boxes.json'), JSON.stringify(boxes, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
