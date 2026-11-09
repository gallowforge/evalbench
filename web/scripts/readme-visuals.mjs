/**
 * Regenerates the README visuals in docs/readme/. It captures the running app (desktop and phone)
 * on the demo workspace, then stages each capture as a plate: the real screen on a solid azure
 * field, one hand-written note, and the judge's red marks on the screen. Every scene has a wide
 * version and a portrait version for phones; README.md switches between them with <picture>.
 *
 *   EVALBENCH_DATA=$(mktemp -d) EVALBENCH_DEMO=1 EVALBENCH_AUTH=off EVALBENCH_SANDBOX=local NIMBUS_API_KEY=demo evalbench serve &
 *   npm --prefix web run readme:visuals               # capture and compose
 *   npm --prefix web run readme:visuals -- --compose  # compose again from the last captures
 *
 * Set PW_CHROMIUM_PATH to use a preinstalled Chrome or Chromium.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
async function region(page, top, bottom, { padTop = 0, padBottom = 0, left = null, pad = 18 } = {}) {
  return page.evaluate(
    ({ top, bottom, padTop, padBottom, left, pad }) => {
      const main = document.querySelector('main');
      const c = main.getBoundingClientRect();
      const st = getComputedStyle(main);
      const x0 = c.left + parseFloat(st.paddingLeft) - pad;
      const x1 = c.right - parseFloat(st.paddingRight) + pad;
      const pick = (sel, which) => {
        const els = [...document.querySelectorAll(sel.css)].filter((el) => !sel.text || el.textContent.includes(sel.text));
        const el = els[sel.index === -1 ? els.length - 1 : (sel.index ?? 0)];
        if (!el) throw new Error(`no element for ${JSON.stringify(sel)}`);
        const r = el.getBoundingClientRect();
        return (which === 'top' ? r.top : r.bottom) + window.scrollY;
      };
      const y0 = pick(top, 'top') - padTop;
      const y1 = pick(bottom, 'bottom') + padBottom;
      const lx = left ? document.querySelector(left).getBoundingClientRect().left - pad : x0;
      return { x: Math.round(lx), y: Math.round(y0), width: Math.round(x1 - lx), height: Math.round(y1 - y0) };
    },
    { top, bottom, padTop, padBottom, left, pad },
  );
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const vp = page.viewportSize();
  if (h > vp.height) {
    await page.setViewportSize({ width: vp.width, height: Math.min(h, 4000) });
    await page.waitForTimeout(500);
  }
}

async function rateReady(page, { fill }) {
  for (let i = 0; i < 80; i++) {
    const title = await page.locator('main section h2').first().textContent();
    if (title?.includes('Ages in twelve years')) break;
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
  const right = wrong === 0 ? 'B' : 'A';
  const bad = wrong === 0 ? 'A' : 'B';
  await page.getByPlaceholder(/Point at the parts/).fill(`${right} sets up 3t + 12 = 2(t + 12) and lands on 36. ${bad} slips in the algebra (t = 8) and answers 24, which fails the one thing that matters.`);
  await page.mouse.click(4, 400);
  await page.waitForTimeout(800);
}

async function capture() {
  const browser = await launch();
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  for (const ctx of [desk, phone]) await ctx.addInitScript(() => localStorage.setItem('evalbench:rater', 'sam'));

  const d = await desk.newPage();
  const marks = {};
  /** Captures a region; `mark` names the element the scene's note points at, stored relative to
   *  the capture so the composer can draw to it. */
  const shot = async (name, url, clip, prepare, mark) => {
    await d.setViewportSize({ width: 1280, height: 860 });
    await d.goto(ORIGIN + url);
    await d.waitForLoadState('networkidle');
    if (prepare) await prepare(d);
    await settle(d);
    const box = typeof clip === 'function' ? await clip(d) : clip;
    for (const [key, m] of Object.entries(mark ?? {})) {
      const r = await d.evaluate((m) => {
        const els = [...document.querySelectorAll(m.css)].filter((el) => !m.text || el.textContent.includes(m.text));
        const el = els[m.index === -1 ? els.length - 1 : (m.index ?? 0)];
        if (!el) throw new Error(`no mark ${JSON.stringify(m)}`);
        const b = el.getBoundingClientRect();
        return { x: b.left, y: b.top + window.scrollY, w: b.width, h: b.height };
      }, m);
      marks[key] = { x: r.x - box.x, y: r.y - box.y, w: r.w, h: r.h, cw: box.width, ch: box.height };
    }
    await d.screenshot({ path: path.join(RAW, `${name}.png`), clip: box ?? undefined, fullPage: true });
    console.log('captured', name);
  };

  await shot('overview', '/', (p) => region(p, { css: 'main header' }, { css: 'main section', index: 0 }, { padTop: 30, padBottom: 22, pad: 28 }), null, {
    overview: { css: 'main h1' },
  });
  await shot('run', '/runs/6', (p) => region(p, { css: 'main section', index: 1 }, { css: 'tbody tr', index: 10 }, { padTop: 2, padBottom: 18 }), null, {
    run: { css: 'tbody tr td:last-child button[title="Failed"]' },
  });
  await shot(
    'compare',
    '/runs/6/tasks/c04-summary',
    (p) => region(p, { css: 'main article', index: 2 }, { css: 'main article', index: 3 }, { padTop: 2, padBottom: 2, left: 'main article' }),
    null,
    { compare: { css: 'main article [title="3 sentences (max 2)"]' } },
  );
  await shot(
    'rate',
    '/rate?run=6',
    (p) => region(p, { css: 'main section', index: 0 }, { css: 'main section', index: 1 }, { padTop: 4, padBottom: 4 }),
    (p) => rateReady(p, { fill: true }),
    {
      rate: { css: 'main section .grid-cols-7 button:has(svg)' },
      'rate-a': { css: 'main article:nth-of-type(1) header span', index: 0 },
      'rate-b': { css: 'main article:nth-of-type(2) header span', index: 0 },
    },
  );
  await shot('scoreboard', '/scoreboard', (p) => region(p, { css: 'main section', index: 0 }, { css: 'main section', index: 0 }, { padTop: 2, padBottom: 2 }), null, {
    scoreboard: { css: 'main section table tbody tr td:nth-child(4) .relative', index: 0 },
  });
  await shot('history', '/scoreboard', (p) => region(p, { css: 'main section', index: 1 }, { css: 'main section', index: 1 }, { padTop: 2, padBottom: 2 }), null, {
    history: { css: 'main section svg circle', index: -1 },
  });
  await shot('regressions', '/scoreboard', (p) => region(p, { css: 'main section', index: 3 }, { css: 'main section', index: 3 }, { padTop: 2, padBottom: 2 }), null, {
    regressions: { css: 'main section a span', text: 'now fails', index: -1 },
  });
  await shot(
    'suite',
    '/suites/core-battery',
    (p) => region(p, { css: 'main .card button', text: 'Mutable default argument' }, { css: 'main .card button', text: 'Delete task' }, { padTop: 8, padBottom: 18 }),
    async (p) => {
      await p.getByRole('button', { name: /Binary search that hangs/ }).click();
      await p.waitForTimeout(300);
    },
    { suite: { css: 'main .card textarea', index: -1 } },
  );
  await shot('data', '/data', (p) => region(p, { css: 'main .grid > div' }, { css: 'main .grid > div', index: 3 }, { padTop: 2, padBottom: 2 }), null, {
    data: { css: 'main .grid div', text: 'Preference pairs', index: -1 },
  });
  writeFileSync(path.join(RAW, 'marks.json'), JSON.stringify(marks, null, 2));

  const m = await phone.newPage();
  const pshot = async (name, url, prepare) => {
    await m.goto(ORIGIN + url);
    await m.waitForLoadState('networkidle');
    await m.waitForTimeout(600);
    if (prepare) await prepare(m);
    await m.screenshot({ path: path.join(RAW, `${name}.png`) });
    console.log('captured', name);
  };
  const scrollTo = (sel, offset = 80) => async (p) => {
    await p.evaluate(
      ({ sel, offset }) => {
        const el = document.querySelector(sel);
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset);
      },
      { sel, offset },
    );
    await p.waitForTimeout(400);
  };
  await pshot('m-overview', '/');
  await pshot('m-rate', '/rate?run=6', async (p) => {
    await rateReady(p, { fill: false });
    await scrollTo('article', 76)(p);
  });
  await pshot('m-compare', '/runs/6/tasks/d02-default-arg', scrollTo('article', 76));
  await pshot('m-run', '/runs/6', scrollTo('main section', 76));
  await pshot('m-scoreboard', '/scoreboard', scrollTo('main section', 76));
  await pshot('m-history', '/scoreboard', scrollTo('main section:nth-of-type(2)', 76));
  await pshot('m-suite', '/suites/core-battery', async (p) => {
    await p.getByRole('button', { name: /Binary search that hangs/ }).click();
    await p.waitForTimeout(300);
    await scrollTo('main .card textarea:last-of-type', 260)(p);
  });
  await pshot('m-data', '/data', scrollTo('main .grid', 76));

  const board = await (await fetch(`${ORIGIN}/api/scoreboard/core-battery`)).json();
  writeFileSync(path.join(RAW, 'board.json'), JSON.stringify(board));
  await browser.close();
}

