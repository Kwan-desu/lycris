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
    '[01:02.123]long',
    '[1:15.50]<01:15.50>single digit minute',
    '[02:00,50]comma decimal'
  ].join('\n');
  const lines = api.parseLRC(lrc);
  assert.deepEqual(plain(lines.map(l => l.text)), ['repeat', 'second', 'repeat', 'long', 'single digit minute', 'comma decimal']);
  assert.equal(lines[0].time, 2.0);          // 1.5 + 0.5 offset
  assert.equal(lines[3].time, 62.623);       // 62.123 + 0.5
  assert.equal(lines[4].time, 76.0);         // 75.5 + 0.5
  assert.equal(lines[5].time, 121.0);        // 120.5 + 0.5
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

test('Japanese kanji readings and furigana alignment use accurate dictionary readings', () => {
  const cases = [
    ['学校', 'がっこう', 'gakkou'],
    ['会社', 'かいしゃ', 'kaisha'],
    ['運命', 'うんめい', 'unmei'],
    ['時間', 'じかん', 'jikan'],
    ['先生', 'せんせい', 'sensei'],
    ['今日', 'きょう', 'kyou'],
    ['明日', 'あした', 'ashita'],
    ['昨日', 'きのう', 'kinou'],
    ['一緒', 'いっしょ', 'issho'],
    ['一緒に', 'いっしょに', 'isshoni'],
    ['日本', 'にほん', 'nihon'],
    ['映画', 'えいが', 'eiga'],
    ['電話', 'でんわ', 'denwa'],
    ['電車', 'でんしゃ', 'densha'],
    ['時計', 'とけい', 'tokei'],
    ['人生', 'じんせい', 'jinsei'],
    ['感覚', 'かんかく', 'kankaku'],
    ['手を繋ぐ', 'てをつなぐ', 'tewotsunagu'],
    ['生きていく', 'いきていく', 'ikiteiku'],
    ['生まれて', 'うまれて', 'umarete'],
    ['月明かり', 'つきあかり', 'tsukiakari']
  ];

  for (const [kanji, expectedHira, expectedRomaji] of cases) {
    const hira = api.convertJapaneseLine(kanji, 'hiragana');
    const roma = api.convertJapaneseLine(kanji, 'romaji');
    assert.equal(hira, expectedHira, `Mismatch hira for ${kanji}`);
    assert.equal(roma, expectedRomaji, `Mismatch romaji for ${kanji}`);
  }

  assert.equal(
    api.convertJapaneseLine('月明かり', 'furigana'),
    '<ruby class="am-ruby"><rb>月明</rb><rt>つきあ</rt></ruby>かり'
  );
  assert.equal(
    api.convertJapaneseLine('走り出す', 'furigana'),
    '<ruby class="am-ruby"><rb>走</rb><rt>はし</rt></ruby>り<ruby class="am-ruby"><rb>出</rb><rt>だ</rt></ruby>す'
  );

  // Word tokenization in karaoke preserves compound words so furigana/readings are intact
  const timedWords = api.computeWordTimings({ time: 0, text: '言葉にできない' }).filter(w => !w.isSpace);
  assert.equal(timedWords[0].text, '言葉');
  assert.equal(
    api.convertJapaneseLine(timedWords[0].text, 'furigana'),
    '<ruby class="am-ruby"><rb>言葉</rb><rt>ことば</rt></ruby>'
  );
  assert.equal(api.convertJapaneseLine(timedWords[0].text, 'romaji'), 'kotoba');
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
