/**
 * Regenerates the README visuals in docs/readme/. It captures the running app (desktop and phone)
 * on the demo workspace, then composes each scene as a dark card: a neutral browser window and a
 * generic phone, plus the hero, the numbers banner and the social preview. Every scene has a wide
 * version and a portrait version for phones; README.md switches between them with <picture>.
 *
 *   EVALBENCH_DATA=$(mktemp -d) EVALBENCH_DEMO=1 EVALBENCH_AUTH=off EVALBENCH_SANDBOX=local NIMBUS_API_KEY=demo evalbench serve &
 *   npm --prefix web run readme:visuals               # capture and compose
 *   npm --prefix web run readme:visuals -- --compose  # compose again from the last captures
 *
 * Set PW_CHROMIUM_PATH to use a preinstalled Chrome or Chromium.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:8484';
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WEB, '..');
const OUT = path.join(ROOT, 'docs/readme');
const RAW = path.join(OUT, '.raw');
const SRC = path.join(OUT, 'src');
const COMPOSE_ONLY = process.argv.includes('--compose');
for (const d of [OUT, RAW, SRC]) mkdirSync(d, { recursive: true });

const launch = () => chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});

// ---------------------------------------------------------------- capture

/** The content column of a page between two elements, in page pixels. */
async function region(page, top, bottom, { padTop = 0, padBottom = 0, left = null } = {}) {
  return page.evaluate(
    ({ top, bottom, padTop, padBottom, left }) => {
      const container = document.querySelector('main > div.relative');
      const c = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const x0 = c.left + parseFloat(style.paddingLeft) - 16;
      const x1 = c.right - parseFloat(style.paddingRight) + 16;
      const pick = (sel, which) => {
        const els = [...document.querySelectorAll(sel.css)].filter((el) => !sel.text || el.textContent.includes(sel.text));
        const el = els[sel.index ?? 0];
        if (!el) throw new Error(`no element for ${JSON.stringify(sel)}`);
        const r = el.getBoundingClientRect();
        return which === 'top' ? r.top : r.bottom;
      };
      const y0 = pick(top, 'top') - padTop;
      const y1 = pick(bottom, 'bottom') + padBottom;
      const lx = left ? document.querySelector(left).getBoundingClientRect().left - 16 : x0;
      return { x: Math.round(lx), y: Math.round(y0), width: Math.round(x1 - lx), height: Math.round(y1 - y0) };
    },
    { top, bottom, padTop, padBottom, left },
  );
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const h = await page.evaluate(() => document.querySelector('main')?.scrollHeight ?? 900);
  const vp = page.viewportSize();
  if (h > vp.height) {
    await page.setViewportSize({ width: vp.width, height: Math.min(h, 4000) });
    await page.waitForTimeout(400);
  }
}

