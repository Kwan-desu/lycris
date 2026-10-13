# Lyris — Lyrics in the light

<p align="center">
  <img src="icons/icon128.png" alt="Lyris Logo" width="96" height="96">
</p>

<p align="center">
  <b>Apple-inspired synced lyrics, syllable karaoke, ambient edge lighting, and offline Japanese readings for YouTube Music.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue.svg" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Version-1.0.0-emerald.svg" alt="Version 1.0.0">
  <img src="https://img.shields.io/badge/Platform-Chrome%20%7C%20Brave%20%7C%20Edge-orange.svg" alt="Platform">
  <img src="https://img.shields.io/badge/License-MIT-purple.svg" alt="License">
</p>

---

## 📸 Showcase & Preview

<!-- DEMO / HERO BANNER PLACEHOLDER -->
<p align="center">
  <img src="https://via.placeholder.com/960x540/141719/ffffff?text=Lyris+Demo+Showcase" alt="Lyris Demo Showcase" width="100%">
</p>

---

## ✨ Core Features

### 🎤 1. Apple-Inspired Synced Lyrics & Syllable Karaoke
* **Apple Music Typography**: Active line default 40px (weight 750, -0.02em tracking, `#F8F6F2`). Surrounding lines feature soft opacity and subtle optical blur.
* **Word & Syllable Karaoke**: Smooth left-to-right fill gradient (`--fill`), gentle drop-shadow glow, and 1px lift.
* **Natural Geometry Contract**: Lyrics viewport anchored cleanly below native tabs with no blank spacers. Active line centered at `clamp(pane.height * 0.24, 80px, 120px)`.
* **Viewport-Anchored Resume Sync**: Discrete `Resume sync` pill appears when browsing away from the playing line, restoring following with one click.
* **Click-to-Seek & Audio Sync Calibration**: Click any lyric line to jump playback; `Alt+Click` or `Shift+Click` instantly calibrates audio sync.

---

### 🌟 2. Multi-Band Hardware-Accelerated Ambient Light Engine
* **Perimeter Edge Projection**: Samples outer edge pixels of the video/album artwork and projects multi-band light outward across the player canvas.
* **Independent Outer Edges**: Independent horizontal & vertical spread multipliers ensuring balanced ambient bloom around YouTube Music's right-aligned video layout.
* **Fine-Tuned Controls**: Interactive sliders for Intensity, Spread, Blur, Saturation, and Fade Duration.

---

### 🇯🇵 3. Instant Offline Japanese Readings
* **Zero Latency & Zero External Downloads**: High-speed offline kanji compound & Joyo dictionary with over 3,500 entries.
* **Flexible Script Modes**:
  * **Furigana**: Ruby markup with reading above kanji.
  * **Romaji**: Full Latin transliteration.
  * **Hiragana / Katakana**: Pure phonetic kana.
  * **Original only**: Pure Japanese text.
* **Dual-Line Display**: Show original Japanese text directly beneath the reading line for comfortable sing-along.

---

### 🔀 4. Multi-Provider Waterfall & Manual Search
* **Configurable Waterfall**: Sequential queries across LRCLIB, NetEase Music (网易云音乐), KuGou Music (酷狗音乐), YouTube CC, and native YouTube Music lyrics.
* **Intelligent Cover Matching**: Disambiguates covers, acoustics, and VTuber uploads to locate matching original synchronized lyrics.
* **Manual Search Modal**: Click "Wrong song? Find another" at the footer to search candidates by song or artist and apply matched lyrics instantly.

---

### ⚙️ 5. Restrained In-Page Settings & Popup
* **Player Bar Controls**: Integrated 20px outline SVG action buttons in the bottom playback bar:
  * `Show lyrics`: Opens the side lyric pane even when native lyrics are disabled.
  * `Lyris settings`: Opens a restrained 352px glass dark dialog above the player bar.
* **Keyboard Accessible**: Press `Esc` to close settings and automatically refocus the trigger button.
* **Three Clean Sections**:
  * **Lyrics**: Script, original text toggle, font size slider, karaoke switch, click-to-seek.
  * **Light**: Ambient switch, intensity, spread, blur, saturation, fade duration.
  * **Sources**: Enablement toggles, waterfall up/down priority ordering, and section resets.

---

## 🚀 Installation Guide

### Method 1: Load Unpacked Extension (Recommended)
1. Clone or download this repository:
   ```bash
   git clone https://github.com/Kwan-desu/lycris.git
   ```
2. Open your Chromium-based browser (Chrome, Brave, Edge, Vivaldi, Opera).
3. Navigate to `chrome://extensions/`.
4. Enable **Developer mode** using the toggle switch in the upper-right corner.
5. Click **Load unpacked** in the top-left corner.
6. Select the repository folder (`lycris`).
7. Open [YouTube Music](https://music.youtube.com/) and enjoy!

### Method 2: Packaged Release
1. Download the latest `lyris-v1.0.0.zip` from GitHub Releases.
2. Extract the archive into a folder.
3. In `chrome://extensions/`, click **Load unpacked** and select the extracted folder.

---

## 🛠️ Controls & Shortcuts

| Action | How to Trigger |
| :--- | :--- |
| **Show Lyrics** | Click the lyrics bubble icon in the bottom player bar |
| **Lyris Settings** | Click the sliders icon in the bottom player bar, or press Esc to close |
| **Seek to Lyric** | Click any lyric row |
| **Calibrate Audio Sync** | `Alt+Click` or `Shift+Click` on any lyric row |
| **Nudge Audio Sync** | Click `-0.5s`, `-0.1s`, `+0.1s`, or `+0.5s` in the lyrics footer |
| **Resume Sync** | Click the bottom-right `Resume sync` pill after manual scrolling |
| **Manual Search** | Click `Wrong song? Find another` in the lyrics footer |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
