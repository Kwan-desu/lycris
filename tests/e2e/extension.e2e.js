// Optional E2E: loads the unpacked extension into Chromium against a mocked music.youtube.com.
// All network traffic is intercepted (page routes + a stubbed fetch in the service worker),
// so nothing leaves the machine.
//   npm i --no-save playwright-core@1.48.2 && npx playwright-core install chromium
//   CHROME_PATH=/path/to/chrome npm run test:e2e   (CHROME_PATH optional if Playwright's Chromium is installed)
const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXT = path.resolve(__dirname, '..', '..');
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dir = fs.existsSync(base) && fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  if (!dir) throw new Error('Set CHROME_PATH or run: npx playwright-core install chromium');
  return path.join(base, dir, 'chrome-linux64', 'chrome');
}
const CHROME = findChrome();

const LRC = '[00:00.00]空に歌う\n[00:02.00]second line here\n[00:04.00]third line\n' +
  Array.from({ length: 30 }, (_, i) => `[00:${String(6 + i * 2).padStart(2, '0')}.00]filler ${i}`).join('\n');

const PAGE = `<!doctype html><html><body style="background:#000;height:900px">
<ytmusic-app>
<ytmusic-player-page id="player-page" player-ui-state="PLAYER_PAGE_OPEN">
  <div id="main-panel" style="width:800px;height:450px;position:relative">
    <ytmusic-player id="player" style="display:block;width:800px;height:450px;position:relative">
      <div id="song-image"><img id="img" src="data:image/gif;base64,R0lGODlhAQABAIAAAP8AAP///ywAAAAAAQABAAACAkQBADs=" width="300" height="300"></div>
    </ytmusic-player>
  </div>
  <div id="side-panel" style="position:absolute;left:820px;top:0;width:500px;height:700px">
    <tp-yt-paper-tabs>
      <tp-yt-paper-tab tab-id="FEmusic_up_next">Up next</tp-yt-paper-tab>
      <tp-yt-paper-tab tab-id="FEmusic_lyrics" class="iron-selected" aria-selected="true">Lyrics</tp-yt-paper-tab>
    </tp-yt-paper-tabs>
  </div>
</ytmusic-player-page>
<ytmusic-player-bar style="position:fixed;bottom:0;left:0;right:0;height:72px">
  <div class="title">空に歌う</div><div class="byline">Test Artist</div>
  <div class="right-controls-buttons"></div>
</ytmusic-player-bar>
</ytmusic-app>
<video id="v" src="__WAV__" preload="auto"></video>
<script>
  // Real media (silent WAV) so currentTime / duration / seeked are native and visible to the
  // content script's isolated world. Kept paused; tests drive time by seeking.
  const v = document.getElementById('v');
  </script>
</body></html>`;

