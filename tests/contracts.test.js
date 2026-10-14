'use strict';
// Static contract checks: verify that the source keeps the documented UX/geometry contracts
// and that publishing requirements (permissions, packaging) stay consistent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const js = read('content.js');
const css = read('content.css');
const bg = read('background.js');
const manifest = JSON.parse(read('manifest.json'));

test('Apple typography: active line weight 750, -0.02em tracking, #F8F6F2', () => {
  assert.match(css, /--ly-text:\s*#F8F6F2/i);
  assert.match(css, /\.lyris-line\.current[^{]*\{[^}]*font-weight:\s*750/);
  assert.match(css, /\.lyris-line,[\s\S]*?letter-spacing:\s*-0\.02em/);
});

test('karaoke: --fill gradient, drop-shadow glow and 1px lift', () => {
  assert.match(css, /linear-gradient\(90deg,[^)]*var\(--fill/);
  assert.match(css, /\.lyris-word\.live[^{]*\{[^}]*drop-shadow[^}]*translateY\(-1px\)/);
});

test('geometry contract: follow line at clamp(height * 0.24, 80, 120) in scroll + resume pill', () => {
  const matches = js.match(/Math\.min\(120, Math\.max\(80, scrollContainer\.clientHeight \* 0\.24\)\)/g) || [];
  assert.ok(matches.length >= 2, 'scrollToActiveLine and updateResumeSyncButton must share the contract');
});

test('ambient: independent horizontal / vertical spread in JS and CSS', () => {
  assert.match(js, /AMBIENT_SPREAD_X/);
  assert.match(js, /AMBIENT_SPREAD_Y/);
  assert.match(js, /--am-spread-x/);
  assert.match(js, /--am-spread-y/);
  assert.match(css, /left:\s*calc\(-1 \* \(15% \+ \(var\(--am-spread-x/);
  assert.match(css, /top:\s*calc\(-1 \* \(15% \+ \(var\(--am-spread-y/);
});

test('settings dialog: 352px wide, Esc closes in capture phase and refocuses trigger', () => {
  assert.match(css, /\.lyris-settings \{[^}]*width:\s*352px/);
  assert.match(js, /addEventListener\('keydown',[\s\S]{0,700}closeLyrisSettings\(true\)[\s\S]{0,400}\}, true\);/);
  assert.match(js, /if \(restoreFocus === true\) trigger\.focus\(\)/);
});

test('player bar buttons use 20px SVG icons', () => {
  const svgs = js.match(/<svg width="20" height="20"/g) || [];
  assert.ok(svgs.length >= 2);
});

test('lyric lines are keyboard-operable', () => {
  assert.match(js, /lineElem\.tabIndex = 0/);
  assert.match(js, /e\.key === 'Enter' \|\| e\.key === ' '/);
});

test('source changes reload lyrics once (via storage.onChanged), not per handler', () => {
  const body = js.slice(js.indexOf('function renderSourcesListUI'), js.indexOf('function openLyrisSettings'));
  assert.ok(!body.includes('loadLyricsForCurrentTrack(true)'), 'handlers should rely on onChanged');
});

test('manifest: every host the code fetches is permitted, and no unused hosts are requested', () => {
  const fetched = new Set((bg.match(/https:\/\/[a-z0-9.-]+/gi) || [])
    .map(u => new URL(u).hostname)
    .filter(h => h !== 'github.com'));
  const patterns = manifest.host_permissions.map(p => new URL(p.replace('*.', 'wildcard.').replace(/\/\*$/, '/')).hostname);
  const allowed = (host) => patterns.some(p => p.startsWith('wildcard.') ? host.endsWith(p.slice('wildcard'.length)) : host === p);
  for (const host of fetched) assert.ok(allowed(host), `missing host permission for ${host}`);
  for (const pat of manifest.host_permissions) {
    assert.ok(pat.startsWith('https://'), `insecure host permission ${pat}`);
  }
  assert.ok(!manifest.host_permissions.includes('https://translate.google.com/*'), 'unused permission');
  assert.deepEqual(manifest.permissions, ['storage']);
});

test('versions are consistent across manifest, package.json, popup and settings panel', () => {
  const v = manifest.version;
  assert.equal(JSON.parse(read('package.json')).version, v);
  assert.ok(read('popup/popup.html').includes(`v${v}`));
  assert.ok(js.includes(`v${v}</span>`));
});

test('every file referenced by the manifest exists', () => {
  const refs = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(c => [...c.js, ...c.css])
  ];
  for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, r)), `missing ${r}`);
});

test('offline dictionary has over 3,500 entries', () => {
  const vm = require('vm');
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(read('kanji_dict.js'), ctx);
  const total = Object.keys(ctx.AM_KANJI_COMPOUNDS).length + Object.keys(ctx.AM_KANJI_SINGLE).length;
  assert.ok(total > 3500, `only ${total} entries`);
});

test('ambient spread sliders allow up to 400% and 0 is honoured by the canvas', () => {
  assert.match(js, /id="lyris-opt-spread" min="0" max="400"/);
  assert.match(read('popup/popup.html'), /id="ambientSpread" min="0" max="400"/);
  assert.ok(!js.includes('spreadVal || 42'), '0% spread must not fall back to 42%');
});