async function rateReady(page, { fill }) {
  for (let i = 0; i < 60; i++) {
    const title = await page.locator('section span.truncate').first().textContent();
    if (title?.includes('Ages in twelve years')) break;
    await page.keyboard.press('s');
    await page.waitForTimeout(250);
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
  await page.locator('body').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press(wrong === 0 ? '7' : '1');
  const right = wrong === 0 ? 'B' : 'A';
  const bad = wrong === 0 ? 'A' : 'B';
  await page
    .getByPlaceholder(/Point to specific parts/)
    .fill(`${right} sets up 3t + 12 = 2(t + 12) and lands on 36. ${bad} slips in the algebra (t = 8) and answers 24, so it fails the one thing that matters.`);
  await page.locator('body').click({ position: { x: 3, y: 3 } });
}

async function capture() {
  const browser = await launch();
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark', isMobile: true, hasTouch: true });
  for (const ctx of [desk, phone]) await ctx.addInitScript(() => localStorage.setItem('evalbench:rater', 'sam'));

  const d = await desk.newPage();
  const marks = {};
  /** Captures a region; `mark` names the element the scene's annotation points at, stored
   *  relative to the capture so the composer can draw to it. */
  const shot = async (name, url, clip, prepare, mark) => {
    await d.setViewportSize({ width: 1280, height: 860 });
    await d.goto(ORIGIN + url);
    await d.waitForLoadState('networkidle');
    if (prepare) await prepare(d);
    await settle(d);
    const box = typeof clip === 'function' ? await clip(d) : clip;
    if (mark) {
      const r = await d.evaluate((m) => {
        const els = [...document.querySelectorAll(m.css)].filter((el) => !m.text || el.textContent.includes(m.text));
        const el = els[m.index === -1 ? els.length - 1 : (m.index ?? 0)];
        if (!el) throw new Error(`no mark ${JSON.stringify(m)}`);
        const b = el.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      }, mark);
      marks[name] = { x: r.x - box.x, y: r.y - box.y, w: r.w, h: r.h, cw: box.width, ch: box.height };
    }
    await d.screenshot({ path: path.join(RAW, `${name}.png`), clip: box ?? undefined });
    console.log('captured', name);
  };

  await shot('run', '/runs/6', (p) => region(p, { css: 'main section' }, { css: 'tbody tr', index: 10 }, { padTop: 2, padBottom: 14 }), null, {
    css: 'tbody tr td:last-child button[title="Failed"]',
  });
  await shot(
    'compare',
    '/runs/6/tasks/c04-summary',
    (p) => region(p, { css: 'main article' }, { css: 'main article', index: 3 }, { padTop: 2, padBottom: 2, left: 'main article' }),
    null,
    { css: 'main article [title="3 sentences (max 2)"]' },
  );
  await shot(
    'rate',
    '/rate?run=6',
    (p) => region(p, { css: 'main article' }, { css: 'main section', index: 1 }, { padTop: 2, padBottom: 2 }),
    (p) => rateReady(p, { fill: true }),
    { css: 'main section button.border-side-a, main section button.border-side-b' },
  );
  await shot(
    'rate-pair',
    '/rate?run=6',
    (p) => region(p, { css: 'main article' }, { css: 'main article', index: 1 }, { padTop: 2, padBottom: 2 }),
    (p) => rateReady(p, { fill: true }),
    { css: 'main article header span', index: 0 },
  );
  await shot(
    'rate-pair-b',
    '/rate?run=6',
    (p) => region(p, { css: 'main article' }, { css: 'main article', index: 1 }, { padTop: 2, padBottom: 2 }),
    (p) => rateReady(p, { fill: true }),
    { css: 'main article header span', index: 2 },
  );
  await shot('scoreboard', '/scoreboard', (p) => region(p, { css: 'main section' }, { css: 'main section', index: 0 }, { padTop: 16, padBottom: 16 }), null, {
    css: 'main section table tbody tr td:nth-child(5) .relative',
    index: 0,
  });
  await shot('history', '/scoreboard', (p) => region(p, { css: 'main section', index: 1 }, { css: 'main section', index: 1 }, { padTop: 2, padBottom: 2 }), null, {
    css: 'main section svg circle',
    index: -1,
  });
  await shot('regressions', '/scoreboard', (p) => region(p, { css: 'main section', index: 3 }, { css: 'main section', index: 3 }, { padTop: 2, padBottom: 2 }), null, {
    css: 'main section a span',
    text: 'now fails',
    index: -1,
  });
  await shot(
    'suite',
    '/suites/core-battery',
    (p) => region(p, { css: 'main .card button', text: 'Mutable default argument' }, { css: 'main .card button', text: 'Delete task' }, { padTop: 8, padBottom: 18 }),
    async (p) => {
      await p.getByRole('button', { name: /Binary search that hangs/ }).click();
      await p.waitForTimeout(300);
    },
    { css: 'main .card textarea', index: -1 },
  );
  await shot('data', '/data', (p) => region(p, { css: 'main .grid > div' }, { css: 'main .grid > div', index: 3 }, { padTop: 2, padBottom: 2 }), null, {
    css: 'main .grid div',
    text: 'Preference pairs',
    index: -1,
  });
  writeFileSync(path.join(RAW, 'marks.json'), JSON.stringify(marks, null, 2));

  const m = await phone.newPage();
  const pshot = async (name, url, prepare) => {
    await m.goto(ORIGIN + url);
    await m.waitForLoadState('networkidle');
    await m.waitForTimeout(500);
    if (prepare) await prepare(m);
    await m.screenshot({ path: path.join(RAW, `${name}.png`) });
    console.log('captured', name);
  };
  const scrollTo = (sel, offset = 70) => async (p) => {
    await p.evaluate(
      ({ sel, offset }) => {
        const el = document.querySelector(sel);
        const main = document.querySelector('main');
        main.scrollTop = el.getBoundingClientRect().top + main.scrollTop - offset;
      },
      { sel, offset },
    );
    await p.waitForTimeout(300);
  };
  await pshot('m-overview', '/');
  await pshot('m-rate', '/rate?run=6', async (p) => {
    await rateReady(p, { fill: false });
    await scrollTo('article', 64)(p);
  });
  await pshot('m-compare', '/runs/6/tasks/d02-default-arg', scrollTo('article', 64));
  await pshot('m-run', '/runs/6', scrollTo('main .card', 64));
  await pshot('m-scoreboard', '/scoreboard', scrollTo('main section', 64));
  await pshot('m-regressions', '/scoreboard', scrollTo('main .grid.lg\\:grid-cols-2 section', 64));
  await pshot('m-suite', '/suites/core-battery', async (p) => {
    await p.getByRole('button', { name: /Binary search that hangs/ }).click();
    await scrollTo('main .card .border-t.bg-white\\/\\[0\\.012\\]', 120)(p);
  });
  await pshot('m-data', '/data', scrollTo('main .grid', 64));

  // Real output for the data scene: the first preference pair, as the export returns it.
  const pair = (await (await fetch(`${ORIGIN}/api/export/preferences.jsonl`)).text()).split('\n')[0];
  writeFileSync(path.join(RAW, 'preference.json'), pair);
  const board = await (await fetch(`${ORIGIN}/api/scoreboard/core-battery`)).json();
  writeFileSync(path.join(RAW, 'board.json'), JSON.stringify(board));
  await browser.close();
}

// ---------------------------------------------------------------- compose
//
// Evalbench's identity: a blind tasting for models. Chalk is the table, ink sets the type, azure is
// the face-down side of a card, and scorecard red is only for the judge's marks. Real screens are
// staged on the table like objects in a product photo, and each scene has one hand-drawn note.

const b64 = (file) => readFileSync(file).toString('base64');
const fontFile = (pkg, file) => b64(path.join(WEB, 'node_modules', pkg, 'files', file));
const img = (name) => `data:image/png;base64,${b64(path.join(RAW, `${name}.png`))}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const C = { chalk: '#f1eee6', paper: '#f7f5ef', ink: '#16171b', ink2: '#45443f', muted: '#7a766d', rule: 'rgba(22,23,27,.16)', azure: '#2563eb', red: '#d23c2a' };

const CSS = `
@font-face { font-family: Grotesk; src: url(data:font/woff2;base64,${fontFile('@fontsource-variable/schibsted-grotesk', 'schibsted-grotesk-latin-wght-normal.woff2')}) format('woff2'); font-weight: 400 900; }
@font-face { font-family: Slab; src: url(data:font/woff2;base64,${fontFile('@fontsource/zilla-slab', 'zilla-slab-latin-600-normal.woff2')}) format('woff2'); font-weight: 600; }
@font-face { font-family: Slab; src: url(data:font/woff2;base64,${fontFile('@fontsource/zilla-slab', 'zilla-slab-latin-700-normal.woff2')}) format('woff2'); font-weight: 700; }
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; }
body { font-family: Grotesk, sans-serif; color: ${C.ink}; -webkit-font-smoothing: antialiased; }
.scene { position: relative; overflow: hidden; border-radius: 6px; background: ${C.chalk}; }
.slab { font-family: Slab, serif; font-variant-numeric: lining-nums; }
.screen { position: absolute; border-radius: 12px; overflow: hidden; background: #0d0e10;
  box-shadow: 0 0 0 1px rgba(22,23,27,.55), 0 2px 3px rgba(22,23,27,.12), 0 24px 40px -18px rgba(22,23,27,.45), 0 60px 100px -50px rgba(22,23,27,.5); }
