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
  const shot = async (name, url, clip, prepare) => {
    await d.setViewportSize({ width: 1280, height: 860 });
    await d.goto(ORIGIN + url);
    await d.waitForLoadState('networkidle');
    if (prepare) await prepare(d);
    await settle(d);
    const box = typeof clip === 'function' ? await clip(d) : clip;
    await d.screenshot({ path: path.join(RAW, `${name}.png`), clip: box ?? undefined });
    console.log('captured', name);
  };

  await shot('overview', '/', { x: 0, y: 0, width: 1280, height: 820 });
  await shot('run', '/runs/6', (p) => region(p, { css: 'main h1' }, { css: 'tbody tr', index: 12 }, { padTop: 70, padBottom: 14 }));
  await shot('compare', '/runs/6/tasks/c04-summary', (p) => region(p, { css: 'main h1' }, { css: 'article', index: 3 }, { padTop: 48, padBottom: 16 }));
  await shot('rate', '/rate?run=6', (p) => region(p, { css: 'main section' }, { css: 'main section', index: 1 }, { padTop: 16, padBottom: 16 }), (p) => rateReady(p, { fill: true }));
  await shot('scoreboard', '/scoreboard', (p) => region(p, { css: 'main section' }, { css: 'main section', index: 2 }, { padTop: 16, padBottom: 16 }));
  await shot('regressions', '/scoreboard', (p) => region(p, { css: 'main section', index: 3 }, { css: 'main section', index: 4 }, { padTop: 16, padBottom: 16 }));
  await shot(
    'suite',
    '/suites/core-battery',
    (p) => region(p, { css: 'main .card button', text: 'Mutable default argument' }, { css: 'main .card button', text: 'Delete task' }, { padTop: 8, padBottom: 18 }),
    async (p) => {
      await p.getByRole('button', { name: /Binary search that hangs/ }).click();
      await p.waitForTimeout(300);
    },
  );
  await shot('data', '/data', (p) => region(p, { css: 'main h1' }, { css: 'main .grid > div', index: 3 }, { padTop: 40, padBottom: 16 }));
  await shot('models', '/models', (p) => region(p, { css: 'main h1' }, { css: 'main .card', index: 2 }, { padTop: 40, padBottom: 16 }));

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
  const yaml = await (await fetch(`${ORIGIN}/api/suites/core-battery/yaml`)).text();
  writeFileSync(path.join(RAW, 'suite.yaml'), yaml);
  await browser.close();
}

// ---------------------------------------------------------------- compose

