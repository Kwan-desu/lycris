'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent } = require('./helpers');

const { api } = loadContent();
// Arrays created inside the VM realm have a different prototype; normalize before deepEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('parseLRC parses, sorts, expands multi-timestamps and applies [offset]', () => {
  const lrc = [
    '[ti:Demo]',
    '[offset:+500]',
    '[00:05.00]second',
    '[00:01.50][00:10.00]repeat',
    '',
    '[01:02.123]long'
  ].join('\n');
  const lines = api.parseLRC(lrc);
  assert.deepEqual(plain(lines.map(l => l.text)), ['repeat', 'second', 'repeat', 'long']);
  assert.equal(lines[0].time, 2.0);          // 1.5 + 0.5 offset
  assert.equal(lines[3].time, 62.623);       // 62.123 + 0.5
  assert.deepEqual(plain(api.parseLRC('')), []);
});

test('computeWordTimings spreads tokens across 90% of the line and keeps spaces untimed', () => {
  const words = api.computeWordTimings({ time: 10, text: 'hello big world' }, { time: 14 });
  const sung = words.filter(w => !w.isSpace);
  assert.equal(sung.length, 3);
  assert.equal(sung[0].time, 10);
  const end = sung[2].time + sung[2].duration;
  assert.ok(Math.abs(end - (10 + 4 * 0.9)) < 1e-9, `ends at ${end}`);
  assert.ok(words.some(w => w.isSpace));
});

test('computeWordTimings clamps line duration to 8s and handles empty text', () => {
  const words = api.computeWordTimings({ time: 0, text: 'a' }, { time: 100 });
  assert.ok(Math.abs(words[0].duration - 8 * 0.9) < 1e-9);
  const note = api.computeWordTimings({ time: 0, text: '' }, null);
  assert.equal(note[0].text, '♪');
});

test('tokenizeLineText splits CJK per character and latin per word', () => {
  const toks = api.tokenizeLineText('Hi 君').filter(t => t.trim());
  assert.deepEqual(plain(toks), ['Hi', '君']);
});

test('kana conversion: romaji incl. sokuon, long vowel and youon', () => {
  assert.equal(api.kanaToRomaji('きょう'), 'kyou');
  assert.equal(api.kanaToRomaji('がっこう'), 'gakkou');
  assert.equal(api.kanaToRomaji('ラーメン'), 'raamen');
  assert.equal(api.hiraganaToKatakana('さくら'), 'サクラ');
  assert.equal(api.katakanaToHiragana('サクラ'), 'さくら');
});

test('convertJapaneseLine supports every script mode and escapes HTML', () => {
  const text = '空<b>';
  assert.equal(api.convertJapaneseLine(text, 'original'), '空&lt;b&gt;');
  const furi = api.convertJapaneseLine('空', 'furigana');
  assert.match(furi, /<ruby class="am-ruby"><rb>空<\/rb><rt>.+<\/rt><\/ruby>/);
  const hira = api.convertJapaneseLine('空', 'hiragana');
  assert.ok(!/[\u4e00-\u9fff]/.test(hira), `hiragana still has kanji: ${hira}`);
  const kata = api.convertJapaneseLine('空', 'katakana');
  assert.match(kata, /^[\u30a0-\u30ff]+$/);
  const roma = api.convertJapaneseLine('空', 'romaji');
  assert.match(roma, /^[a-z]+$/);
  // Non-Japanese text is passed through escaped
  assert.equal(api.convertJapaneseLine('a & b', 'romaji'), 'a &amp; b');
});

test('addFurigana never injects unescaped markup from lyric text', () => {
  const out = api.addFurigana('<img src=x onerror=alert(1)>空');
  assert.ok(!out.includes('<img'), out);
});

test('decomposeTrackInfo detects covers and recovers the original title', () => {
  const d = api.decomposeTrackInfo('Lemon / 米津玄師 (Cover)', 'Some VTuber');
  assert.equal(d.isCover, true);
  assert.equal(d.primaryTitle, 'Lemon');
  assert.equal(d.originalArtist, '米津玄師');
  const n = api.decomposeTrackInfo('Lemon', 'Kenshi Yonezu');
  assert.equal(n.isCover, false);
});

test('defaults match the documented Apple typography contract and QQ is opt-in', () => {
  assert.equal(api.DEFAULT_SETTINGS.fontSize, 40);
  assert.equal(api.DEFAULT_SETTINGS.enabledProviders.qq, false);
  assert.deepEqual(
    plain([...api.DEFAULT_SETTINGS.providerOrder].sort()),
    ['kugou', 'lrclib', 'native', 'netease', 'qq', 'youtube-cc']
  );
});