.screen img { display: block; width: 100%; }
.phone { position: absolute; padding: 9px; border-radius: 46px; background: #1b1c20;
  box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.08), 0 0 0 1px rgba(22,23,27,.6), 0 28px 50px -22px rgba(22,23,27,.55), 0 70px 110px -60px rgba(22,23,27,.55); }
.phone .scr { position: relative; overflow: hidden; border-radius: 37px; background: #101113; padding-top: 34px; }
.phone .scr img { display: block; width: 100%; }
.phone .island { position: absolute; top: 9px; left: 50%; transform: translateX(-50%); width: 92px; height: 26px; border-radius: 20px; background: #000; z-index: 2; }
.note { position: absolute; font-family: Slab, serif; font-weight: 700; color: ${C.red}; line-height: 1.12; }
svg.ink { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
`;

const MARK = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${C.ink}"/><g transform="rotate(-11 11.5 17)"><rect x="5.5" y="9" width="12" height="16.5" rx="2.4" fill="#4da3ff"/></g><g transform="rotate(8 20.5 15.5)"><rect x="14.5" y="7.25" width="12" height="16.5" rx="2.4" fill="${C.paper}"/><path d="M17.4 15.6l2.5 2.6 4.4-5.3" fill="none" stroke="#e04a36" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

const screen = ({ name, x, y, w, rotate = 0 }) =>
  `<div class="screen" style="left:${x}px;top:${y}px;width:${w}px;transform:rotate(${rotate}deg)"><img src="${img(name)}"></div>`;
const phoneEl = ({ name, x, y, w, rotate = 0 }) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;transform:rotate(${rotate}deg)"><div class="scr"><div class="island"></div><img src="${img(name)}"></div></div>`;

/** A pen stroke: a gently bowed line from (x1,y1) to (x2,y2) with an open arrowhead. */
function arrow(x1, y1, x2, y2, bow = 0.18) {
  const mx = (x1 + x2) / 2 - (y2 - y1) * bow;
  const my = (y1 + y2) / 2 + (x2 - x1) * bow;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const h = 13;
  const a1 = [x2 - h * Math.cos(ang - 0.45), y2 - h * Math.sin(ang - 0.45)];
  const a2 = [x2 - h * Math.cos(ang + 0.45), y2 - h * Math.sin(ang + 0.45)];
  return `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke="${C.red}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M${a1[0]},${a1[1]} L${x2},${y2} L${a2[0]},${a2[1]}" fill="none" stroke="${C.red}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A loop drawn round something, not quite closed, the way a pen does it. */
function ring(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i <= 26; i++) {
    const t = -0.5 + (i / 26) * (Math.PI * 2 + 0.35);
    const wob = 1.8 * Math.sin(i * 1.7); // a steady hand's tremor, the same at any size
    pts.push(`${(cx + (rx + wob) * Math.cos(t)).toFixed(1)},${(cy + (ry + wob) * Math.sin(t)).toFixed(1)}`);
  }
  return `<path d="M${pts.join(' L')}" fill="none" stroke="${C.red}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

async function size(name) {
  const meta = await sharp(path.join(RAW, `${name}.png`)).metadata();
  return { w: meta.width / 2, h: meta.height / 2 }; // CSS pixels of the 2x capture
}

async function render(browser, file, html, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`;
  writeFileSync(path.join(SRC, `${file}.html`), doc.replace(/data:[^"')]+/g, 'data:…'));
  await page.setContent(doc, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator('.scene').screenshot({ omitBackground: true });
  await page.close();
  if (file === 'social') await sharp(png).resize(1280, 640).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'social.png'));
  else await sharp(png).webp({ quality: 88, effort: 6 }).toFile(path.join(OUT, `${file}.webp`));
  console.log('composed', file);
}

const marks = () => JSON.parse(readFileSync(path.join(RAW, 'marks.json'), 'utf8'));

/** A feature scene: the real screen across the table, and one note written in the margin nearest
 *  to the thing it points at, with a single stroke and a ring. */
async function feature(browser, file, { desk, phone, note }) {
  const W = 1400;
  const pad = 64;
  const margin = 170;
  const ds = await size(desk);
  const winW = Math.min(W - pad * 2, ds.w * 1.35);
  const scale = winW / ds.w;
  const winH = ds.h * scale;
  const m = marks()[desk];
  const winX = (W - winW) / 2;
  const tx = winX + m.x * scale;
  const tw = m.w * scale;
  const th = m.h * scale;
  const above = m.y + m.h / 2 < ds.h / 2;
  const winY = above ? margin : pad;
  const H = Math.round(winY + winH + (above ? pad : margin));
  const ty = winY + m.y * scale;
  const cx = tx + tw / 2;
  const cy = ty + th / 2;
  const noteW = 600;
  const noteX = Math.max(pad, Math.min(W - pad - noteW, cx - noteW * 0.62));
  const noteY = above ? 52 : winY + winH + 54;
  const startX = Math.min(noteX + noteW + 12, Math.max(noteX - 12, cx + (cx > noteX + noteW / 2 ? -40 : 40)));
  const fromY = above ? noteY + 46 : noteY - 10;
  const toY = above ? cy - th / 2 - 14 : cy + th / 2 + 14;
  const html = `<div class="scene" style="width:${W}px;height:${H}px">
    ${screen({ name: desk, x: winX, y: winY, w: winW })}
    <div class="note" style="left:${noteX}px;top:${noteY}px;width:${noteW}px;font-size:30px">${note}</div>
    <svg class="ink" width="${W}" height="${H}">${ring(cx, cy, tw / 2 + 12, th / 2 + 9)}${arrow(startX, fromY, cx + (startX < cx ? -10 : 10), toY, startX < cx ? 0.22 : -0.22)}</svg>
  </div>`;
  await render(browser, file, html, W, H);

  // Portrait for phones: the note on top, the phone on the table below it.
  const MW = 720;
  const pw = 340;
  const ps = await size(phone);
  const ph = 18 + 34 + ((pw - 18) * ps.h) / ps.w;
  const MH = Math.round(ph + 240);
  const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px">
    <div class="note" style="left:56px;top:52px;width:${MW - 112}px;font-size:34px">${note}</div>
    ${phoneEl({ name: phone, x: (MW - pw) / 2 + 40, y: 180, w: pw, rotate: 2 })}
  </div>`;
  await render(browser, `${file}-mobile`, mHtml, MW, MH);
}

function scorecardRows(board, { nameSize = 18, numSize = 30, rowH = 52, width = 520 }) {
  const rows = board.models
    .map(
      (m, i) => `<div style="display:grid;grid-template-columns:28px 1fr 96px 96px;align-items:baseline;height:${rowH}px;border-top:1px solid ${C.rule};padding-top:12px">
        <span class="slab" style="font-size:${nameSize - 2}px;font-weight:600;color:${C.muted}">${i + 1}</span>
        <span style="font-size:${nameSize}px;font-weight:500">${esc(m.label)}</span>
        <span class="slab" style="font-size:${numSize}px;font-weight:700;text-align:right">${Math.round(m.auto.pass_rate * 100)}%</span>
        <span class="slab" style="font-size:${numSize}px;font-weight:700;text-align:right;color:${C.ink2}">${Math.round(m.human.rating)}</span>
      </div>`,
    )
    .join('');
  return `<div style="width:${width}px">
    <div style="display:grid;grid-template-columns:28px 1fr 96px 96px;font-size:13px;font-weight:600;letter-spacing:.04em;color:${C.muted};padding-bottom:10px">
      <span></span><span>CORE BATTERY, LATEST RUN</span><span style="text-align:right">CHECKS</span><span style="text-align:right">JUDGES</span></div>
    ${rows}<div style="border-top:1px solid ${C.rule}"></div></div>`;
}

async function compose() {
  const browser = await launch();
  const board = JSON.parse(readFileSync(path.join(RAW, 'board.json'), 'utf8'));
  board.models = board.models.filter((m) => m.auto && m.human);

  // Hero: the claim across the top, the scorecard and the judge's view beneath it.
  {
    const W = 1400;
    const H = 930;
    const ps = await size('rate-pair');
    const sw = 760;
    const sh = (ps.h * sw) / ps.w;
    const k = sw / ps.w;
    const sx = 584;
    const sy = 404;
    const mk = marks();
    const ringAt = (mm) => ring(sx + (mm.x + mm.w / 2) * k, sy + (mm.y + mm.h / 2) * k, (mm.w * k) / 2 + 12, (mm.h * k) / 2 + 10);
    const underline = `<svg viewBox="0 0 100 12" preserveAspectRatio="none" style="position:absolute;left:-2%;bottom:-0.16em;width:104%;height:0.16em;overflow:visible"><path d="M1,7 C25,10 60,4 99,6" fill="none" stroke="${C.red}" stroke-width="3.2" vector-effect="non-scaling-stroke" stroke-linecap="round" style="stroke-width:6px"/></svg>`;
    const html = `<div class="scene" style="width:${W}px;height:${H}px">
      <div style="position:absolute;left:80px;top:70px;display:flex;align-items:center;gap:14px;font-size:26px;font-weight:650;letter-spacing:-.01em">${MARK(38)} Evalbench</div>
      <div style="position:absolute;left:74px;top:150px;font-size:112px;font-weight:760;letter-spacing:-.05em;line-height:.93;white-space:nowrap">Judge the answer,<br>not the <span style="position:relative;display:inline-block">name.${underline}</span></div>
      <div style="position:absolute;left:80px;top:440px;width:440px;font-size:21px;line-height:1.45;color:${C.ink2}">A self-hosted workbench for testing language models on your own tasks. Run any model, grade every answer, and let people rate them blind.</div>
      <div style="position:absolute;left:80px;top:640px">${scorecardRows(board, { nameSize: 17, numSize: 26, rowH: 48, width: 430 })}</div>
      ${screen({ name: 'rate-pair', x: sx, y: sy, w: sw, rotate: 1.2 })}
      <div class="note" style="left:${sx + 20}px;top:${sy + sh + 38}px;width:${sw}px;font-size:28px">No names, shuffled every time. The labels come off when you are done.</div>
      <svg class="ink" width="${W}" height="${H}">${ringAt(mk['rate-pair'])}${ringAt(mk['rate-pair-b'])}</svg>
    </div>`;
    await render(browser, 'hero', html, W, H);

    const MW = 720;
    const MH = 1360;
    const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px">
      <div style="position:absolute;left:52px;top:56px;display:flex;align-items:center;gap:12px;font-size:24px;font-weight:650">${MARK(34)} Evalbench</div>
      <div style="position:absolute;left:50px;top:130px;font-size:76px;font-weight:760;letter-spacing:-.05em;line-height:.93;white-space:nowrap">Judge the answer,<br>not the <span style="position:relative;display:inline-block">name.${underline}</span></div>
      <div style="position:absolute;left:52px;top:318px;width:600px;font-size:20px;line-height:1.45;color:${C.ink2}">Run any model on your own tasks, grade every answer, and rate them blind. Self-hosted.</div>
      ${phoneEl({ name: 'm-rate', x: 190, y: 440, w: 360, rotate: 2 })}
    </div>`;
    await render(browser, 'hero-mobile', mHtml, MW, MH);
  }

  // The numbers, as a judge's scorecard. Every figure is a fact of the code (see README "Quality").
  {
    const items = [
      ['20', 'battery tasks', 'reasoning, constraints, debugging'],
      ['7', 'check types', 'exact match to Python tests'],
      ['3', 'provider kinds', 'Anthropic, OpenAI, compatible'],
      ['4', 'export formats', 'CSV, JSONL, DPO pairs, results'],
      ['0', 'keys stored', 'read from the environment'],
    ];
    const W = 1400;
    const H = 300;
    const col = (W - 160) / items.length;
    const cells = items
      .map(
        ([n, l, c], i) => `<div style="position:absolute;left:${80 + i * col}px;top:70px;width:${col}px;padding-left:${i ? 26 : 0}px;${i ? `border-left:1px solid ${C.rule};` : ''}height:170px">
          <div class="slab" style="font-size:84px;font-weight:700;line-height:.9;letter-spacing:-.02em">${n}</div>
          <div style="font-size:19px;font-weight:600;margin-top:18px">${l}</div>
          <div style="font-size:15px;color:${C.muted};margin-top:5px">${c}</div></div>`,
      )
      .join('');
    const tickX = 80 + 4 * col + 26 + 66;
    const html = `<div class="scene" style="width:${W}px;height:${H}px">${cells}
      <svg class="ink" width="${W}" height="${H}"><path d="M${tickX},92 l14,16 l30,-38" fill="none" stroke="${C.red}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
    await render(browser, 'numbers', html, W, H);
    const MW = 720;
    const MH = 760;
    const mCells = items
      .map(
        ([n, l, c], i) => `<div style="position:absolute;left:${56 + (i % 2) * 320}px;top:${60 + Math.floor(i / 2) * 230}px;width:290px">
          <div class="slab" style="font-size:76px;font-weight:700;line-height:.9">${n}</div>
          <div style="font-size:19px;font-weight:600;margin-top:14px">${l}</div>
          <div style="font-size:15px;color:${C.muted};margin-top:4px">${c}</div></div>`,
      )
      .join('');
    const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px">${mCells}
      <svg class="ink" width="${MW}" height="${MH}"><path d="M118,${60 + 2 * 230 + 20} l14,16 l30,-38" fill="none" stroke="${C.red}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
    await render(browser, 'numbers-mobile', mHtml, MW, MH);
  }

  await feature(browser, 'write', { desk: 'suite', phone: 'm-suite', note: 'Your tests run against the answer’s code, in a box with no way out.' });
  await feature(browser, 'run', { desk: 'run', phone: 'm-run', note: 'Every cell is a verdict. Click one for the reason.' });
  await feature(browser, 'compare', { desk: 'compare', phone: 'm-compare', note: 'Not just red: the exact rule it broke.' });
  await feature(browser, 'rate', { desk: 'rate', phone: 'm-rate', note: 'Seven steps, from A by a mile to B by a mile.' });
  await feature(browser, 'scoreboard', { desk: 'scoreboard', phone: 'm-scoreboard', note: 'A lead inside the interval is not a lead.' });
  await feature(browser, 'history', { desk: 'history', phone: 'm-regressions', note: 'Run 6: the re-quantised model drops, and the chart says so.' });
  await feature(browser, 'regressions', { desk: 'regressions', phone: 'm-regressions', note: 'The day it breaks, not the week after.' });
  await feature(browser, 'data', { desk: 'data', phone: 'm-data', note: 'Every decisive verdict, ready to train on.' });

  // Social preview, 1280x640: the claim and the judge's view.
  {
    const html = `<div class="scene" style="width:1280px;height:640px;border-radius:0">
      <div style="position:absolute;left:80px;top:74px;display:flex;align-items:center;gap:14px;font-size:28px;font-weight:650">${MARK(42)} Evalbench</div>
      <div style="position:absolute;left:76px;top:160px;font-size:82px;font-weight:760;letter-spacing:-.05em;line-height:.93;white-space:nowrap">Judge the answer,<br>not the <span style="position:relative;display:inline-block">name.<svg viewBox="0 0 100 12" preserveAspectRatio="none" style="position:absolute;left:-2%;bottom:-0.16em;width:104%;height:0.16em;overflow:visible"><path d="M1,7 C25,10 60,4 99,6" fill="none" stroke="${C.red}" vector-effect="non-scaling-stroke" stroke-linecap="round" style="stroke-width:5px"/></svg></span></div>
      <div style="position:absolute;left:80px;top:372px;width:440px;font-size:24px;line-height:1.4;color:${C.ink2}">Self-hosted LLM evaluation: automatic checks, blind rating, regressions.</div>
      ${screen({ name: 'rate-pair', x: 640, y: 300, w: 700, rotate: 1.4 })}
    </div>`;
    await render(browser, 'social', html, 1280, 640);
  }
  await browser.close();
}

if (!COMPOSE_ONLY) await capture();
if (!existsSync(path.join(RAW, 'marks.json'))) throw new Error('no captures: run without --compose first');
await compose();
