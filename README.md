# Ambient Light & Synced Lyrics for YouTube Music

<p align="center">
  <img src="icons/icon128.png" alt="Lycris Logo" width="96" height="96">
</p>

<p align="center">
  <b>Multi-level atmospheric ambient lighting and ultra-responsive synchronized karaoke lyrics for YouTube Music.</b>
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
<!-- Replace the URL below with your main screenshot or animated GIF -->
<p align="center">
  <img src="https://via.placeholder.com/960x540/1a1a1a/ffffff?text=Place+Main+Demo+Screenshot+or+GIF+Here" alt="Demo Showcase" width="100%">
</p>

---

## ✨ Core Features

### 🌟 1. Multi-Level Ambient Projector
Experience real-time ambient lighting cast across the viewport, perfectly harmonized with album art and video streams.
* **3-Stage Projection Engine**: Inner Edge Glow, Mid-Radius Spread, and Outer Atmospheric Aura.
* **Custom Tuners**: Real-time slider controls for Blur (`0% - 100%`), Spread (`0% - 300%`), Brightness (`50% - 200%`), Saturation (`50% - 200%`), and Fade-In Duration.
* **Zero Flicker**: Instant artwork preloading preserves consistent ambient lighting across fast track skips.

<!-- AMBIENT LIGHT FEATURE IMAGE PLACEHOLDER -->
<!-- <p align="center"><img src="docs/ambient-light-preview.png" alt="Ambient Light Feature" width="80%"></p> -->

---

### 🎤 2. Word & Syllable Synchronized Lyrics
Enjoy an Apple Music-style lyrics experience that blends seamlessly into the YouTube Music player interface.
* **Karaoke Word Sync**: Syllables and words illuminate progressively with a glowing accent as they are sung.
* **Fluid Auto-Scroll**: Smooth active-line tracking keeps current lyrics centered in view.
* **Manual Scroll Recovery**: A discrete "Resume Sync" button appears when scrolling freely and disappears once synchronization resumes.
* **Click-to-Seek**: Click any lyric line to jump playback directly to that timestamp.
* **Frosted Glass Styling**: Dynamic transparent backdrop designed to let ambient lighting shine cleanly behind lines without dark box occlusion.

<!-- SYNCED LYRICS FEATURE IMAGE PLACEHOLDER -->
<!-- <p align="center"><img src="docs/lyrics-karaoke-preview.png" alt="Synced Lyrics Feature" width="80%"></p> -->

---

### 🇯🇵 3. Japanese Transliteration & Furigana Engine
Sing along to Japanese, Anime, and Vocaloid songs effortlessly without language barriers.
* **Kanji to Furigana / Romaji**: Automatically annotates Kanji characters with Hiragana rubies or full Romaji transliterations.
* **Instant Toggle Pill**: Switch between Romaji, Hiragana, Katakana, and Original scripts via the quick-toggle pill on the lyrics screen.
* **English Translation Subtitles**: Optional parallel subtitle line rendering for translated understanding.

<!-- JAPANESE FURIGANA FEATURE IMAGE PLACEHOLDER -->
<!-- <p align="center"><img src="docs/furigana-transliteration-preview.png" alt="Furigana Feature" width="80%"></p> -->

---

### 🔀 4. Multi-Provider Fallback & Cover Song Matching
Never miss a lyric. The extension sequentially queries providers in your configured priority order:
1. **LRCLIB**: Global and Western catalog with word-level synced LRC.
2. **Netease Cloud Music (网易云音乐)**: Vast Japanese, J-Pop, Anime, and Asian music database.
3. **Kugou Music (酷狗音乐)**: Extensive Asian and International lyrics repository.
4. **QQ Music (QQ音乐)**: Large-scale synchronized lyrics library.
5. **YouTube Music Native Lyrics**: Official built-in static lyrics fallback.
6. **YouTube Captions (CC)**: Automatic synchronization with timed video captions.

* **Intelligent Cover Matching**: Detects cover songs, acoustics, and remixes, matching the underlying original song so you get synchronized lyrics even on VTuber or indie cover uploads!
* **Zero Cross-Tab Bleed**: Fully isolated tab controller ensures "You might also like" or comments never intrude into the active lyrics view.

---

### ⚙️ 5. Non-Blocking In-Page Floating Settings
* **Draggable Window**: Move the settings dialog anywhere across your browser window.
* **Direct Player Controls**: Embedded ambient launcher button located right on the bottom YouTube Music player bar.
* **Live Interactive Tuning**: No backdrop dimming—view visual changes immediately as you adjust sliders.

<!-- FLOATING SETTINGS IMAGE PLACEHOLDER -->
<!-- <p align="center"><img src="docs/floating-settings-preview.png" alt="Settings Interface" width="80%"></p> -->

---

## 🚀 Installation Guide

### Method 1: Load Unpacked Extension (Recommended)
1. Download or clone this repository:
   ```bash
   git clone https://github.com/Kwan-desu/lycris.git
   ```
2. Open your Chromium-based browser (Chrome, Brave, Edge, Vivaldi, Opera).
3. Navigate to `chrome://extensions/`.
4. Enable **Developer mode** using the toggle switch in the upper-right corner.
5. Click **Load unpacked** in the top-left corner.
6. Select the cloned repository folder (`lycris`).
7. Open [YouTube Music](https://music.youtube.com/) and enjoy!

### Method 2: Packaged ZIP Release
1. Download the latest `lycris-v1.0.0.zip` from the [Releases](https://github.com/Kwan-desu/lycris/releases) tab.
2. Extract the ZIP file into a folder of your choice.
3. In `chrome://extensions/`, click **Load unpacked** and select the extracted folder.

---

## 🛠️ Usage & Keyboard Shortcuts

| Action | How to Trigger |
| :--- | :--- |
| **Open Settings** | Click the Ambient Light icon in the bottom-right player bar, or click the extension icon in Chrome. |
| **Move Settings Panel** | Click and drag the title bar of the floating settings box. |
| **Jump to Timestamp** | Click any lyric line on the screen. |
| **Switch Transliteration** | Click the transliteration pill (`🇯🇵 Romaji`) in the lyrics footer. |
| **Reorder Providers** | Open Settings -> Providers -> Use `▲` and `▼` buttons to customize query priority. |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