// ---------------------------------------------------------------- compose
//
// Evalbench's identity: a blind tasting for models. The plates are azure, the colour of a
// face-down card; turn one over and you see the app, printed on paper. Notes are written in white,
// and the judge's red marks appear only on the screens.

const b64 = (file) => readFileSync(file).toString('base64');
const fontFile = (pkg, file) => b64(path.join(WEB, 'node_modules', pkg, 'files', file));
const img = (name) => `data:image/png;base64,${b64(path.join(RAW, `${name}.png`))}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const C = { field: '#2457f0', deep: '#1a3fc0', paper: '#fffdf8', chalk: '#f3f0e8', ink: '#17181c', red: '#d23c2a', soft: 'rgba(255,253,248,.74)' };

const CSS = `
@font-face { font-family: Grotesk; src: url(data:font/woff2;base64,${fontFile('@fontsource-variable/schibsted-grotesk', 'schibsted-grotesk-latin-wght-normal.woff2')}) format('woff2'); font-weight: 400 900; }
@font-face { font-family: Slab; src: url(data:font/woff2;base64,${fontFile('@fontsource/zilla-slab', 'zilla-slab-latin-600-normal.woff2')}) format('woff2'); font-weight: 600; }
@font-face { font-family: Slab; src: url(data:font/woff2;base64,${fontFile('@fontsource/zilla-slab', 'zilla-slab-latin-700-normal.woff2')}) format('woff2'); font-weight: 700; }
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; }
body { font-family: Grotesk, sans-serif; color: ${C.paper}; -webkit-font-smoothing: antialiased; }
.scene { position: relative; overflow: hidden; border-radius: 8px; background: ${C.field}; }
.slab { font-family: Slab, serif; font-variant-numeric: lining-nums; }
.screen { position: absolute; border-radius: 14px; overflow: hidden; background: ${C.chalk};
  box-shadow: 0 0 0 1px rgba(10,22,70,.25), 0 2px 4px rgba(10,22,70,.18), 0 30px 50px -22px rgba(6,14,52,.55), 0 80px 120px -60px rgba(6,14,52,.6); }
