// Optional: re-renders brand assets. Needs playwright-core + Chromium (see README > Development).
// Output goes to docs/brand-out/; copy icon*.png into icons/ and social-preview.png into docs/.
// Renders brand assets (icons + GitHub social preview) from SVG/HTML with headless Chromium.
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'brand-out');
fs.mkdirSync(OUT, { recursive: true });

// --- Icon ------------------------------------------------------------------------------
// Concept: three lyric lines in the dark, lit by an ambient glow. The middle (active) line is
// mid-way through a karaoke sweep — bright cream on the left, unsung on the right.
// `detail` drops the glow nuances at tiny sizes so the glyph stays crisp.
function iconSVG(size) {
  const small = size <= 32;
  const inset = size >= 128 ? 8 : size >= 48 ? 2 : 0;   // Chrome Web Store: padding on the 128px icon
  const s = 128, i = inset * (128 / size), w = s - 2 * i;
  const r = w * 0.235;
  const bar = small ? 15 : 12.5;       // thicker strokes when tiny
  const x0 = i + w * 0.20;
  const y = (k) => i + w * (0.30 + k * 0.205);
  const W = (f) => w * f;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <clipPath id="sq"><rect x="${i}" y="${i}" width="${w}" height="${w}" rx="${r}"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#191B1D"/><stop offset="1" stop-color="#0E0F10"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.15" cy="1.05" r="0.95">
      <stop offset="0" stop-color="#FF7A59"/>
      <stop offset="0.35" stop-color="#E5484D" stop-opacity="0.85"/>
      <stop offset="0.75" stop-color="#8E2A55" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#8E2A55" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="1.05" cy="-0.05" r="0.7">
      <stop offset="0" stop-color="#FFC46B" stop-opacity="0.85"/>
      <stop offset="0.55" stop-color="#F08A4B" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#F08A4B" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="dot"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="#FFF4E0" stop-opacity="0.9"/><stop offset="1" stop-color="#FFD9A0" stop-opacity="0"/></radialGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.62" stop-color="#F8F6F2"/>
      <stop offset="0.62" stop-color="#F8F6F2" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#F8F6F2" stop-opacity="0.38"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="${small ? 0 : 3.2}"/></filter>
  </defs>
  <g clip-path="url(#sq)">
    <rect x="0" y="0" width="128" height="128" fill="url(#bg)"/>
    <rect x="0" y="0" width="128" height="128" fill="url(#glowA)"/>
    <rect x="0" y="0" width="128" height="128" fill="url(#glowB)"/>
    <!-- past line -->
    <rect x="${x0}" y="${y(0) - bar / 2}" width="${W(0.36)}" height="${bar}" rx="${bar / 2}" fill="#F8F6F2" fill-opacity="${small ? 0.6 : 0.5}"/>
    <!-- active line glow + sweep -->
    ${small ? '' : `<rect x="${x0}" y="${y(1) - bar / 2}" width="${W(0.36)}" height="${bar}" rx="${bar / 2}" fill="#FFFFFF" opacity="0.55" filter="url(#soft)"/>`}
    <rect x="${x0}" y="${y(1) - bar / 2}" width="${W(0.60)}" height="${bar}" rx="${bar / 2}" fill="url(#sweep)"/>
    ${small ? '' : `<circle cx="${x0 + W(0.60) * 0.62}" cy="${y(1)}" r="${bar * 1.25}" fill="url(#dot)" opacity="0.55"/>`}
    <circle cx="${x0 + W(0.60) * 0.62}" cy="${y(1)}" r="${bar * (small ? 0.62 : 0.68)}" fill="#FFFFFF"/>
    <!-- upcoming line -->
    <rect x="${x0}" y="${y(2) - bar / 2}" width="${W(0.46)}" height="${bar}" rx="${bar / 2}" fill="#F8F6F2" fill-opacity="${small ? 0.6 : 0.5}"/>
  </g>
  ${small ? '' : `<rect x="${i + 0.5}" y="${i + 0.5}" width="${w - 1}" height="${w - 1}" rx="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="0.08"/>`}
</svg>`;
}

// --- Social preview (GitHub recommends 1280x640) ------------------------------------------
function bannerHTML(iconDataUri) {
  const line = (t, cls = '', extra = '') => `<div class="ln ${cls}">${t}${extra}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Seg; src: url('file:///mnt/c/Windows/Fonts/segoeui.ttf'); font-weight: 400; }
  @font-face { font-family: Seg; src: url('file:///mnt/c/Windows/Fonts/segoeuisl.ttf'); font-weight: 350; }
  @font-face { font-family: Seg; src: url('file:///mnt/c/Windows/Fonts/segoeuib.ttf'); font-weight: 700; }
  @font-face { font-family: JP; src: url('file:///mnt/c/Windows/Fonts/NotoSansJP-VF.ttf'); }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden; background: #0E1011; font-family: Seg, JP, sans-serif; color: #F8F6F2; position: relative; }
  .glow { position: absolute; border-radius: 50%; filter: blur(90px); }
  .g1 { width: 760px; height: 560px; left: -260px; top: 260px; background: #D4534E; opacity: .55; }
  .g2 { width: 620px; height: 480px; left: 520px; top: -300px; background: #E89A55; opacity: .38; }
  .g3 { width: 520px; height: 520px; right: -200px; bottom: -260px; background: #7A3BD1; opacity: .30; }
  .grain { position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 40%, transparent 40%, rgba(0,0,0,.45)); }
  .left { position: absolute; left: 88px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 22px; }
  .brand img { width: 92px; height: 92px; filter: drop-shadow(0 12px 30px rgba(0,0,0,.5)); }
  .word { font-size: 96px; font-weight: 700; letter-spacing: -4px; line-height: 1; }
  .tag { margin-top: 26px; font-size: 34px; font-weight: 350; color: rgba(248,246,242,.86); letter-spacing: -.5px; }
  .sub { margin-top: 18px; font-size: 21px; color: #A09C99; line-height: 1.5; max-width: 500px; }
  .chips { margin-top: 30px; display: flex; gap: 10px; flex-wrap: wrap; }
  .chip { font-size: 16px; padding: 7px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.05); color: #E7E2DE; }
  .card { position: absolute; right: 78px; top: 70px; width: 520px; height: 500px; border-radius: 26px;
          background: rgba(20,23,25,.62); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(20px);
          box-shadow: 0 30px 80px rgba(0,0,0,.55); padding: 34px 38px; overflow: hidden;
          -webkit-mask-image: linear-gradient(transparent 0, #000 70px, #000 calc(100% - 90px), transparent); }
  .ln { font-size: 34px; font-weight: 700; letter-spacing: -.7px; line-height: 1.3; color: rgba(248,246,242,.42); margin-bottom: 24px; filter: blur(.4px); }
  .ln.cur { color: #F8F6F2; filter: none; font-size: 38px; }
  .ln .orig { display: block; font-size: 17px; font-weight: 400; color: #DED4D3; margin-top: 6px; letter-spacing: 0; }
  .sweep { background: linear-gradient(90deg, #fff 58%, rgba(248,246,242,.42) 58%); -webkit-background-clip: text; color: transparent; }
  .live { filter: drop-shadow(0 0 8px rgba(255,255,255,.45)); }
  ruby rt { font-size: .45em; font-weight: 500; color: rgba(248,246,242,.75); }
  .pill { position: absolute; right: 26px; bottom: 24px; font-size: 14px; font-weight: 600; padding: 9px 15px; border-radius: 20px; background: rgba(20,23,25,.85); border: 1px solid rgba(255,255,255,.22); }
  .pill i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #D4534E; margin-right: 8px; vertical-align: 1px; }
  </style></head><body>
  <div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div><div class="grain"></div>
  <div class="left">
    <div class="brand"><img src="${iconDataUri}"><div class="word">lyris</div></div>
    <div class="tag">Lyrics in the light.</div>
    <div class="sub">Synced lyrics, word-by-word karaoke, ambient light and offline Japanese readings for YouTube&nbsp;Music.</div>
    <div class="chips"><span class="chip">Syllable karaoke</span><span class="chip">Ambient light</span><span class="chip">ふりがな · Romaji</span></div>
  </div>
  <div class="card">
    ${line('And the stars were singing')}
    ${line('<ruby>夜<rt>よる</rt></ruby>に<ruby>駆<rt>か</rt></ruby>ける', '', '<span class="orig">夜に駆ける</span>')}
    <div class="ln cur"><span class="sweep live">Every word in the light</span></div>
    ${line('<ruby>光<rt>ひかり</rt></ruby>の<ruby>中<rt>なか</rt></ruby>で', '', '<span class="orig">光の中で</span>')}
    ${line('Hold on to the melody')}
    ${line('Until the morning comes')}
    <div class="pill"><i></i>Resume sync</div>
  </div>
  </body></html>`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${iconSVG(size)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  fs.writeFileSync(path.join(OUT, 'icon.svg'), iconSVG(128));
  const icon = 'data:image/svg+xml;base64,' + Buffer.from(iconSVG(128)).toString('base64');
  await page.setViewportSize({ width: 1280, height: 640 });
  const bannerFile = path.join(os.tmpdir(), 'lyris-banner.html');
  fs.writeFileSync(bannerFile, bannerHTML(icon));
  await page.goto('file://' + bannerFile);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'social-preview.png') });
  // preview sheet of icons on light + dark at real sizes
  const sheet = (bg) => `<div style="background:${bg};padding:16px;display:flex;gap:18px;align-items:end">` +
    [16, 32, 48, 128].map(s => `<img src="file://${OUT}/icon${s}.png" width="${s}" height="${s}">`).join('') + '</div>';
  await page.setViewportSize({ width: 320, height: 330 });
  await page.setContent(`<body style="margin:0">${sheet('#202124')}${sheet('#f1f3f4')}</body>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'icon-sheet.png') });
  await browser.close();
  console.log('done', fs.readdirSync(OUT));
})();