const b64 = (file) => readFileSync(file).toString('base64');
const font = (pkg, file) => b64(path.join(WEB, 'node_modules/@fontsource-variable', pkg, 'files', file));
const img = (name) => `data:image/png;base64,${b64(path.join(RAW, `${name}.png`))}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ACCENT = '#4da3ff';
const CSS = `
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font('inter', 'inter-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: JBM; src: url(data:font/woff2;base64,${font('jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 800; }
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; }
body { font-family: Inter, sans-serif; font-variant-ligatures: none; color: #eef1f5; -webkit-font-smoothing: antialiased; font-feature-settings: 'cv11', 'ss01', 'ss03'; }
.scene { position: relative; overflow: hidden; border-radius: 28px; border: 1px solid #ffffff14;
  background:
    radial-gradient(var(--gw, 1000px) var(--gh, 560px) at var(--gx, 50%) var(--gy, -10%), rgba(77,163,255,.20), transparent 70%),
    radial-gradient(700px 460px at var(--ax, 105%) var(--ay, 110%), rgba(77,163,255,.06), transparent 70%),
    linear-gradient(180deg, #0b0f14, #07090c); }
.scene::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,.065) 1.2px, transparent 1.6px); background-size: 28px 28px;
  -webkit-mask-image: radial-gradient(var(--gw, 1000px) var(--gh, 560px) at var(--gx, 50%) var(--gy, -10%), #000, transparent 75%); }
.win { position: absolute; border-radius: 14px; overflow: hidden; background: #0a0c0f;
  box-shadow: 0 0 0 1px #ffffff1c, 0 40px 90px -30px rgba(0,0,0,.9), 0 18px 40px -18px rgba(0,0,0,.7); }
.win .bar { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #12151a; border-bottom: 1px solid #ffffff10; }
.win .bar i { width: 11px; height: 11px; border-radius: 50%; background: #2b3038; }
.win .bar .url { margin-left: 14px; flex: 1; max-width: 360px; height: 20px; border-radius: 6px; background: #0b0d10; border: 1px solid #ffffff0f;
  font: 500 11px JBM, monospace; color: #6b7484; display: flex; align-items: center; padding: 0 10px; }
.win img { display: block; width: 100%; }
.phone { position: absolute; padding: 9px; border-radius: 46px;
  background: linear-gradient(150deg, #2c3037, #17191d 38%, #0e1013);
  box-shadow: 0 0 0 1px #000, inset 0 0 0 1.5px rgba(255,255,255,.11), 0 50px 90px -30px rgba(0,0,0,.9), 0 20px 40px -20px rgba(0,0,0,.65); }
.phone .scr { position: relative; overflow: hidden; border-radius: 37px; background: #0c0e12; padding-top: 34px; }
.phone .scr img { display: block; width: 100%; }
.phone .island { position: absolute; top: 9px; left: 50%; transform: translateX(-50%); width: 92px; height: 26px; border-radius: 20px; background: #000; z-index: 2; }
.brand { display: flex; align-items: center; gap: 12px; font-weight: 600; letter-spacing: -.01em; }
.h1 { font-weight: 700; letter-spacing: -.035em; line-height: 1.02; }
.h1 em { font-style: normal; color: ${ACCENT}; }
.sub { color: #9aa3b2; letter-spacing: -.005em; }
.pill { display: inline-flex; align-items: center; gap: 10px; height: 46px; padding: 0 20px; border-radius: 999px; font-weight: 600; font-size: 16px; }
.pill.primary { background: ${ACCENT}; color: #04111f; box-shadow: 0 10px 30px -10px #4da3ffaa, inset 0 1px 0 #ffffff66; }
.pill.ghost { border: 1px solid #ffffff24; color: #d9dee7; background: #ffffff08; font-family: JBM, monospace; font-weight: 500; font-size: 14.5px; }
.code { position: absolute; border-radius: 14px; background: #0b0e12; border: 1px solid #ffffff1a; padding: 0 0 16px;
  box-shadow: 0 40px 80px -30px rgba(0,0,0,.95); font: 500 12.5px/1.7 JBM, monospace; color: #cfd8e6; overflow: hidden; }
.code .bar { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid #ffffff10; background: #12151a; margin-bottom: 12px; }
.code .bar i { width: 11px; height: 11px; border-radius: 50%; background: #2b3038; }
.code .bar span { margin-left: 10px; color: #6b7484; font-size: 11px; }
.code pre { padding: 0 18px; white-space: pre; font: inherit; }
.k { color: #8cc4ff; } .s { color: #cfd8e6; } .n { color: #f4b66a; } .c { color: #5e6676; } .p { color: #6b7484; } .g { color: #9fd88a; } .a { color: ${ACCENT}; }
`;

const LOGO = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><defs><linearGradient id="lg${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6cb6ff"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg${size})"/><rect x="7.5" y="16" width="4" height="9" rx="2" fill="#fff" fill-opacity=".55"/><rect x="14" y="11" width="4" height="14" rx="2" fill="#fff" fill-opacity=".8"/><rect x="20.5" y="6.5" width="4" height="18.5" rx="2" fill="#fff"/></svg>`;

const win = ({ name, x, y, w, url = 'localhost:8484' }) =>
  `<div class="win" style="left:${x}px;top:${y}px;width:${w}px"><div class="bar"><i></i><i></i><i></i><div class="url">${url}</div></div><img src="${img(name)}"></div>`;
const phoneEl = ({ name, x, y, w }) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px"><div class="scr"><div class="island"></div><img src="${img(name)}"></div></div>`;

async function size(name) {
  const meta = await sharp(path.join(RAW, `${name}.png`)).metadata();
  return { w: meta.width, h: meta.height };
}

async function render(browser, file, html, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`;
  writeFileSync(path.join(SRC, `${file}.html`), doc.replace(/data:[^"')]+/g, 'data:…'));
  await page.setContent(doc, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator('.scene').screenshot({ omitBackground: true });
  await page.close();
  if (file === 'social') {
    await sharp(png).resize(1280, 640).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'social.png'));
  } else {
    await sharp(png).webp({ quality: 86, effort: 6 }).toFile(path.join(OUT, `${file}.webp`));
  }
  console.log('composed', file);
}

/** A feature scene: the desktop capture in a browser window, with a phone or a code card beside it
 *  (never on top of it, so nothing in the capture is hidden). */
async function feature(browser, file, { desk, phone = null, card = null, url, side = 'right' }) {
  const W = 1400;
  const pad = 60;
  const gap = 36;
  const ds = await size(desk);
  const sideW = phone ? 272 : card ? card.w : 0;
  const winW = W - pad * 2 - (sideW ? sideW + gap : 0);
  const winH = 34 + (winW * ds.h) / ds.w;
  let sideH = 0;
  if (phone) {
    const ps = await size(phone);
    sideH = 18 + 34 + ((sideW - 18) * ps.h) / ps.w;
  } else if (card) sideH = card.h;
  const H = Math.round(Math.max(winH, sideH) + pad * 2);
  const winX = side === 'left' && sideW ? pad + sideW + gap : pad;
  const winY = pad + Math.max(0, (sideH - winH) / 2);
  const sideX = side === 'left' ? pad : W - pad - sideW;
  const sideY = pad + Math.max(0, (winH - sideH) / 2);
  const parts = [win({ name: desk, x: winX, y: winY, w: winW, url })];
  if (phone) parts.push(phoneEl({ name: phone, x: sideX, y: sideY, w: sideW }));
  if (card) parts.push(codeCard(card.title, card.body, sideX, sideY, sideW, card.h));
  const html = `<div class="scene" style="width:${W}px;height:${H}px;--gw:1100px;--gx:${side === 'left' ? '62%' : '38%'};--gy:-14%">${parts.join('')}</div>`;
  await render(browser, file, html, W, H);

  // Portrait version for phones: the phone capture, framed, with the window faint behind it.
  const mobile = phone ?? card?.phone;
  if (!mobile) return;
  const MW = 620;
  const mPhoneW = 330;
  const mps = await size(mobile);
  const mPhoneH = 18 + 34 + ((mPhoneW - 18) * mps.h) / mps.w;
  const MH = Math.round(mPhoneH + 120);
  const backW = 560;
  const back = win({ name: desk, x: (MW - backW) / 2, y: 46, w: backW, url });
  const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px;--gw:700px;--gh:520px;--gx:50%;--gy:-6%">
    <div style="position:absolute;inset:0;opacity:.3;filter:saturate(.7)">${back}</div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 0%,#07090ccc 55%)"></div>
    ${phoneEl({ name: mobile, x: (MW - mPhoneW) / 2, y: 70, w: mPhoneW })}</div>`;
  await render(browser, `${file}-mobile`, mHtml, MW, MH);
}

const codeCard = (title, body, x, y, w, h) =>
  `<div class="code" style="left:${x}px;top:${y}px;width:${w}px;${h ? `height:${h}px;` : ''}"><div class="bar"><i></i><i></i><i></i><span>${title}</span></div><pre>${body}</pre></div>`;
const clipLine = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function yamlSnippet(yaml, taskId) {
  const start = yaml.indexOf(`- id: ${taskId}`);
  const rest = yaml.slice(start);
  const next = rest.slice(5).search(/\n\s*- id: /);
  const block = (next > 0 ? rest.slice(0, next + 5) : rest).trimEnd();
  const indent = block.split('\n')[1]?.match(/^\s*/)[0].length - 2 || 0;
  return block
    .split('\n')
    .map((line) => clipLine(line.slice(Math.min(indent, line.match(/^\s*/)[0].length)), 52))
    .map((line) => {
      const m = line.match(/^(\s*-?\s*)([\w_]+)(:)(.*)$/);
      if (!m) return `<span class="s">${esc(line)}</span>`;
      const value = m[4].trim();
      const v = /^-?\d+(\.\d+)?$/.test(value) ? `<span class="n">${esc(m[4])}</span>` : `<span class="s">${esc(m[4])}</span>`;
      return `${esc(m[1])}<span class="k">${m[2]}</span><span class="p">:</span>${v}`;
    })
    .join('\n');
}

function jsonSnippet(line) {
  const o = JSON.parse(line);
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\n/g, '\\n');
  const kv = (k, v, last = false) => `  <span class="k">"${k}"</span><span class="p">:</span> ${v}${last ? '' : '<span class="p">,</span>'}`;
  const str = (s, n = 30) => `<span class="g">"${esc(cut(s, n))}"</span>`;
  return [
    '<span class="p">{</span>',
    kv('prompt', str(o.prompt)),
    kv('chosen', str(o.chosen)),
    kv('rejected', str(o.rejected)),
    `  <span class="k">"meta"</span><span class="p">: {</span>`,
    `    <span class="k">"chosen_model"</span><span class="p">:</span> ${str(o.meta.chosen_model)}<span class="p">,</span>`,
    `    <span class="k">"rejected_model"</span><span class="p">:</span> ${str(o.meta.rejected_model)}<span class="p">,</span>`,
    `    <span class="k">"strength"</span><span class="p">:</span> <span class="n">${o.meta.strength}</span><span class="p">,</span>`,
    `    <span class="k">"justification"</span><span class="p">:</span> ${str(o.meta.justification, 22)}`,
    '  <span class="p">}</span>',
    '<span class="p">}</span>',
  ].join('\n');
}

async function compose() {
  const browser = await launch();

  // Hero
  {
    const W = 1200;
    const H = 1130;
    const winW = 960;
    const html = `<div class="scene" style="width:${W}px;height:${H}px;--gw:1100px;--gh:620px;--gy:-8%">
      <div style="position:absolute;top:58px;left:0;right:0;text-align:center">
        <div class="brand" style="justify-content:center;font-size:27px">${LOGO(40)} Evalbench</div>
        <div class="h1" style="font-size:66px;margin-top:30px">Know which model is <em>actually better.</em></div>
        <div class="sub" style="font-size:21px;margin-top:20px">Tasks and rubrics, local and API models, automatic checks and blind human rating,<br>scored over time. Self-hosted, one compose file.</div>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:30px">
          <span class="pill primary">Open source · MIT</span>
          <span class="pill ghost">$ docker compose up -d</span>
        </div>
      </div>
      ${win({ name: 'overview', x: 60, y: 420, w: winW })}
      ${phoneEl({ name: 'm-rate', x: W - 60 - 262, y: 560, w: 262 })}
    </div>`;
    await render(browser, 'hero', html, W, H);
    const MW = 620;
    const MH = 1120;
    const mHtml = `<div class="scene" style="width:${MW}px;height:${MH}px;--gw:700px;--gh:560px;--gy:-6%">
      <div style="position:absolute;top:48px;left:28px;right:28px;text-align:center">
        <div class="brand" style="justify-content:center;font-size:22px">${LOGO(34)} Evalbench</div>
        <div class="h1" style="font-size:46px;margin-top:22px">Know which model is <em>actually better.</em></div>
        <div class="sub" style="font-size:17px;margin-top:14px;line-height:1.45">Checks, blind human rating and scores over time, self-hosted.</div>
      </div>
      ${phoneEl({ name: 'm-overview', x: (MW - 330) / 2, y: 330, w: 330 })}
    </div>`;
    await render(browser, 'hero-mobile', mHtml, MW, MH);
  }

  // Numbers banner (every figure comes from the code; see README "Quality")
  {
    const items = [
      ['20', 'Battery tasks', 'reasoning, constraints, debugging'],
      ['7', 'Check types', 'from exact match to Python tests'],
      ['3', 'Provider kinds', 'Anthropic, OpenAI, any compatible'],
      ['4', 'Export formats', 'CSV, JSONL, DPO pairs, results'],
      ['0', 'Keys stored', 'read from the environment'],
    ];
    const cell = ([n, l, c], i, accentLast) =>
      `<div style="flex:1;padding:0 26px;${i ? 'border-left:1px solid #ffffff10;' : ''}">
        <div style="font-size:54px;font-weight:700;letter-spacing:-.03em;line-height:1;${accentLast && i === items.length - 1 ? `color:${ACCENT}` : ''}">${n}</div>
        <div style="font-size:18px;font-weight:600;margin-top:16px">${l}</div>
        <div style="font-size:14.5px;color:#8a93a3;margin-top:6px">${c}</div></div>`;
    const html = `<div class="scene" style="width:1200px;height:270px;--gw:900px;--gh:300px;--gy:-40%;--gx:30%;display:flex;align-items:center;padding:0 22px">${items.map((it, i) => cell(it, i, true)).join('')}</div>`;
    await render(browser, 'numbers', html, 1200, 270);
    const mHtml = `<div class="scene" style="width:620px;height:600px;--gw:600px;--gh:300px;--gy:-20%;padding:44px 36px;display:grid;grid-template-columns:1fr 1fr;gap:34px 26px;align-content:center">
      ${items
        .map(
          ([n, l, c], i) =>
            `<div style="${i === 4 ? 'grid-column:1 / -1' : ''}"><div style="font-size:46px;font-weight:700;letter-spacing:-.03em;line-height:1;${i === 4 ? `color:${ACCENT}` : ''}">${n}</div><div style="font-size:17px;font-weight:600;margin-top:12px">${l}</div><div style="font-size:14px;color:#8a93a3;margin-top:4px">${c}</div></div>`,
        )
        .join('')}</div>`;
    await render(browser, 'numbers-mobile', mHtml, 620, 600);
  }

  // Feature scenes
  const yaml = readFileSync(path.join(RAW, 'suite.yaml'), 'utf8');
  const pref = readFileSync(path.join(RAW, 'preference.json'), 'utf8');
  const yamlBody = yamlSnippet(yaml, 'd03-binary-search');
  await feature(browser, 'write', {
    desk: 'suite',
    url: 'localhost:8484/suites/core-battery',
    card: { title: 'core-battery.yaml', body: yamlBody, w: 440, h: 70 + yamlBody.split('\n').length * 21.25, phone: 'm-suite' },
  });
  await feature(browser, 'run', { desk: 'run', phone: 'm-run', url: 'localhost:8484/runs/6' });
  await feature(browser, 'compare', { desk: 'compare', phone: 'm-compare', url: 'localhost:8484/runs/6/tasks/c04-summary', side: 'left' });
  await feature(browser, 'rate', { desk: 'rate', phone: 'm-rate', url: 'localhost:8484/rate?run=6' });
  await feature(browser, 'scoreboard', { desk: 'scoreboard', phone: 'm-scoreboard', url: 'localhost:8484/scoreboard', side: 'left' });
  await feature(browser, 'regressions', { desk: 'regressions', phone: 'm-regressions', url: 'localhost:8484/scoreboard' });
  const prefBody = jsonSnippet(pref);
  await feature(browser, 'data', {
    desk: 'data',
    url: 'localhost:8484/data',
    card: { title: 'curl …/api/export/preferences.jsonl', body: prefBody, w: 470, h: 70 + prefBody.split('\n').length * 21.25, phone: 'm-data' },
  });

  // Social preview, 1280x640
  {
    const html = `<div class="scene" style="width:1280px;height:640px;border-radius:0;--gw:1000px;--gh:600px;--gx:24%;--gy:-20%">
      <div style="position:absolute;left:84px;top:96px;width:560px">
        <div class="brand" style="font-size:34px">${LOGO(52)} Evalbench</div>
        <div class="h1" style="font-size:64px;margin-top:40px">Know which model is <em>actually better.</em></div>
        <div class="sub" style="font-size:24px;margin-top:26px;line-height:1.4">Checks, blind human rating and regression tracking. Self-hosted.</div>
      </div>
      ${phoneEl({ name: 'm-rate', x: 760, y: 70, w: 300 })}
      <div style="position:absolute;left:1000px;top:250px;width:220px;opacity:.9">${phoneEl({ name: 'm-scoreboard', x: 0, y: 0, w: 230 }).replace('position:absolute;', '')}</div>
    </div>`;
    await render(browser, 'social', html, 1280, 640);
  }
  await browser.close();
}

if (!COMPOSE_ONLY) await capture();
if (!existsSync(path.join(RAW, 'overview.png'))) throw new Error('no captures: run without --compose first');
await compose();