.screen img { display: block; width: 100%; }
.phone { position: absolute; padding: 9px; border-radius: 46px; background: ${C.ink};
  box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.1), 0 0 0 1px rgba(10,22,70,.4), 0 34px 60px -26px rgba(6,14,52,.65), 0 80px 120px -60px rgba(6,14,52,.6); }
.phone .scr { position: relative; overflow: hidden; border-radius: 37px; background: ${C.chalk}; padding-top: 34px; }
.phone .scr img { display: block; width: 100%; }
.phone .island { position: absolute; top: 9px; left: 50%; transform: translateX(-50%); width: 92px; height: 26px; border-radius: 20px; background: #000; z-index: 2; }
.note { position: absolute; font-family: Slab, serif; font-weight: 600; color: ${C.paper}; line-height: 1.12; }
.slip { position: absolute; background: ${C.paper}; color: ${C.ink}; border-radius: 4px; padding: 22px 26px 18px;
  box-shadow: 0 1px 2px rgba(10,22,70,.2), 0 24px 40px -20px rgba(6,14,52,.6); }
svg.ink { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
`;

const MARK = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${C.paper}"/><g transform="rotate(-11 11.5 17)"><rect x="5.5" y="9" width="12" height="16.5" rx="2.4" fill="${C.field}"/></g><g transform="rotate(8 20.5 15.5)"><rect x="14.5" y="7.25" width="12" height="16.5" rx="2.4" fill="${C.ink}"/><path d="M17.4 15.6l2.5 2.6 4.4-5.3" fill="none" stroke="#ff6a55" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

const screen = ({ name, x, y, w, rotate = 0 }) =>
  `<div class="screen" style="left:${x}px;top:${y}px;width:${w}px;transform:rotate(${rotate}deg)"><img src="${img(name)}"></div>`;
const phoneEl = ({ name, x, y, w, rotate = 0 }) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;transform:rotate(${rotate}deg)"><div class="scr"><div class="island"></div><img src="${img(name)}"></div></div>`;

/** A pen stroke in white: a gently bowed line with an open arrowhead. */
function arrow(x1, y1, x2, y2, bow = 0.18) {
  const mx = (x1 + x2) / 2 - (y2 - y1) * bow;
  const my = (y1 + y2) / 2 + (x2 - x1) * bow;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const h = 14;
  const a1 = [x2 - h * Math.cos(ang - 0.45), y2 - h * Math.sin(ang - 0.45)];
  const a2 = [x2 - h * Math.cos(ang + 0.45), y2 - h * Math.sin(ang + 0.45)];
  const stroke = (c, w) =>
    `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/><path d="M${a1[0]},${a1[1]} L${x2},${y2} L${a2[0]},${a2[1]}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return stroke('rgba(6,14,52,.35)', 6) + stroke(C.paper, 2.8);
}

/** The judge's red loop, not quite closed, the way a pen does it. */
function ring(cx, cy, rx, ry, color = C.red) {
  const pts = [];
  for (let i = 0; i <= 26; i++) {
    const t = -0.5 + (i / 26) * (Math.PI * 2 + 0.35);
    const wob = 1.8 * Math.sin(i * 1.7);
    pts.push(`${(cx + (rx + wob) * Math.cos(t)).toFixed(1)},${(cy + (ry + wob) * Math.sin(t)).toFixed(1)}`);
  }
  return `<path d="M${pts.join(' L')}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A pen underline in red, slightly uneven, under a wide target. */
function under(x1, x2, y) {
  const mid = (x1 + x2) / 2;
  return `<path d="M${x1},${y + 1} C${x1 + (mid - x1) * 0.5},${y + 4} ${mid},${y - 2} ${mid + (x2 - mid) * 0.3},${y + 1} S${x2 - 10},${y + 3} ${x2},${y - 1}" fill="none" stroke="${C.red}" stroke-width="3.6" stroke-linecap="round"/>`;
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

/** A feature plate: the real screen across the field, the note in the margin nearest its target. */
async function feature(browser, file, { desk, phone, note, mark = desk, maxScale = 1.35, style = 'ring', pointer = true }) {
  const W = 1400;
  const pad = 70;
  const margin = 176;
  const ds = await size(desk);
  const winW = Math.min(W - pad * 2, ds.w * maxScale);
  const scale = winW / ds.w;
  const winH = ds.h * scale;
  const m = marks()[mark];
  const winX = (W - winW) / 2;
  const above = m.y + m.h / 2 < ds.h / 2;
  const winY = above ? margin : pad;
  const H = Math.round(winY + winH + (above ? pad : margin));
  const tx = winX + m.x * scale;
  const ty = winY + m.y * scale;
  const tw = m.w * scale;
  const th = m.h * scale;
  const cx = tx + tw / 2;
  const cy = ty + th / 2;
  const noteW = 620;
  const noteX = Math.max(pad, Math.min(W - pad - noteW, cx - noteW * 0.6));
  const noteY = above ? 56 : winY + winH + 52;
  const startX = Math.min(noteX + noteW + 14, Math.max(noteX - 14, cx + (cx > noteX + noteW / 2 ? -40 : 40)));
  const fromY = above ? noteY + 50 : noteY - 14;
  // The stroke stops at the screen's edge, so it never crosses the UI; the mark inside does the rest.
  const toY = above ? winY - 12 : winY + winH + 12;
  const markSvg = style === 'underline' ? under(tx + 2, tx + tw - 2, ty + th + 7) : style === 'none' ? '' : ring(cx, cy, tw / 2 + 12, th / 2 + 9);
  const html = `<div class="scene" style="width:${W}px;height:${H}px">
    ${screen({ name: desk, x: winX, y: winY, w: winW })}
    <div class="note" style="left:${noteX}px;top:${noteY}px;width:${noteW}px;font-size:32px">${note}</div>
    <svg class="ink" width="${W}" height="${H}">${markSvg}${pointer ? arrow(startX, fromY, cx, toY, startX < cx ? 0.2 : -0.2) : ''}</svg>
  </div>`;
  await render(browser, file, html, W, H);

  // Portrait for phones: the note on top, the phone below it.
  const MW = 720;
  const pw = 350;
  const ps = await size(phone);
  const ph = 18 + 34 + ((pw - 18) * ps.h) / ps.w;
  const MH = Math.round(ph + 250);
  const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px">
    <div class="note" style="left:56px;top:54px;width:${MW - 112}px;font-size:36px">${note}</div>
    ${phoneEl({ name: phone, x: (MW - pw) / 2 + 30, y: 190, w: pw, rotate: 2.5 })}
  </div>`;
  await render(browser, `${file}-mobile`, mHtml, MW, MH);
}

function scoreSlip(board, { width = 420 } = {}) {
  const rows = board.models
    .map(
      (m, i) => `<div style="display:grid;grid-template-columns:24px 1fr 70px 70px;align-items:baseline;padding:9px 0;border-top:1px solid #e6e0d3">
        <span class="slab" style="font-size:17px;color:#9c988f">${i + 1}</span>
        <span style="font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px"><span style="width:9px;height:9px;border-radius:50%;background:${m.color}"></span>${esc(m.label)}</span>
        <span class="slab" style="font-size:24px;text-align:right">${Math.round(m.auto.pass_rate * 100)}%</span>
        <span class="slab" style="font-size:24px;text-align:right;color:#3d3e44">${Math.round(m.human.rating)}</span></div>`,
    )
    .join('');
  return `<div style="width:${width}px">
    <div style="display:grid;grid-template-columns:24px 1fr 70px 70px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#9c988f;padding-bottom:8px">
      <span></span><span>CORE BATTERY, RUN 6</span><span style="text-align:right">CHECKS</span><span style="text-align:right">JUDGES</span></div>${rows}</div>`;
}

const underline = (w = 6) =>
  `<svg viewBox="0 0 100 12" preserveAspectRatio="none" style="position:absolute;left:-2%;bottom:-0.15em;width:104%;height:0.16em;overflow:visible"><path d="M1,7 C25,10 60,4 99,6" fill="none" stroke="${C.red}" vector-effect="non-scaling-stroke" stroke-linecap="round" style="stroke-width:${w}px"/></svg>`;

async function compose() {
  const browser = await launch();
  const board = JSON.parse(readFileSync(path.join(RAW, 'board.json'), 'utf8'));
  board.models = board.models.filter((m) => m.auto && m.human);
  const mk = marks();

  // Hero: the claim across the top; beneath it, the scorecard slip and the judging screen.
  {
    const W = 1400;
    const rs = await size('rate');
    const sw = 780;
    const k = sw / rs.w;
    const sh = rs.h * k;
    const sx = 548;
    const sy = 420;
    const rot = 1.8;
    const H = Math.round(Math.max(sy + sh + 80, 1040));
    const ringAt = (m) => ring(sx + (m.x + m.w / 2) * k, sy + (m.y + m.h / 2) * k, (m.w * k) / 2 + 7, (m.h * k) / 2 + 6);
    const html = `<div class="scene" style="width:${W}px;height:${H}px">
      <div style="position:absolute;left:84px;top:76px;display:flex;align-items:center;gap:14px;font-size:27px;font-weight:700;letter-spacing:-.015em">${MARK(40)} Evalbench</div>
      <div style="position:absolute;left:80px;top:160px;font-size:112px;font-weight:800;letter-spacing:-.052em;line-height:.9;white-space:nowrap">Judge the answer,<br>not the <span style="position:relative;display:inline-block">name.${underline(7)}</span></div>
      <div style="position:absolute;left:84px;top:${sy + 4}px;width:400px;font-size:21px;line-height:1.45;color:${C.soft}">A self-hosted workbench for testing language models on your own tasks: any model, every answer graded, and blind verdicts from people.</div>
      <div class="slip" style="left:84px;top:${sy + 210}px;transform:rotate(-1.6deg)">${scoreSlip(board, { width: 376 })}</div>
      ${screen({ name: 'rate', x: sx, y: sy, w: sw, rotate: rot })}
      <svg class="ink" width="${W}" height="${H}" style="transform-origin:${sx + sw / 2}px ${sy + sh / 2}px;transform:rotate(${rot}deg)">${ringAt(mk['rate-a'])}${ringAt(mk['rate-b'])}</svg>
    </div>`;
    await render(browser, 'hero', html, W, H);

    const MW = 720;
    const MH = 1420;
    const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px">
      <div style="position:absolute;left:54px;top:58px;display:flex;align-items:center;gap:12px;font-size:25px;font-weight:700">${MARK(36)} Evalbench</div>
      <div style="position:absolute;left:50px;top:140px;width:620px;font-size:80px;font-weight:800;letter-spacing:-.05em;line-height:.92">Judge the answer, not the <span style="position:relative;display:inline-block">name.${underline(6)}</span></div>
      <div style="position:absolute;left:54px;top:380px;width:600px;font-size:20px;line-height:1.45;color:${C.soft}">Any model, every answer graded, blind verdicts from people. Self-hosted.</div>
      ${phoneEl({ name: 'm-rate', x: 175, y: 500, w: 370, rotate: 2.5 })}
    </div>`;
    await render(browser, 'hero-mobile', mHtml, MW, MH);
  }

  // The numbers, set large on the field. Every figure is a fact of the code (see README "Quality").
  {
    const items = [
      ['20', 'battery tasks', 'reasoning, constraints, debugging'],
      ['7', 'check types', 'exact match to Python tests'],
      ['3', 'provider kinds', 'Anthropic, OpenAI, compatible'],
      ['4', 'export formats', 'CSV, JSONL, DPO pairs, results'],
      ['0', 'keys stored', 'read from the environment'],
    ];
    const W = 1400;
    const H = 320;
    const col = (W - 168) / items.length;
    const cells = items
      .map(
        ([n, l, c], i) => `<div style="position:absolute;left:${84 + i * col}px;top:76px;width:${col}px;padding-left:${i ? 28 : 0}px;${i ? 'border-left:1px solid rgba(255,253,248,.28);' : ''}height:176px">
          <div class="slab" style="font-size:92px;font-weight:700;line-height:.86;letter-spacing:-.02em">${n}</div>
          <div style="font-size:20px;font-weight:700;margin-top:20px">${l}</div>
          <div style="font-size:15.5px;color:${C.soft};margin-top:5px">${c}</div></div>`,
      )
      .join('');
    const zx = 84 + 4 * col + 28;
    const html = `<div class="scene" style="width:${W}px;height:${H}px">${cells}<svg class="ink" width="${W}" height="${H}">${ring(zx + 27, 112, 44, 50, C.paper)}</svg></div>`;
    await render(browser, 'numbers', html, W, H);
    const MW = 720;
    const MH = 800;
    const mCells = items
      .map(
        ([n, l, c], i) => `<div style="position:absolute;left:${58 + (i % 2) * 320}px;top:${62 + Math.floor(i / 2) * 240}px;width:290px">
          <div class="slab" style="font-size:84px;font-weight:700;line-height:.86">${n}</div>
          <div style="font-size:20px;font-weight:700;margin-top:16px">${l}</div>
          <div style="font-size:15.5px;color:${C.soft};margin-top:4px">${c}</div></div>`,
      )
      .join('');
    const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px">${mCells}<svg class="ink" width="${MW}" height="${MH}">${ring(84, 62 + 2 * 240 + 36, 46, 50, C.paper)}</svg></div>`;
    await render(browser, 'numbers-mobile', mHtml, MW, MH);
  }

  await feature(browser, 'overview', { desk: 'overview', phone: 'm-overview', note: 'It writes the headline for you, from the latest run.', maxScale: 1.05, style: 'underline', pointer: false });
  await feature(browser, 'write', { desk: 'suite', phone: 'm-suite', note: 'Your tests run against the answer’s code, in a box with no way out.', style: 'underline' });
  await feature(browser, 'run', { desk: 'run', phone: 'm-run', note: 'Every square is a verdict. Click one for the reason.' });
  await feature(browser, 'compare', { desk: 'compare', phone: 'm-compare', note: 'Not just red: the exact rule it broke.' });
  await feature(browser, 'rate', { desk: 'rate', phone: 'm-rate', note: 'Seven stops, from “A, clearly” to “B, clearly”. The red loop is yours.', style: 'none' });
  await feature(browser, 'scoreboard', { desk: 'scoreboard', phone: 'm-scoreboard', note: 'A lead inside the interval is not a lead.' });
  await feature(browser, 'history', { desk: 'history', phone: 'm-history', note: 'Run 6: the re-quantised model drops, and the chart says so.' });
  await feature(browser, 'regressions', { desk: 'regressions', phone: 'm-history', note: 'The day it breaks, not the week after.' });
  await feature(browser, 'data', { desk: 'data', phone: 'm-data', note: 'Every decisive verdict, ready to train on.' });

  // Social preview, 1280x640.
  {
    const html = `<div class="scene" style="width:1280px;height:640px;border-radius:0">
      <div style="position:absolute;left:80px;top:72px;display:flex;align-items:center;gap:14px;font-size:28px;font-weight:700">${MARK(42)} Evalbench</div>
      <div style="position:absolute;left:76px;top:170px;width:560px;font-size:86px;font-weight:800;letter-spacing:-.05em;line-height:.92">Judge the answer, not the <span style="position:relative;display:inline-block">name.${underline(6)}</span></div>
      <div style="position:absolute;left:80px;top:500px;width:470px;font-size:23px;line-height:1.4;color:${C.soft}">Self-hosted LLM evaluation: checks, blind verdicts, regressions.</div>
      ${screen({ name: 'rate', x: 650, y: 70, w: 700, rotate: 2.2 })}
    </div>`;
    await render(browser, 'social', html, 1280, 640);
  }
  await browser.close();
}

if (!COMPOSE_ONLY) await capture();
if (!existsSync(path.join(RAW, 'marks.json'))) throw new Error('no captures: run without --compose first');
await compose();
