'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('./helpers');

const bg = loadBackground();
const LRC = (tag) => [1, 2, 3, 4, 5].map(i => `[00:0${i}.00]${tag} line ${i}`).join('\n');

test('cleanArtistName strips Topic / VEVO / album suffixes', () => {
  assert.equal(bg.cleanArtistName('YOASOBI - Topic'), 'YOASOBI');
  assert.equal(bg.cleanArtistName('AdeleVEVO'), 'Adele');
  assert.equal(bg.cleanArtistName('Aimer • Album • 2021'), 'Aimer');
});

test('cleanVideoFluff removes official video / MV tags', () => {
  assert.equal(bg.cleanVideoFluff('夜に駆ける (Official Music Video)'), '夜に駆ける');
  assert.equal(bg.cleanVideoFluff('Song Title MV'), 'Song Title');
});

test('computeTokenSimilarity: identical = 1, unrelated = 0, CJK partial > 0', () => {
  assert.equal(bg.computeTokenSimilarity('Lemon', 'lemon'), 1);
  assert.equal(bg.computeTokenSimilarity('Lemon', 'Pretender'), 0);
  assert.ok(bg.computeTokenSimilarity('夜に駆ける', '夜に駆ける (TV)') > 0.3);
});

test('buildSearchQueries yields original-track queries for covers', () => {
  const qs = bg.buildSearchQueries({ title: 'Lemon / 米津玄師 (Cover)', artist: 'Some VTuber' });
  assert.ok(qs.length > 0 && qs.length <= 4);
  assert.ok(qs.every(q => q.isCover));
  assert.equal(qs[0].query, 'Lemon 米津玄師');
});

test('buildSearchQueries splits "Artist - Title" uploads', () => {
  const qs = bg.buildSearchQueries({ title: 'YOASOBI - 夜に駆ける (Official Music Video)', artist: 'Ayase / YOASOBI' });
  assert.ok(qs.some(q => q.title === '夜に駆ける'), JSON.stringify(qs));
});

test('selectBestCandidate prefers synced, rejects wrong-title and wrong-artist candidates', () => {
  const pool = [
    { id: 1, trackName: 'Lemon', artistName: 'Kenshi Yonezu', duration: 255, plainLyrics: 'a\nb\nc\nd' },
    { id: 2, trackName: 'Lemon', artistName: 'Kenshi Yonezu', duration: 256, syncedLyrics: LRC('x') },
    { id: 3, trackName: 'Totally Different', artistName: 'Kenshi Yonezu', duration: 255, syncedLyrics: LRC('y') }
  ];
  const best = bg.selectBestCandidate(pool, 'Lemon', 'Kenshi Yonezu', 255);
  assert.equal(best.synced, true);
  assert.equal(best.lyrics, LRC('x'));

  const wrongArtist = [{ id: 4, trackName: 'Lemon', artistName: 'Unrelated Band', duration: 120, syncedLyrics: LRC('z') }];
  assert.equal(bg.selectBestCandidate(wrongArtist, 'Lemon', 'Kenshi Yonezu', 255), null);
});

test('handleFetchLyrics never runs QQ unless explicitly enabled', async () => {
  const urls = [];
  const ctx = loadBackground((url) => { urls.push(String(url)); return Promise.resolve({ ok: false }); });
  await ctx.handleFetchLyrics({ title: 'Lemon', cleanTitle: 'Lemon', artist: 'A', cleanArtist: 'A', duration: 200 },
    ['lrclib', 'qq'], { lrclib: true });
  assert.ok(urls.length > 0);
  assert.ok(!urls.some(u => u.includes('qq.com')), 'QQ was queried while not explicitly enabled');
});

test('a failed candidate request does not abort the remaining NetEase candidates', async () => {
  let lyricCalls = 0;
  const fetchImpl = (url) => {
    url = String(url);
    if (url.includes('cloudsearch')) {
      return Promise.resolve({ ok: true, json: async () => ({ result: { songs: [
        { id: 1, name: 'Lemon', ar: [{ name: 'Kenshi Yonezu' }], dt: 255000 },
        { id: 2, name: 'Lemon', ar: [{ name: 'Kenshi Yonezu' }], dt: 255000 }
      ] } }) });
    }
    if (url.includes('song/lyric')) {
      lyricCalls++;
      if (url.includes('id=1')) return Promise.reject(new Error('timeout'));
      return Promise.resolve({ ok: true, json: async () => ({ lrc: { lyric: LRC('hello') } }) });
    }
    return Promise.resolve({ ok: false });
  };
  const ctx = loadBackground(fetchImpl);
  const res = await ctx.fetchFromNetease('Lemon Kenshi Yonezu', 'Lemon', 'Kenshi Yonezu', 255);
  assert.equal(lyricCalls, 2);
  assert.ok(res && res.synced, 'second candidate should have been used');
});

test('message router answers CLEAR_CACHE', async () => {
  const ctx = loadBackground();
  const reply = await new Promise((resolve) => {
    const keepOpen = ctx.__listeners[0]({ action: 'CLEAR_CACHE' }, {}, resolve);
    assert.equal(keepOpen, true);
  });
  assert.equal(reply.success, true);
});

test('junk lyric entries (e.g. "[00:00.00]probe") are rejected, real ones kept', async () => {
  assert.equal(bg.isUsableLyrics('[00:00.00]probe', true), false);
  assert.equal(bg.isUsableLyrics(LRC('ok'), true), true);
  assert.equal(bg.isUsableLyrics('[00:01.00]\n[00:02.00]\n[00:03.00]\n[00:04.00]', true), false);
  // Live LRCLIB case: exact GET returns a 1-line "probe" entry, search has the real lyric.
  const real = LRC('never gonna');
  const ctx = loadBackground((url) => {
    url = String(url);
    if (url.includes('/api/get')) return Promise.resolve({ ok: true, json: async () => ({ syncedLyrics: '[00:00.00]probe', plainLyrics: 'probe' }) });
    if (url.includes('/api/search')) return Promise.resolve({ ok: true, json: async () => ([
      { id: 9, trackName: 'Never Gonna Give You Up', artistName: 'Rick Astley', duration: 214, syncedLyrics: real }
    ]) });
    return Promise.resolve({ ok: false });
  });
  const res = await ctx.fetchFromLrclib('Never Gonna Give You Up', 'Rick Astley', 213);
  assert.equal(res.synced, true);
  assert.equal(res.lyrics, real);
});