function silentWav(seconds, rate = 4000) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
const WAV = silentWav(60);
const WAV_URI = 'data:audio/wav;base64,' + WAV.toString('base64');

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyris-prof-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox']
  });
  const results = [];
  const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

  // Block every real network call; answer LRCLIB with our fixture, everything else 404.
  const external = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url === 'https://music.youtube.com/silence.wav') return route.fulfill({ contentType: 'audio/wav', body: WAV });
    if (url.startsWith('https://music.youtube.com/')) return route.fulfill({ contentType: 'text/html', body: PAGE.replace('__WAV__', WAV_URI) });
    if (url.includes('lrclib.net/api/get')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ syncedLyrics: LRC }) });
    if (url.startsWith('chrome-extension://') || url.startsWith('data:')) return route.continue();
    external.push(url);
    return route.fulfill({ status: 404, body: '' });
  });

  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  // Service-worker fetches bypass context routing, so stub fetch inside the worker itself.
  await sw.evaluate((lrc) => {
    self.__fetched = [];
    self.fetch = async (url) => {
      url = String(url);
      self.__fetched.push(url);
      if (url.includes('lrclib.net/api/get')) {
        return new Response(JSON.stringify({ syncedLyrics: lrc }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    };
  }, LRC);
  check('service worker boots', Boolean(sw));

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('https://music.youtube.com/watch?v=test');

  await page.waitForSelector('#lyris-lyrics-btn', { timeout: 10000 });
  await page.waitForSelector('#lyris-settings-btn');
  const iconSizes = await page.$$eval('.lyris-player-btn svg', s => s.map(x => x.getAttribute('width')));
  check('player-bar buttons injected with 20px SVGs', iconSizes.length === 2 && iconSizes.every(w => w === '20'));

  await page.waitForSelector('.lyris-line[data-index="0"]', { state: 'attached', timeout: 15000 });
  const lineCount = await page.$$eval('.lyris-line[data-index]', l => l.length);
  check('synced lyrics fetched via background waterfall and rendered', lineCount === 33, `lines=${lineCount}`);

  const ruby = await page.$eval('.lyris-line[data-index="0"]', el => ({ ruby: !!el.querySelector('ruby rt'), orig: el.querySelector('.lyris-original-line')?.textContent }));
  check('furigana ruby + original line beneath', ruby.ruby && ruby.orig === '空に歌う', JSON.stringify(ruby));

  // Active line & karaoke fill
  await page.evaluate(() => (document.getElementById('v').currentTime = 2.5));
  await page.waitForFunction(() => document.querySelector('.lyris-line[data-index="1"]')?.classList.contains('current'), null, { timeout: 5000 })
;
  await page.waitForTimeout(1200); // let the 0.28s color/filter transitions settle
  const style = await page.$eval('.lyris-line.current', el => { const s = getComputedStyle(el); return { w: s.fontWeight, c: s.color, ls: s.letterSpacing, fs: s.fontSize }; });
  check('active line typography (750, #F8F6F2, -0.02em, 40px)', style.w === '750' && style.c === 'rgb(248, 246, 242)' && style.fs === '40px' && Math.abs(parseFloat(style.ls) + 0.8) < 0.05, JSON.stringify(style));
  const fills = await page.$$eval('.lyris-line.current .lyris-word', ws => ws.map(w => w.style.getPropertyValue('--fill')));
  check('karaoke --fill progresses left-to-right', parseFloat(fills[0]) > 0 && parseFloat(fills[fills.length - 1]) === 0, fills.join(','));
  await page.waitForTimeout(400);
  const pastBlur = await page.$eval('.lyris-line[data-index="0"]', el => getComputedStyle(el).filter);
  check('past lines softly blurred', parseFloat((pastBlur.match(/blur\(([\d.]+)px/)||[])[1]) > 0, pastBlur);

  // Geometry: active line centered at clamp(h*0.24, 80, 120)
  await page.waitForTimeout(900);
  const geo = await page.evaluate(() => {
    const sc = document.getElementById('lyris-scroll'); const el = document.querySelector('.lyris-line.current');
    const r = el.getBoundingClientRect(), c = sc.getBoundingClientRect();
    return { y: r.top + r.height / 2 - c.top, target: Math.min(120, Math.max(80, sc.clientHeight * 0.24)), top: getComputedStyle(document.getElementById('lyris-lyrics-wrapper')).top };
  });
  check('active line follows clamp(h*0.24,80,120)', Math.abs(geo.y - geo.target) < 4, JSON.stringify(geo));

  // Resume sync pill
  const box = await (await page.$('#lyris-scroll')).boundingBox();
  await page.evaluate(() => window.scrollTo(0, 0));
  const box2 = await (await page.$('#lyris-scroll')).boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + 200);
  const samples = [];
  await page.mouse.wheel(0, 900);
  for (let i = 0; i < 12; i++) { samples.push(await page.$eval('#lyris-scroll', s => s.scrollTop)); await page.waitForTimeout(80); }
  check('Resume sync pill appears after browsing away', await page.$eval('#lyris-resume-btn', b => !b.hidden));
  await page.click('#lyris-resume-btn');
  await page.waitForTimeout(100);
  check('Resume sync pill hides after click', await page.$eval('#lyris-resume-btn', b => b.hidden));
  // pill must also hide on seek (iteration-1 fix)
  await page.evaluate(() => { const sc = document.getElementById('lyris-scroll'); sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 600 })); sc.scrollTop += 700; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('v').currentTime = 4.2; });
  await page.waitForTimeout(150);
  check('Resume sync pill hides on seek', await page.$eval('#lyris-resume-btn', b => b.hidden));

  // Click-to-seek & calibrate
  await page.click('.lyris-line[data-index="3"]');
  const t = await page.evaluate(() => document.getElementById('v').currentTime);
  check('click-to-seek jumps playback', Math.abs(t - 6) < 0.01, `t=${t}`);
  await page.evaluate(() => (document.getElementById('v').currentTime = 10));
  await page.waitForTimeout(150);
  await page.click('.lyris-line[data-index="2"]', { modifiers: ['Alt'] });
  const off = await page.$eval('#lyris-foot-sync-val', e => e.textContent);
  check('Alt+Click calibrates sync offset', off === '-6.0s', off);
  await page.click('#lyris-foot-sync-reset');

  // Keyboard seek on a focused line
  await page.focus('.lyris-line[data-index="4"]');
  await page.keyboard.press('Enter');
  const t2 = await page.evaluate(() => document.getElementById('v').currentTime);
  check('Tab-focus + Enter seeks (new keyboard support)', Math.abs(t2 - 8) < 0.01, `t=${t2}`);

  // Settings dialog
  await page.click('#lyris-settings-btn');
  const dlg = await page.$eval('#lyris-settings', d => ({ open: !d.hidden, w: d.getBoundingClientRect().width }));
  check('settings dialog opens at 352px', dlg.open && Math.round(dlg.w) === 352, JSON.stringify(dlg));
  await page.keyboard.press('Escape');
  const afterEsc = await page.evaluate(() => ({ closed: document.getElementById('lyris-settings').hidden, focus: document.activeElement?.id }));
  check('Esc closes settings and refocuses trigger', afterEsc.closed && afterEsc.focus === 'lyris-settings-btn', JSON.stringify(afterEsc));

  // Script mode change via in-page setting -> romaji
  await page.click('#lyris-settings-btn');
  await page.selectOption('#lyris-opt-japanese-mode', 'romaji');
  await page.waitForTimeout(150);
  const romaji = await page.$eval('.lyris-line[data-index="0"] .lyris-line-primary', e => e.textContent);
  check('romaji mode renders Latin text', /^[a-z\s]+$/.test(romaji.trim()), romaji);
  await page.selectOption('#lyris-opt-japanese-mode', 'furigana');

  // Sources pane: QQ off by default; reorder triggers exactly one reload request
  await page.click('#lyris-tab-sources');
  const qq = await page.$eval('#lyris-sources-container input[data-provider="qq"]', c => c.checked);
  check('QQ shown as off by default', qq === false);

  // Light pane sliders exist
  await page.click('#lyris-tab-light');
  const sliders = await page.$$eval('#lyris-pane-light input[type=range]', r => r.map(x => x.id));
  check('Light pane has intensity/spread/blur/saturation/fade', sliders.length === 5, sliders.join(','));
  await page.fill('#lyris-opt-spread', '100');
  await page.$eval('#lyris-opt-spread', el => el.dispatchEvent(new Event('input', { bubbles: true })));
  const sx = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--am-spread-x').trim());
  check('spread slider drives --am-spread-x', sx === '1.000', sx);
  const layers = await page.$$eval('#am-player-ambient-wrapper canvas', c => c.length);
  check('ambient engine injects 3 projection layers', layers === 3);

  // Click outside closes WITHOUT stealing focus
  await page.focus('.lyris-line[data-index="5"]');
  await page.mouse.click(5, 5);
  const outside = await page.evaluate(() => ({ closed: document.getElementById('lyris-settings').hidden, focus: document.activeElement?.id || document.activeElement?.tagName }));
  check('click-outside closes without focusing trigger', outside.closed && outside.focus !== 'lyris-settings-btn', JSON.stringify(outside));

  // Manual search modal: Esc closes and returns focus to opener
  await page.focus('#lyris-foot-search-btn');
  await page.keyboard.press('Enter');
  check('Wrong song? opens search modal', await page.$eval('#lyris-search-modal', m => !m.hidden));
  await page.keyboard.press('Escape');
  const sm = await page.evaluate(() => ({ closed: document.getElementById('lyris-search-modal').hidden, focus: document.activeElement?.id }));
  check('Esc closes search modal and returns focus', sm.closed && sm.focus === 'lyris-foot-search-btn', JSON.stringify(sm));

  // Popup: renders, reflects QQ default, and controls write to storage that the page picks up
  const extId = new URL(sw.url()).host;
  const popup = await ctx.newPage();
  popup.on('pageerror', (e) => errors.push('popup: ' + e.message));
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForSelector('#provider-list .provider-item', { state: 'attached' });
  const pop = await popup.evaluate(() => ({
    providers: document.querySelectorAll('#provider-list .provider-item').length,
    qq: [...document.querySelectorAll('#provider-list .provider-item')].find(i => i.textContent.includes('QQ'))?.querySelector('input').checked,
    font: document.getElementById('fontSizeVal').textContent
  }));
  check('popup renders 6 providers, QQ unchecked, 40px default', pop.providers === 6 && pop.qq === false && pop.font === '40px', JSON.stringify(pop));
  await popup.fill('#fontSize', '48');
  await popup.$eval('#fontSize', el => el.dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.lyris-line')).fontSize === '48px', null, { timeout: 5000 }).catch(() => {});
  const fsLive = await page.$eval('.lyris-line', el => getComputedStyle(el).fontSize);
  check('popup font-size change syncs live to page', fsLive === '48px', fsLive);
  await popup.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const swFetched = await sw.evaluate(() => self.__fetched);
  const leaked = [...external, ...swFetched].filter(u => !u.includes('lrclib.net') && !u.includes('163.com') && !u.includes('kugou.com'));
  check('no unexpected external hosts contacted (incl. QQ off)', leaked.length === 0, leaked.slice(0, 3).join(' '));

  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
