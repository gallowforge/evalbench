// Capture the running app on the demo workspace, in its dark theme and its light theme, for the Glass scenes.
//   ORIGIN=http://127.0.0.1:8590 node capture.cjs
// Desktop screens are 1280 px wide at 2x, phone screens 390 px at 3x. Every capture is the real app: the
// scenes only crop, place and light them. Named elements are measured into build/shots/boxes.json
// ([x, y, w, h, background] in capture pixels) so a scene can lift one out of its screen by name.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8484';
const SHOTS = path.resolve(__dirname, '..', 'build', 'shots');

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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
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
