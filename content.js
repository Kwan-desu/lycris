/**
 * Ambient Light & Synced Lyrics for YouTube Music
 * Content Script v1.0 (Multi-Level Ambient Projector, Word Sync & Integrated UI)
 */

(function () {
  'use strict';

  // --- Default Settings ---
  const DEFAULT_SETTINGS = {
    // Ambient Light
    ambientEnabled: true,
    ambientBlur: 70, // 70%
    ambientSpread: 42, // 42%
    ambientFadeDuration: 0, // 0 = Off
    ambientBrightness: 95, // 95%
    ambientSaturation: 120, // 120%

    // Provider Priority
    providerOrder: ['lrclib', 'netease', 'kugou', 'qq', 'youtube-cc', 'native'],
    enabledProviders: {
      'lrclib': true,
      'netease': true,
      'kugou': true,
      'qq': true,
      'youtube-cc': true,
      'native': true
    },

    // Lyrics
    lyricsEnabled: true,
    appleMode: true, // Alias for backward compatibility
    lineHighlight: true, // Highlight active lyric line
    wordHighlight: true, // Syllable/word synchronized karaoke highlight to specific words
    highlightStyle: 'apple-glow', // 'apple-glow' | 'karaoke-wave' | 'gradient-wipe' | 'clean-fade'
    furiganaEnabled: true, // Display Hiragana under Kanji
    translationEnabled: false, // Display English translation under Japanese lines
    fontSize: 26,
    clickToSeek: true,
    syncOffset: 0,
    trackOffsets: {} // Persistent per-song/MV offset storage { [trackKey]: offsetMs }
  };

  const HIGHLIGHT_STYLES = [
    { id: 'apple-glow', label: '✨ Glow', fullName: 'Apple Music Glow (Smooth)' },
    { id: 'karaoke-wave', label: '🌊 Wave', fullName: 'Fluid Gradient Wave' },
    { id: 'gradient-wipe', label: '🎨 Wipe', fullName: 'Continuous Gradient Wipe' },
    { id: 'clean-fade', label: '🍃 Clean', fullName: 'Minimalist Smooth Fade' }
  ];

  let settings = { ...DEFAULT_SETTINGS };

  // Runtime State
  let currentTrackKey = '';
  let currentFetchRequestId = 0;
  let currentLyrics = {
    isSynced: false,
    lines: [],
    plainText: '',
    source: 'none'
  };
  let activeLineIndex = -1;
  let userScrolled = false;
  let userScrollTimeout = null;
  let lastObservedTime = -1;
  let lyricsCache = new Map();

  // --- Extension Context Safety Guard ---
  function isExtensionValid() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  }

  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) {
      if (typeof callback === 'function') callback({ success: false, error: 'Extension context invalidated' });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          // Suppress error or pass empty response
          if (typeof callback === 'function') callback(null);
          return;
        }
        if (typeof callback === 'function') callback(response);
      });
    } catch (e) {
      if (typeof callback === 'function') callback({ success: false, error: e.message });
    }
  }

  // --- Storage & Sync ---
  function loadSettings() {
    if (isExtensionValid() && chrome.storage && chrome.storage.sync) {
      try {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
          if (stored) {
            settings = { ...DEFAULT_SETTINGS, ...stored };
            if (settings.highlightStyle === 'color-neon') {
              settings.highlightStyle = 'gradient-wipe';
            }
            if (stored.appleMode !== undefined && stored.lyricsEnabled === undefined) {
              settings.lyricsEnabled = stored.appleMode;
            }
            applySettingsToDOM();
          }
        });
      } catch (e) {}
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        let lyricsNeedReload = false;
        let lyricsNeedRerender = false;

        for (let key in changes) {
          settings[key] = changes[key].newValue;
          if (key === 'providerOrder' || key === 'enabledProviders') {
            lyricsNeedReload = true;
          }
          if (key === 'furiganaEnabled' || key === 'translationEnabled' || key === 'fontSize' || key === 'wordHighlight' || key === 'lineHighlight' || key === 'highlightStyle') {
            lyricsNeedRerender = true;
            if (key === 'translationEnabled' && changes.translationEnabled.newValue) {
              fetchTranslationForCurrentLyrics();
            }
          }
        }

        applySettingsToDOM();
        updateHeaderUI();

        if (lyricsNeedReload) {
          lyricsCache.clear();
          safeSendMessage({ action: 'CLEAR_CACHE' });
          loadLyricsForCurrentTrack(true);
        } else if (lyricsNeedRerender) {
          renderLyricsUI();
          updateActiveLine();
        } else if (changes.trackOffsets || changes.syncOffset) {
          updateSyncDisplay();
          updateActiveLine();
        }
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'GET_STATUS') {
          const metadata = getCurrentTrackInfo();
          sendResponse({
            track: metadata,
            lyricsSource: currentLyrics.source,
            isSynced: currentLyrics.isSynced,
            lineCount: currentLyrics.lines.length,
            settings: settings
          });
        } else if (request.action === 'SET_OFFSET') {
          settings.syncOffset = request.offset;
          saveSetting('syncOffset', settings.syncOffset);
          updateHeaderUI();
          sendResponse({ success: true, offset: settings.syncOffset });
        }
        return true;
      });
    } catch (e) {}
  }

  function saveSetting(key, val) {
    settings[key] = val;
    if (isExtensionValid() && chrome.storage && chrome.storage.sync) {
      try {
        chrome.storage.sync.set({ [key]: val });
      } catch (e) {}
    }
    applySettingsToDOM();
    if (key === 'furiganaEnabled' || key === 'translationEnabled' || key === 'fontSize' || key === 'wordHighlight' || key === 'lineHighlight' || key === 'highlightStyle') {
      if (currentLyrics.isSynced && currentLyrics.lines.length > 0) {
        renderLyricsUI();
        updateActiveLine();
      } else if (currentLyrics.plainText) {
        renderStaticLyrics(currentLyrics.plainText);
      }
    }
  }

  function getEffectiveOffset() {
    if (currentTrackKey && settings.trackOffsets && typeof settings.trackOffsets[currentTrackKey] === 'number') {
      return settings.trackOffsets[currentTrackKey];
    }
    return settings.syncOffset || 0;
  }

  function adjustTrackOffset(deltaMs) {
    if (!currentTrackKey) return;
    const currentEff = getEffectiveOffset();
    const newOffset = currentEff + deltaMs;
    setTrackOffset(newOffset);
  }

  function setTrackOffset(newOffsetMs) {
    if (!currentTrackKey) return;
    if (!settings.trackOffsets) settings.trackOffsets = {};
    settings.trackOffsets[currentTrackKey] = newOffsetMs;
    saveSetting('trackOffsets', settings.trackOffsets);
    updateSyncDisplay();
    updateActiveLine();
    scrollToActiveLine(true);
  }

  function resetTrackOffset() {
    if (!currentTrackKey) return;
    if (settings.trackOffsets && settings.trackOffsets[currentTrackKey] !== undefined) {
      delete settings.trackOffsets[currentTrackKey];
      saveSetting('trackOffsets', settings.trackOffsets);
    }
    updateSyncDisplay();
    updateActiveLine();
    scrollToActiveLine(true);
  }

  function updateSyncDisplay() {
    const valElem = document.getElementById('am-current-track-sync-val');
    const eff = getEffectiveOffset();
    const sec = (eff / 1000).toFixed(1);
    const label = (eff > 0 ? `+${sec}s` : `${sec}s`);
    if (valElem) {
      valElem.textContent = label;
      if (eff !== 0) valElem.classList.add('has-custom');
      else valElem.classList.remove('has-custom');
    }
    const resetBtn = document.getElementById('am-sync-track-reset');
    if (resetBtn) {
      resetBtn.style.display = (eff !== 0 ? 'inline-flex' : 'none');
    }

    // Also synchronize floating quick action bar sync indicators
    const quickVal = document.getElementById('am-quick-sync-val');
    if (quickVal) {
      quickVal.textContent = label;
      if (eff !== 0) quickVal.classList.add('has-custom');
      else quickVal.classList.remove('has-custom');
    }
    const quickReset = document.getElementById('am-quick-sync-reset');
    if (quickReset) {
      quickReset.style.display = (eff !== 0 ? 'inline-flex' : 'none');
    }

    updateHeaderUI();
  }

  function showToast(message) {
    let toast = document.getElementById('am-sync-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'am-sync-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2500);
  }

  function applySettingsToDOM() {
    const root = document.documentElement;
    // Map blur percentage (0-100%) to px (0-120px)
    const blurPx = Math.round((settings.ambientBlur / 100) * 120);
    // Map spread percentage (0-300%) to decimal ratio (0.0 to 3.0)
    const spreadRatio = (settings.ambientSpread / 100).toFixed(2);
    // Backward compatibility scale (1.0 to 2.5)
    const spreadScale = (1.0 + (settings.ambientSpread / 100) * 0.5).toFixed(3);

    root.style.setProperty('--am-font-size', `${settings.fontSize}px`);
    root.style.setProperty('--am-blur', `${blurPx}px`);
    root.style.setProperty('--am-spread', spreadRatio);
    root.style.setProperty('--am-spread-scale', spreadScale);
    root.style.setProperty('--am-brightness', `${settings.ambientBrightness}%`);
    root.style.setProperty('--am-saturation', `${settings.ambientSaturation}%`);
    root.style.setProperty('--am-fade-duration', settings.ambientFadeDuration > 0 ? `${settings.ambientFadeDuration}s` : '0s');

    const playerAmbient = document.getElementById('am-player-ambient-wrapper');
    if (playerAmbient) {
      playerAmbient.style.display = settings.ambientEnabled ? 'block' : 'none';
    }

    const pageAmbient = document.getElementById('am-page-ambient-backdrop');
    if (pageAmbient) {
      pageAmbient.remove();
    }

    const shelf = getNativeLyricsShelf();
    const isCustomActive = (settings.lyricsEnabled !== false) && (settings.appleMode !== false);
    if (shelf) {
      if (isCustomActive) {
        shelf.classList.remove('am-original-view');
      } else {
        shelf.classList.add('am-original-view');
      }
    }

    const modeBtn = document.getElementById('am-mode-toggle');
    if (modeBtn) {
      modeBtn.textContent = isCustomActive ? 'Original' : 'Synced';
    }

    const wrapper = document.getElementById('am-lyrics-wrapper');
    if (wrapper) {
      wrapper.dataset.highlightStyle = settings.highlightStyle || 'apple-glow';
    }

    if (typeof ambientEngine !== 'undefined' && ambientEngine) {
      ambientEngine.drawFrame(true);
    }
  }

  // ==========================================================================
  // JAPANESE KANJI FURIGANA & GOOGLE TRANSLATION ENGINE
  // ==========================================================================

  let compoundRegex = null;

  function getCompoundRegex() {
    if (!compoundRegex && typeof window !== 'undefined' && window.AM_KANJI_COMPOUNDS) {
      const keys = Object.keys(window.AM_KANJI_COMPOUNDS).sort((a, b) => b.length - a.length);
      if (keys.length > 0) {
        compoundRegex = new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
      }
    }
    return compoundRegex;
  }

  function containsJapanese(text) {
    if (!text) return false;
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
  }

  function containsKanji(text) {
    if (!text) return false;
    return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
  }

  function addFurigana(text) {
    if (!text) return '';
    if (!containsKanji(text)) return escapeHTML(text);

    const compounds = (typeof window !== 'undefined' && window.AM_KANJI_COMPOUNDS) || {};
    const singles = (typeof window !== 'undefined' && window.AM_KANJI_SINGLE) || {};

    let safe = escapeHTML(text);
    const regex = getCompoundRegex();

    // Replace compounds first using unique placeholder markers
    const markers = [];
    if (regex) {
      safe = safe.replace(regex, (match) => {
        const reading = compounds[match];
        if (!reading) return match;
        const id = markers.length;
        markers.push(`<ruby class="am-ruby"><rb>${match}</rb><rt>${reading}</rt></ruby>`);
        return `\uE000${id}\uE001`;
      });
    }

    // Replace single Kanji characters
    safe = safe.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, (ch) => {
      const reading = singles[ch];
      if (reading) {
        return `<ruby class="am-ruby"><rb>${ch}</rb><rt>${reading}</rt></ruby>`;
      }
      return ch;
    });

    // Restore compound markers
    if (markers.length > 0) {
      safe = safe.replace(/\uE000(\d+)\uE001/g, (_, id) => markers[parseInt(id, 10)] || '');
    }

    return safe;
  }

  let isTranslatingLyrics = false;

  function fetchTranslationForCurrentLyrics() {
    if (isTranslatingLyrics) return;
    if (!settings.translationEnabled) return;

    const hasJp = (currentLyrics.isSynced && currentLyrics.lines.some(l => containsJapanese(l.text))) ||
                  (!currentLyrics.isSynced && containsJapanese(currentLyrics.plainText));
    if (!hasJp) return;

    let rawLines = [];
    if (currentLyrics.isSynced) {
      if (currentLyrics.translations && currentLyrics.translations.length === currentLyrics.lines.length) {
        return; // Already translated
      }
      rawLines = currentLyrics.lines.map(l => l.text || '');
    } else if (currentLyrics.plainText) {
      if (currentLyrics.translations && currentLyrics.translations.length > 0) {
        return; // Already translated
      }
      rawLines = currentLyrics.plainText.split('\n').map(l => l.trim());
    }

    if (rawLines.length === 0) return;

    isTranslatingLyrics = true;
    const key = currentTrackKey;

    safeSendMessage({
      action: 'TRANSLATE_LYRICS',
      lines: rawLines,
      cacheKey: key
    }, (response) => {
      isTranslatingLyrics = false;
      if (response && response.success && Array.isArray(response.translations)) {
        if (key !== currentTrackKey) return; // Song changed while fetching
        currentLyrics.translations = response.translations;
        if (currentLyrics.isSynced) {
          currentLyrics.lines.forEach((line, idx) => {
            line.translation = response.translations[idx] || '';
          });
          renderLyricsUI();
          updateActiveLine();
        } else if (currentLyrics.plainText) {
          renderStaticLyrics(currentLyrics.plainText);
        }
      }
    });
  }

  // ==========================================================================
  // MULTI-LEVEL AMBIENT PROJECTOR (INSPIRED BY AMBIENT LIGHT FOR YOUTUBE)
  // ==========================================================================

  class AmbientLightEngine {
    constructor() {
      // 320x180 resolution exceeds Chrome's 257px threshold to ensure hardware GPU acceleration
      this.bufferCanvas = document.createElement('canvas');
      this.bufferCanvas.width = 320;
      this.bufferCanvas.height = 180;
      this.bufferCtx = this.bufferCanvas.getContext('2d', { alpha: false, willReadFrequently: false });

      // Multi-layer projection canvasses
      this.layers = [];
      this.pageCanvas = null;
      this.pageCtx = null;

      this.artworkImg = new Image();
      this.artworkImg.crossOrigin = 'anonymous';
      this.lastDrawTime = 0;
      this.lastDrawnKey = '';
    }

    preloadArtwork(src) {
      if (src && this.artworkImg.src !== src) {
        this.artworkImg = new Image();
        this.artworkImg.crossOrigin = 'anonymous';
        this.artworkImg.src = src;
        this.artworkImg.onload = () => {
          this.drawFrame(true);
        };
      }
    }

    init() {
      this.injectContainers();
      this.startRenderLoop();
    }

    injectContainers() {
      const playerContainer = document.querySelector('ytmusic-player#player') ||
                              document.querySelector('#song-video') ||
                              document.querySelector('ytmusic-player-page#player-page #main-panel');

      if (!playerContainer) return;

      const existingWrapper = document.getElementById('am-player-ambient-wrapper');
      // Re-inject if wrapper is missing, detached from the active document, not inside playerContainer, or layers missing
      if (!existingWrapper || !existingWrapper.isConnected || !playerContainer.contains(existingWrapper) || !this.layers.length) {
        if (existingWrapper) {
          existingWrapper.remove();
        }
        const wrapper = document.createElement('div');
        wrapper.id = 'am-player-ambient-wrapper';

        this.layers = [];
        // Create 3 graduated projection levels (Inner, Mid, Outer bloom)
        for (let i = 1; i <= 3; i++) {
          const cvs = document.createElement('canvas');
          cvs.className = `am-projector-layer-${i}`;
          cvs.width = 640;
          cvs.height = 360;
          const ctx = cvs.getContext('2d', { alpha: false, willReadFrequently: false });
          wrapper.appendChild(cvs);
          this.layers.push({ cvs, ctx });
        }

        playerContainer.insertBefore(wrapper, playerContainer.firstChild);
      }

      // Clean up legacy page ambient backdrop if present to ensure dark background
      const existingPageBackdrop = document.getElementById('am-page-ambient-backdrop');
      if (existingPageBackdrop) {
        existingPageBackdrop.remove();
      }
    }

    getEffectiveSource() {
      // 1. Check DOM Album Artwork (Song Mode / Art Track)
      const songImage = document.querySelector('ytmusic-player #song-image img#img') ||
                        document.querySelector('#song-image img#img') ||
                        document.querySelector('ytmusic-player #song-image img') ||
                        document.querySelector('#song-image img') ||
                        document.querySelector('#song-image yt-img-shadow img') ||
                        document.querySelector('ytmusic-player-bar .image img');

      const isSongImageReady = songImage &&
                               songImage.complete &&
                               songImage.naturalWidth > 0 &&
                               songImage.naturalHeight > 0;

      // 2. Check HTML5 Video (Video Mode / Music Video)
      const video = document.querySelector('video');
      const isVideoReady = video &&
                           video.readyState >= 2 &&
                           video.videoWidth > 0 &&
                           video.videoHeight > 0;

      // In YouTube Music, video mode displays the video container with non-zero dimensions
      const songVideoContainer = document.querySelector('#song-video');
      const isVideoActive = isVideoReady && songVideoContainer && songVideoContainer.offsetParent !== null;

      if (isVideoActive) {
        return { type: 'video', element: video };
      }

      if (isSongImageReady) {
        return { type: 'image', element: songImage };
      }

      // 3. Preloaded high-resolution artwork fallback from MediaSession metadata
      if (this.artworkImg && this.artworkImg.complete && this.artworkImg.naturalWidth > 0) {
        return { type: 'image', element: this.artworkImg };
      }

      // 4. Any ready video element with non-zero dimensions
      if (isVideoReady) {
        return { type: 'video', element: video };
      }

      // 5. Any song image in the DOM as fallback
      if (songImage && songImage.naturalWidth > 0) {
        return { type: 'image', element: songImage };
      }

      return null;
    }

    startRenderLoop() {
      const loop = (timestamp) => {
        if (settings.ambientEnabled && timestamp - this.lastDrawTime >= 33) {
          this.lastDrawTime = timestamp;
          this.drawFrame();
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    renderEdgeSpread(sourceCanvas, ctx, targetW, targetH, spreadVal, blurVal) {
      if (!sourceCanvas || !ctx || targetW <= 0 || targetH <= 0) return;

      const sw = sourceCanvas.width;
      const sh = sourceCanvas.height;
      if (sw === 0 || sh === 0) return;

      ctx.clearRect(0, 0, targetW, targetH);

      const spreadRatio = (spreadVal || 42) / 100.0;

      // 1. Calculate player container dimensions
      const playerContainer = document.querySelector('ytmusic-player#player') ||
                              document.querySelector('#song-video') ||
                              document.querySelector('ytmusic-player-page#player-page #main-panel');
      const pRect = playerContainer ? playerContainer.getBoundingClientRect() : null;
      const pWidth = (pRect && pRect.width > 0) ? pRect.width : 1600;
      const pHeight = (pRect && pRect.height > 0) ? pRect.height : 900;
      const pAspect = pWidth / pHeight;

      // 2. Source intrinsic aspect ratio
      const sAspect = sw / sh;

      // 3. Compute exact visible media rectangle inside player (handling letterbox/pillarbox)
      let visW, visH, visX, visY;
      if (sAspect < pAspect) {
        // Pillarboxed: portrait video (9:16) or square cover (1:1) inside landscape player
        visH = pHeight;
        visW = pHeight * sAspect;
        visX = (pWidth - visW) / 2;
        visY = 0;
      } else if (sAspect > pAspect) {
        // Letterboxed: ultrawide video (21:9)
        visW = pWidth;
        visH = pWidth / sAspect;
        visX = 0;
        visY = (pHeight - visH) / 2;
      } else {
        // Exact 16:9 match
        visW = pWidth;
        visH = pHeight;
        visX = 0;
        visY = 0;
      }

      const fracX = visX / pWidth;
      const fracY = visY / pHeight;
      const fracW = visW / pWidth;
      const fracH = visH / pHeight;

      // 4. Symmetrical margin expansion in ALL directions (matches content.css wrapper)
      const marginFactor = 0.15 + spreadRatio * 0.45;
      const totalScale = 1.0 + 2.0 * marginFactor;

      // 5. Perfectly centered video coordinates inside the ambient canvas
      const vx = Math.round(targetW * ((marginFactor + fracX) / totalScale));
      const vy = Math.round(targetH * ((marginFactor + fracY) / totalScale));
      const vw = Math.round(targetW * (fracW / totalScale));
      const vh = Math.round(targetH * (fracH / totalScale));

      // 6. Sample perimeter edge strips (4% depth)
      const dx = Math.max(2, Math.round(sw * 0.04));
      const dy = Math.max(2, Math.round(sh * 0.04));

      // 7. High-density edge count: fine, dense bands (30 to 80 bands)
      const numBands = Math.max(30, Math.min(80, Math.round((spreadVal || 42) * 0.45) + 16));

      // 8. Draw concentric bands from outer to inner
      for (let k = numBands; k >= 1; k--) {
        const t = k / numBands;
        const prevT = (k - 1) / numBands;

        const bx1 = Math.round(vx - vx * t);
        const by1 = Math.round(vy - vy * t);
        const bx2 = Math.round((vx + vw) + (targetW - (vx + vw)) * t);
        const by2 = Math.round((vy + vh) + (targetH - (vy + vh)) * t);

        const p_bx1 = Math.round(vx - vx * prevT);
        const p_by1 = Math.round(vy - vy * prevT);
        const p_bx2 = Math.round((vx + vw) + (targetW - (vx + vw)) * prevT);
        const p_by2 = Math.round((vy + vh) + (targetH - (vy + vh)) * prevT);

        const w_left = Math.max(1, p_bx1 - bx1);
        const h_left = Math.max(1, by2 - by1);

        const w_right = Math.max(1, bx2 - p_bx2);
        const h_right = Math.max(1, by2 - by1);

        const w_top = Math.max(1, bx2 - bx1);
        const h_top = Math.max(1, p_by1 - by1);

        const w_bot = Math.max(1, bx2 - bx1);
        const h_bot = Math.max(1, by2 - p_by2);

        // 1. Left edge strip (sampled from x=0..dx, y=0..sh)
        ctx.drawImage(sourceCanvas, 0, 0, dx, sh, bx1, by1, w_left, h_left);

        // 2. Right edge strip (sampled from x=sw-dx..sw, y=0..sh)
        ctx.drawImage(sourceCanvas, sw - dx, 0, dx, sh, p_bx2, by1, w_right, h_right);

        // 3. Top edge strip (sampled from x=0..sw, y=0..dy)
        ctx.drawImage(sourceCanvas, 0, 0, sw, dy, bx1, by1, w_top, h_top);

        // 4. Bottom edge strip (sampled from x=0..sw, y=sh-dy..sh)
        ctx.drawImage(sourceCanvas, 0, sh - dy, sw, dy, bx1, p_by2, w_bot, h_bot);

        // 5. Four corners (blend edge corners seamlessly)
        ctx.drawImage(sourceCanvas, 0, 0, dx, dy, bx1, by1, w_left, h_top);
        ctx.drawImage(sourceCanvas, sw - dx, 0, dx, dy, p_bx2, by1, w_right, h_top);
        ctx.drawImage(sourceCanvas, 0, sh - dy, dx, dy, bx1, p_by2, w_left, h_bot);
        ctx.drawImage(sourceCanvas, sw - dx, sh - dy, dx, dy, p_bx2, p_by2, w_right, h_bot);

        // Subtle boundary line when Blur is 0%
        if ((blurVal || 0) === 0) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);
        }
      }

      // Draw original video / album art in center
      ctx.drawImage(sourceCanvas, 0, 0, sw, sh, vx, vy, vw, vh);
    }

    drawFrame(force = false) {
      // 1. Skip drawing if player is minimized to miniplayer
      const playerPage = document.querySelector('ytmusic-player-page#player-page') || document.querySelector('ytmusic-player-page');
      const isMiniplayer = playerPage ? playerPage.getAttribute('player-ui-state') === 'MINIPLAYER' : false;
      const wrapper = document.getElementById('am-player-ambient-wrapper');

      if (isMiniplayer) {
        if (wrapper) wrapper.style.display = 'none';
        return;
      }

      if (wrapper && settings.ambientEnabled) {
        wrapper.style.display = 'block';
      }

      // 2. Self-healing: ensure ambient wrapper is connected to live DOM
      if (!wrapper || !wrapper.isConnected || !this.layers.length) {
        this.injectContainers();
      }

      const source = this.getEffectiveSource();
      if (!source) return;

      // Static Artwork optimization: do not redraw 30fps if static image and spread/blur haven't changed
      if (!force && source.type === 'image') {
        const key = `${source.element.src || source.element.currentSrc}_${settings.ambientSpread}_${settings.ambientBlur}`;
        if (key && key === this.lastDrawnKey) {
          return;
        }
      }

      let drawn = false;

      try {
        if (source.type === 'video') {
          const v = source.element;
          if (v && v.videoWidth > 0 && v.videoHeight > 0) {
            const vAspect = v.videoWidth / v.videoHeight;
            const bw = 320;
            const bh = Math.max(160, Math.min(580, Math.round(320 / vAspect)));
            if (this.bufferCanvas.width !== bw || this.bufferCanvas.height !== bh) {
              this.bufferCanvas.width = bw;
              this.bufferCanvas.height = bh;
            }
            this.bufferCtx.drawImage(v, 0, 0, bw, bh);
            drawn = true;
            this.lastDrawnKey = 'video';
          }
        } else if (source.type === 'image') {
          // Draw Album Artwork directly (100% vibrant, full coverage, zero distortion)
          const img = source.element;
          if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
            const imgAspect = img.naturalWidth / img.naturalHeight;
            const bw = 320;
            const bh = Math.max(160, Math.min(580, Math.round(320 / imgAspect)));
            if (this.bufferCanvas.width !== bw || this.bufferCanvas.height !== bh) {
              this.bufferCanvas.width = bw;
              this.bufferCanvas.height = bh;
            }
            this.bufferCtx.drawImage(img, 0, 0, bw, bh);
            drawn = true;
            this.lastDrawnKey = `${img.src || img.currentSrc || ''}_${settings.ambientSpread}_${settings.ambientBlur}`;
          }
        }
      } catch (e) {
        // Fallback: try drawing preloaded artworkImg
        if (this.artworkImg && this.artworkImg.complete && this.artworkImg.naturalWidth > 0) {
          try {
            this.bufferCtx.drawImage(this.artworkImg, 0, 0, this.bufferCanvas.width, this.bufferCanvas.height);
            drawn = true;
            this.lastDrawnKey = `${this.artworkImg.src || ''}_${settings.ambientSpread}_${settings.ambientBlur}`;
          } catch (err) {}
        }
        // Fallback: try video if valid
        if (!drawn) {
          const v = document.querySelector('video');
          if (v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
            try {
              this.bufferCtx.drawImage(v, 0, 0, this.bufferCanvas.width, this.bufferCanvas.height);
              drawn = true;
              this.lastDrawnKey = 'video';
            } catch (err) {}
          }
        }
      }

      if (!drawn) return;

      // Project onto all 3 graduated layers using perimeter edge-spread projection
      for (const layer of this.layers) {
        if (layer.cvs && layer.cvs.isConnected) {
          this.renderEdgeSpread(
            this.bufferCanvas,
            layer.ctx,
            layer.cvs.width,
            layer.cvs.height,
            settings.ambientSpread,
            settings.ambientBlur
          );
        }
      }
    }
  }

  const ambientEngine = new AmbientLightEngine();

  // ==========================================================================
  // TRACK INFO, COVER DECOMPOSER & LYRICS TAB INTEGRATION
  // ==========================================================================

  function cleanArtistName(artist) {
    if (!artist) return '';
    let cleaned = String(artist).trim();
    // Strip " - Album · Year" or " - Album • Year"
    cleaned = cleaned.replace(/\s*-\s*[^-]+[•·・]\s*\d{4}.*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*[^-]+[•·・].*$/i, '');
    // Strip " • Album • Year" or " · Year"
    cleaned = cleaned.replace(/\s*[•·・]\s*.*$/, '');
    // Strip voice actor tags e.g. (cv.Saori Hayami) or (CV: ...)
    cleaned = cleaned.replace(/\s*[\(（]cv[.:\s][^\)）]+[\)）]/gi, '');
    // Strip topic / VEVO / channel suffixes
    cleaned = cleaned
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/\s*VEVO$/i, '')
      .replace(/\s+(?:Official(?:\s+Channel)?|Topic|Records|Music)$/i, '')
      .trim();
    return cleaned || artist.trim();
  }

  function cleanVideoFluff(str) {
    if (!str) return '';
    return str
      // Bracketed fluff
      .replace(/[\(\[【（［](?:official\s*(?:music\s*)?(?:video|audio|visualizer|lyric\s*video|stream)|music\s*video|mv|visualizer|audio|hd|4k|remaster(?:ed)?|performance|lyric\s*video|lyrics)[\)\]】）］]/gi, '')
      // Trailing unbracketed fluff
      .replace(/\s*(?:[-–—|/]\s*)?(?:official\s*(?:music\s*)?(?:video|audio|visualizer|lyric\s*video|stream)|lyric\s*video|music\s*video|mv|visualizer|audio|hd|4k)\s*$/gi, '')
      // Collaboration / feat tags in title
      .replace(/[\(\[【（［](?:feat\.|ft\.).*?[\)\]】）］]/gi, '')
      .replace(/\s*[-–—|/]\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Intelligently separates Title and Artist from YouTube titles
   */
  function extractTitleAndArtist(rawTitle, rawArtist) {
    let title = (rawTitle || '').trim();
    let artist = cleanArtistName(rawArtist || '');

    // Check CJK quotation marks pattern: e.g. Artist「Title」, 「Title」 - Artist
    const cjkQuoteMatch = title.match(/^(.*?)[「『](.+?)[」』](.*?)$/);
    if (cjkQuoteMatch) {
      const inside = cjkQuoteMatch[2].trim();
      const outside = cleanVideoFluff((cjkQuoteMatch[1] + ' ' + cjkQuoteMatch[3]).trim()).replace(/\s*[-–—|/]\s*$/g, '').trim();
      if (inside) {
        const detectedArtist = outside || artist;
        return {
          primaryTitle: cleanVideoFluff(inside),
          artist: cleanArtistName(detectedArtist) || artist
        };
      }
    }

    // 1. Normalize CJK punctuation & brackets
    title = title
      .replace(/[「『【［]/g, ' [')
      .replace(/[」』】］]/g, '] ')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/／/g, '/')
      .replace(/｜/g, '|')
      .replace(/[–—]/g, '-');

    // 2. Strip comprehensive video/audio fluff
    title = cleanVideoFluff(title);

    // 3. Handle "Artist - Title" vs "Title - Artist" vs Bilingual "TitleA - TitleB"
    if (title.includes(' - ')) {
      const parts = title.split(' - ').map(p => cleanVideoFluff(p.trim())).filter(Boolean);
      if (parts.length >= 2) {
        const left = parts[0];
        const right = parts.slice(1).join(' - ');

        const leftLower = left.toLowerCase();
        const rightLower = right.toLowerCase();
        const artistLower = artist.toLowerCase();

        // If Left matches the known artist -> Left is Artist, Right is Title (Standard YouTube)
        if (artist && (leftLower.includes(artistLower) || artistLower.includes(leftLower))) {
          return { primaryTitle: cleanVideoFluff(right), artist: left };
        }
        // If Right matches the known artist -> Right is Artist, Left is Title
        if (artist && (rightLower.includes(artistLower) || artistLower.includes(rightLower))) {
          return { primaryTitle: cleanVideoFluff(left), artist: right };
        }

        // If an artist is ALREADY known from player metadata and neither part matches artist:
        // Both Left and Right are parts of the title (Bilingual / Dual title e.g. "星降る海 - Starry Sea")!
        if (artist) {
          return { primaryTitle: title, artist };
        }

        // Default YouTube upload convention when NO artist was known: Artist - Title
        return { primaryTitle: cleanVideoFluff(right), artist: left };
      }
    }

    return { primaryTitle: title, artist };
  }

  function decomposeTrackInfo(rawTitle, rawArtist) {
    let title = (rawTitle || '').trim();
    let artist = cleanArtistName(rawArtist || '');

    // Check if cover indicator is present (exclude official releases like acoustic/remix)
    const isCover = /[\(\[【（]?\b(?:covered\s*by|cover(?:\s*ver(?:sion|\.)?)?|歌ってみた|うたってみた)\b[\)\]】）]?/i.test(title);

    // Remove cover tags like (Cover), [Cover], 【covered by Kotoha】, covered by ..., cover ver., etc.
    let cleanedForSplit = title
      .replace(/[\(\[【（](?:covered\s*by|cover(?:\s*ver(?:sion|\.)?)?|歌ってみた|うたってみた).*?[\)\]】）]/gi, '')
      .replace(/\b(?:covered\s*by|cover\s*ver(?:sion|\.)?|cover|歌ってみた)\b.*$/gi, '')
      .trim();

    let primaryTitle = '';
    let originalArtist = '';
    let coverArtist = artist;

    // Split by primary delimiters: / or |
    if (cleanedForSplit.includes('/') || cleanedForSplit.includes('|')) {
      const parts = cleanedForSplit.split(/[/|]/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        if (parts[0].includes(' - ')) {
          const sub = extractTitleAndArtist(parts[0], artist);
          primaryTitle = sub.primaryTitle;
          originalArtist = sub.artist;
          coverArtist = cleanArtistName(parts[1]);
        } else {
          primaryTitle = cleanVideoFluff(parts[0]);
          originalArtist = cleanArtistName(parts[1]);
        }
      } else if (parts.length === 1) {
        const sub = extractTitleAndArtist(parts[0], artist);
        primaryTitle = sub.primaryTitle;
        originalArtist = sub.artist;
      }
    } else {
      const sub = extractTitleAndArtist(cleanedForSplit, artist);
      primaryTitle = sub.primaryTitle;
      originalArtist = sub.artist;
    }

    primaryTitle = cleanVideoFluff(primaryTitle);
    originalArtist = cleanArtistName(originalArtist);
    coverArtist = cleanArtistName(coverArtist);

    return {
      rawTitle,
      rawArtist,
      primaryTitle: primaryTitle || cleanVideoFluff(title),
      originalArtist: originalArtist || artist,
      coverArtist,
      isCover
    };
  }

  function cleanTrackTitle(title) {
    if (!title) return '';
    const decomposed = decomposeTrackInfo(title, '');
    return decomposed.primaryTitle || cleanVideoFluff(title);
  }

  function getCurrentTrackInfo() {
    let title = '';
    let artist = '';
    let album = '';
    let artwork = '';
    let duration = 0;

    if (navigator.mediaSession && navigator.mediaSession.metadata) {
      const meta = navigator.mediaSession.metadata;
      title = meta.title || '';
      artist = meta.artist || '';
      album = meta.album || '';
      if (meta.artwork && meta.artwork.length > 0) {
        artwork = meta.artwork[meta.artwork.length - 1].src || '';
      }
    }

    if (!title) {
      const titleElem = document.querySelector('ytmusic-player-bar .title');
      if (titleElem) title = titleElem.textContent.trim();
    }

    if (!artist) {
      const bylineElem = document.querySelector('ytmusic-player-bar .byline');
      if (bylineElem) artist = bylineElem.textContent.trim();
    }

    if (!artwork) {
      const imgElem = document.querySelector('ytmusic-player-bar img#img') || document.querySelector('ytmusic-player-bar .image img');
      if (imgElem) artwork = imgElem.src;
    }

    const video = document.querySelector('video');
    if (video && !isNaN(video.duration) && video.duration > 0) {
      duration = Math.round(video.duration);
    }

    const decomposed = decomposeTrackInfo(title, artist);

    return {
      title,
      cleanTitle: decomposed.primaryTitle || cleanTrackTitle(title),
      artist,
      cleanArtist: decomposed.originalArtist || cleanArtistName(artist),
      originalArtist: decomposed.originalArtist,
      album,
      artwork,
      duration
    };
  }

  // ==========================================================================
  // NATIVE LYRICS TAB FORCING & VIEWPORT INTEGRATION
  // ==========================================================================

  let isCustomLyricsTabActive = false;
  let isLoadingLyrics = false;

  function hideNativeLyricsUnavailableMessage() {
    const messages = document.querySelectorAll(
      'ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"] ytmusic-message-renderer, ' +
      'ytmusic-tab-renderer[tab-id="FEmusic_lyrics"] ytmusic-message-renderer, ' +
      'ytmusic-tab-renderer.am-lyrics-tab-active ytmusic-message-renderer, ' +
      '#side-panel ytmusic-message-renderer, ' +
      'ytmusic-message-renderer'
    );
    messages.forEach(m => {
      m.style.setProperty('display', 'none', 'important');
      m.style.setProperty('visibility', 'hidden', 'important');
      m.style.setProperty('height', '0px', 'important');
    });
  }

  function renderLoadingState(title) {
    const listContainer = document.getElementById('am-lyrics-list');
    if (!listContainer) return;
    listContainer.innerHTML = `
      <div class="am-loading-state">
        <div class="am-spinner"></div>
        <div class="am-state-title">${escapeHTML(title || 'Loading Lyrics')}</div>
        <div class="am-state-desc">Fetching synchronized lyrics & analyzing song...</div>
      </div>
    `;
  }

  function renderEmptyState() {
    const listContainer = document.getElementById('am-lyrics-list');
    if (!listContainer) return;
    listContainer.innerHTML = `
      <div class="am-empty-state">
        <div class="am-state-title">No Lyrics Found</div>
        <div class="am-state-desc">Lyrics are not available for this track yet.</div>
      </div>
    `;
  }

  function renderCurrentLyricsState() {
    hideNativeLyricsUnavailableMessage();
    if (isLoadingLyrics) {
      renderLoadingState(getCurrentTrackInfo().title);
    } else if (currentLyrics.isSynced && currentLyrics.lines.length > 0) {
      renderLyricsUI();
      if (settings.translationEnabled && (!currentLyrics.translations || currentLyrics.translations.length === 0)) {
        fetchTranslationForCurrentLyrics();
      }
    } else if (currentLyrics.plainText) {
      renderStaticLyrics(currentLyrics.plainText);
      if (settings.translationEnabled && (!currentLyrics.translations || currentLyrics.translations.length === 0)) {
        fetchTranslationForCurrentLyrics();
      }
    } else {
      renderEmptyState();
    }
  }

  function getNativeLyricsTabRenderer() {
    return document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
           document.querySelector('ytmusic-tab-renderer[tab-id="FEmusic_lyrics"]');
  }

  function getNativeLyricsShelf() {
    const tabRenderer = getNativeLyricsTabRenderer();
    if (tabRenderer) {
      return tabRenderer.querySelector('ytmusic-description-shelf-renderer');
    }
    return document.querySelector('#side-panel ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"] ytmusic-description-shelf-renderer') ||
           document.querySelector('#side-panel ytmusic-tab-renderer[tab-id="FEmusic_lyrics"] ytmusic-description-shelf-renderer');
  }

  function getNativeLyricsTab() {
    return document.querySelector('tp-yt-paper-tab[tab-id="FEmusic_lyrics"]') ||
           Array.from(document.querySelectorAll('tp-yt-paper-tab')).find(t => {
             const txt = (t.textContent || '').trim().toLowerCase();
             return txt === 'lyrics' || txt === '歌詞';
           });
  }

  function getAllSidePanelTabs() {
    const parentTabs = document.querySelector('ytmusic-player-page #side-panel tp-yt-paper-tabs') ||
                       document.querySelector('ytmusic-player-page tp-yt-paper-tabs') ||
                       document.querySelector('tp-yt-paper-tabs');
    if (parentTabs) {
      return Array.from(parentTabs.querySelectorAll('tp-yt-paper-tab'));
    }
    return Array.from(document.querySelectorAll('tp-yt-paper-tab'));
  }

  function forceEnableNativeLyricsTab() {
    const lyricsTab = getNativeLyricsTab();
    if (!lyricsTab) return;

    // Remove disabled flags so the native YouTube Music lyrics tab can be clicked
    lyricsTab.removeAttribute('disabled');
    lyricsTab.setAttribute('aria-disabled', 'false');
    lyricsTab.classList.remove('disabled');

    // Intercept click on the native lyrics tab
    if (!lyricsTab._amLyricsClickBound) {
      lyricsTab._amLyricsClickBound = true;
      lyricsTab.addEventListener('click', () => {
        setTimeout(() => {
          activateLyricsTab();
        }, 50);
      }, true);
    }

    // Attach click listeners to sibling tabs (UP NEXT, RELATED, COMMENTS) to hide custom lyrics container
    const allTabs = getAllSidePanelTabs();
    allTabs.forEach(tab => {
      if (tab !== lyricsTab && !tab._amOtherTabClickBound) {
        tab._amOtherTabClickBound = true;
        tab.addEventListener('click', () => {
          deactivateCustomLyricsTab();
        });
      }
    });
  }

  function activateLyricsTab() {
    hideNativeLyricsUnavailableMessage();

    const lyricsTab = getNativeLyricsTab();
    if (lyricsTab) {
      const allTabs = getAllSidePanelTabs();
      allTabs.forEach(t => {
        if (t !== lyricsTab) {
          t.classList.remove('iron-selected');
          t.setAttribute('aria-selected', 'false');
        }
      });
      lyricsTab.classList.add('iron-selected');
      lyricsTab.setAttribute('aria-selected', 'true');
    }

    const nativeTabRenderer = getNativeLyricsTabRenderer();
    const nativeShelf = getNativeLyricsShelf();
    const hasNativeContainer = nativeShelf || (nativeTabRenderer && !nativeTabRenderer.hidden && nativeTabRenderer.style.display !== 'none');

    // If native container exists in DOM and is active
    if (hasNativeContainer) {
      deactivateCustomLyricsTabOnly();
      injectLyricsWrapper();
      renderCurrentLyricsState();
      return;
    }

    // Otherwise, native lyrics are absent: render inside our custom lyrics container inside #side-panel
    isCustomLyricsTabActive = true;
    const sidePanel = document.querySelector('ytmusic-player-page #side-panel') ||
                      document.querySelector('#side-panel');
    if (!sidePanel) return;

    let customRenderer = document.getElementById('am-custom-lyrics-tab-renderer');
    if (!customRenderer || !customRenderer.isConnected || !sidePanel.contains(customRenderer)) {
      if (customRenderer) customRenderer.remove();
      customRenderer = document.createElement('div');
      customRenderer.id = 'am-custom-lyrics-tab-renderer';
      sidePanel.appendChild(customRenderer);
    }
    customRenderer.classList.remove('am-hidden');

    // Hide queue, related, comments or other tab content in sidePanel
    Array.from(sidePanel.children).forEach(child => {
      if (child !== customRenderer &&
          child.tagName.toLowerCase() !== 'tp-yt-paper-tabs' &&
          !child.querySelector('tp-yt-paper-tabs')) {
        child.classList.add('am-native-tab-hidden');
      }
    });

    let wrapper = document.getElementById('am-lyrics-wrapper');
    if (!wrapper || !wrapper.isConnected || !customRenderer.contains(wrapper)) {
      if (wrapper) wrapper.remove();
      wrapper = createLyricsDOM();
      customRenderer.appendChild(wrapper);
    }

    renderCurrentLyricsState();
    scrollToActiveLine(true);
  }

  function deactivateCustomLyricsTab() {
    isCustomLyricsTabActive = false;
    const customRenderer = document.getElementById('am-custom-lyrics-tab-renderer');
    if (customRenderer) {
      customRenderer.classList.add('am-hidden');
    }

    const sidePanel = document.querySelector('ytmusic-player-page #side-panel') ||
                      document.querySelector('#side-panel');
    if (sidePanel) {
      Array.from(sidePanel.querySelectorAll('.am-native-tab-hidden')).forEach(el => {
        el.classList.remove('am-native-tab-hidden');
      });
    }

    const lyricsTab = getNativeLyricsTab();
    if (lyricsTab) {
      lyricsTab.classList.remove('iron-selected');
      lyricsTab.setAttribute('aria-selected', 'false');
    }
  }

  function deactivateCustomLyricsTabOnly() {
    isCustomLyricsTabActive = false;
    const customRenderer = document.getElementById('am-custom-lyrics-tab-renderer');
    if (customRenderer) {
      customRenderer.classList.add('am-hidden');
    }
    const sidePanel = document.querySelector('ytmusic-player-page #side-panel') ||
                      document.querySelector('#side-panel');
    if (sidePanel) {
      Array.from(sidePanel.querySelectorAll('.am-native-tab-hidden')).forEach(el => {
        el.classList.remove('am-native-tab-hidden');
      });
    }
  }

  function injectLyricsWrapper() {
    hideNativeLyricsUnavailableMessage();
    const shelf = getNativeLyricsShelf();
    const tabRenderer = getNativeLyricsTabRenderer();

    if (shelf) {
      let wrapper = document.getElementById('am-lyrics-wrapper');
      if (!wrapper || !wrapper.isConnected || !shelf.contains(wrapper)) {
        if (wrapper) wrapper.remove();
        wrapper = createLyricsDOM();
        shelf.insertBefore(wrapper, shelf.firstChild);
      }
      shelf.classList.remove('am-original-view');
      return true;
    } else if (tabRenderer && !tabRenderer.hidden && tabRenderer.style.display !== 'none') {
      tabRenderer.classList.add('am-lyrics-tab-active');
      let wrapper = document.getElementById('am-lyrics-wrapper');
      if (!wrapper || !wrapper.isConnected || !tabRenderer.contains(wrapper)) {
        if (wrapper) wrapper.remove();
        wrapper = createLyricsDOM();
        tabRenderer.insertBefore(wrapper, tabRenderer.firstChild);
      }
      return true;
    } else if (isCustomLyricsTabActive) {
      const sidePanel = document.querySelector('ytmusic-player-page #side-panel') ||
                        document.querySelector('#side-panel');
      if (!sidePanel) return false;
      let customRenderer = document.getElementById('am-custom-lyrics-tab-renderer');
      if (!customRenderer || !customRenderer.isConnected || !sidePanel.contains(customRenderer)) {
        if (customRenderer) customRenderer.remove();
        customRenderer = document.createElement('div');
        customRenderer.id = 'am-custom-lyrics-tab-renderer';
        sidePanel.appendChild(customRenderer);
      }
      customRenderer.classList.remove('am-hidden');

      let wrapper = document.getElementById('am-lyrics-wrapper');
      if (!wrapper || !wrapper.isConnected || !customRenderer.contains(wrapper)) {
        if (wrapper) wrapper.remove();
        wrapper = createLyricsDOM();
        customRenderer.appendChild(wrapper);
      }
      return true;
    }
    return false;
  }

  function injectIntegratedTriggers() {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return;

    // 1. In player bar right-controls (Bottom Right)
    const rightControls = playerBar.querySelector('.right-controls-buttons') ||
                          document.querySelector('#right-controls-buttons') ||
                          playerBar;

    let btn = document.getElementById('am-player-bar-trigger-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'am-player-bar-trigger-btn';
      btn.className = 'am-player-bar-trigger';
      btn.title = 'Settings (Ambient Light, Lyrics & Sync)';
      btn.setAttribute('aria-label', 'Ambient Light & Synced Lyrics Settings');
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
        </svg>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleIntegratedModal();
      });
      rightControls.appendChild(btn);
    } else {
      // Ensure it stays anchored at the bottom-right of right-controls
      if (btn.parentElement !== rightControls || rightControls.lastElementChild !== btn) {
        rightControls.appendChild(btn);
      }
    }

    // 2. Ensure modal overlay exists
    injectIntegratedModal();
  }

  function createLyricsDOM() {
    const wrapper = document.createElement('div');
    wrapper.id = 'am-lyrics-wrapper';
    wrapper.dataset.highlightStyle = settings.highlightStyle || 'apple-glow';

    wrapper.innerHTML = `
      <!-- Quick Floating Action Widget (Circle expanding downwards as clean popover card) -->
      <div id="am-quick-tools-widget" class="am-quick-tools-widget">
        <button id="am-quick-tools-toggle" class="am-quick-circle-btn" title="Quick Tools (Furigana, Translation, Style & Audio Sync)">
          <span class="am-quick-circle-icon" id="am-quick-circle-icon">文A</span>
        </button>

        <div id="am-quick-tools-bar" class="am-quick-tools-bar">
          <div class="am-quick-tools-row">
            <!-- Japanese Furigana & Translation Segment -->
            <div id="am-quick-jp-section" class="am-quick-section">
              <span class="am-quick-section-label">🇯🇵</span>
              <div class="am-quick-pills-group">
                <button class="am-quick-pill" id="am-quick-furigana-btn" title="Toggle Hiragana readings under Kanji">ふりがな</button>
                <button class="am-quick-pill" id="am-quick-translate-btn" title="Toggle English translation sub-lines">Translate EN</button>
              </div>
            </div>

            <!-- Highlight Animation Style Segment -->
            <div id="am-quick-style-section" class="am-quick-section">
              <div class="am-quick-pills-group">
                <button class="am-quick-pill" id="am-quick-style-btn" title="Cycle Highlight Animation Style">✨ Glow</button>
              </div>
            </div>
          </div>

          <!-- Audio Sync Offset Segment -->
          <div class="am-quick-tools-row" id="am-quick-sync-row">
            <div id="am-quick-sync-section" class="am-quick-section">
              <span class="am-quick-section-label">Sync</span>
              <button class="am-quick-nudge-btn" data-delta="-500" title="Shift lyrics earlier by 0.5s">-0.5s</button>
              <button class="am-quick-nudge-btn" data-delta="-100" title="Shift lyrics earlier by 0.1s">-0.1s</button>
              <span class="am-quick-sync-val" id="am-quick-sync-val">0.0s</span>
              <button class="am-quick-nudge-btn" data-delta="100" title="Shift lyrics later by 0.1s">+0.1s</button>
              <button class="am-quick-nudge-btn" data-delta="500" title="Shift lyrics later by 0.5s">+0.5s</button>
              <button class="am-quick-reset-btn" id="am-quick-sync-reset" title="Reset track sync offset">↺</button>
            </div>
          </div>
        </div>
      </div>

      <div id="am-lyrics-scroll-container">
        <div id="am-lyrics-list"></div>
      </div>

      <button id="am-resume-scroll-btn" title="Jump back to current lyric line">
        <span class="am-resume-pulse-dot"></span>
        <span>Resume Sync</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
      </button>
    `;

    // Wire Quick Tools Widget toggle
    const widget = wrapper.querySelector('#am-quick-tools-widget');
    const toggleBtn = wrapper.querySelector('#am-quick-tools-toggle');
    if (toggleBtn && widget) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        widget.classList.toggle('expanded');
      });

      document.addEventListener('click', (e) => {
        if (widget.classList.contains('expanded') && !widget.contains(e.target)) {
          widget.classList.remove('expanded');
        }
      });
    }

    // Furigana pill
    const furiganaBtn = wrapper.querySelector('#am-quick-furigana-btn');
    if (furiganaBtn) {
      furiganaBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.furiganaEnabled = !settings.furiganaEnabled;
        saveSetting('furiganaEnabled', settings.furiganaEnabled);
        furiganaBtn.classList.toggle('active', settings.furiganaEnabled !== false);
        showToast(settings.furiganaEnabled !== false ? 'Kanji Furigana: Enabled' : 'Kanji Furigana: Disabled');
        if (currentLyrics.isSynced && currentLyrics.lines.length > 0) {
          renderLyricsUI();
          updateActiveLine();
        } else if (currentLyrics.plainText) {
          renderStaticLyrics(currentLyrics.plainText);
        }
      });
    }

    // Translate pill
    const translateBtn = wrapper.querySelector('#am-quick-translate-btn');
    if (translateBtn) {
      translateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.translationEnabled = !settings.translationEnabled;
        saveSetting('translationEnabled', settings.translationEnabled);
        translateBtn.classList.toggle('active', Boolean(settings.translationEnabled));
        showToast(settings.translationEnabled ? 'Translation EN: Enabled' : 'Translation EN: Disabled');
        if (settings.translationEnabled) {
          fetchTranslationForCurrentLyrics();
        }
        if (currentLyrics.isSynced && currentLyrics.lines.length > 0) {
          renderLyricsUI();
          updateActiveLine();
        } else if (currentLyrics.plainText) {
          renderStaticLyrics(currentLyrics.plainText);
        }
      });
    }

    // Highlight Style cycle button
    const styleBtn = wrapper.querySelector('#am-quick-style-btn');
    if (styleBtn) {
      const curStyle = HIGHLIGHT_STYLES.find(s => s.id === (settings.highlightStyle || 'apple-glow')) || HIGHLIGHT_STYLES[0];
      styleBtn.textContent = curStyle.label;
      styleBtn.title = `Style: ${curStyle.fullName} (Click to switch)`;

      styleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentId = settings.highlightStyle || 'apple-glow';
        const currentIndex = HIGHLIGHT_STYLES.findIndex(s => s.id === currentId);
        const nextIndex = (currentIndex + 1) % HIGHLIGHT_STYLES.length;
        const nextStyle = HIGHLIGHT_STYLES[nextIndex];
        saveSetting('highlightStyle', nextStyle.id);
        styleBtn.textContent = nextStyle.label;
        styleBtn.title = `Style: ${nextStyle.fullName} (Click to switch)`;
        showToast(`Highlight style: ${nextStyle.fullName}`);
      });
    }

    // Audio Sync nudge buttons inside quick tools bar
    const nudgeBtns = wrapper.querySelectorAll('.am-quick-nudge-btn');
    nudgeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const delta = parseInt(btn.dataset.delta, 10);
        if (!isNaN(delta)) {
          adjustTrackOffset(delta);
          const current = getEffectiveOffset();
          const sign = current > 0 ? '+' : '';
          showToast(`Audio sync: ${sign}${(current / 1000).toFixed(1)}s`);
        }
      });
    });

    const quickResetBtn = wrapper.querySelector('#am-quick-sync-reset');
    if (quickResetBtn) {
      quickResetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetTrackOffset();
        showToast('Audio sync reset to 0.0s');
      });
    }

    const resumeBtn = wrapper.querySelector('#am-resume-scroll-btn');
    resumeBtn.addEventListener('click', () => {
      userScrolled = false;
      resumeBtn.classList.remove('visible');
      scrollToActiveLine(true);
    });

    const scrollContainer = wrapper.querySelector('#am-lyrics-scroll-container');
    scrollContainer.addEventListener('wheel', handleManualScroll, { passive: true });
    scrollContainer.addEventListener('touchmove', handleManualScroll, { passive: true });

    return wrapper;
  }

  function handleManualScroll() {
    if (!currentLyrics.isSynced || currentLyrics.lines.length === 0) return;

    userScrolled = true;
    const resumeBtn = document.getElementById('am-resume-scroll-btn');
    if (resumeBtn) resumeBtn.classList.add('visible');

    if (userScrollTimeout) {
      clearTimeout(userScrollTimeout);
      userScrollTimeout = null;
    }
  }

  function updateHeaderUI() {
    const offsetDisplay = document.getElementById('am-offset-display');
    if (offsetDisplay) {
      const eff = getEffectiveOffset();
      const sec = (eff / 1000).toFixed(1);
      offsetDisplay.textContent = (eff > 0 ? `+${sec}s` : `${sec}s`);
    }

    const dot = document.getElementById('am-status-dot');
    const text = document.getElementById('am-status-text');
    if (dot && text) {
      if (currentLyrics.isSynced) {
        dot.className = 'am-status-dot';
        text.textContent = `Synced (${currentLyrics.source})`;
      } else {
        dot.className = 'am-status-dot unsynced';
        text.textContent = currentLyrics.source === 'native' ? 'Standard (YT)' : 'Standard Lyrics';
      }
    }
  }

  // ==========================================================================
  // IN-PAGE INTEGRATED SETTINGS MODAL
  // ==========================================================================

  let activeSettingsTab = 'ambient';

  function resetModalPosition(panel) {
    if (!panel) return;
    panel.style.left = 'auto';
    panel.style.top = 'auto';
    panel.style.right = '20px';
    panel.style.bottom = '80px';
    panel.style.transform = '';
  }

  function injectIntegratedModal() {
    if (document.getElementById('am-integrated-settings-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'am-integrated-settings-overlay';

    overlay.innerHTML = `
      <div id="am-integrated-settings-panel">
        <div class="am-modal-header" title="Drag to move • Double-click to snap to bottom-right">
          <div class="am-modal-title">
            <svg class="am-settings-gear-svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
            <span>Settings</span>
          </div>
          <div class="am-modal-header-actions">
            <button class="am-modal-reset-pos-btn" id="am-modal-reset-pos-btn" title="Snap to bottom-right">📍</button>
            <button class="am-modal-close-btn" id="am-modal-close-btn" title="Close (Esc)">✕</button>
          </div>
        </div>

        <!-- Segmented Tab Navigation -->
        <div class="am-modal-nav-tabs">
          <button class="am-tab-btn active" data-tab="ambient">
            <span class="am-tab-icon">💡</span> Ambient Light
          </button>
          <button class="am-tab-btn" data-tab="lyrics">
            <span class="am-tab-icon">🎵</span> Lyrics & Sync
          </button>
          <button class="am-tab-btn" data-tab="providers">
            <span class="am-tab-icon">🌐</span> Providers
          </button>
        </div>

        <div class="am-modal-body">
          <!-- Tab 1: Ambient Light -->
          <div class="am-tab-content active" id="am-tab-ambient">
            <div class="am-settings-section">
              <div class="am-section-header">
                <span class="am-section-title">Ambient Lighting</span>
                <button class="am-section-reset-btn" id="am-reset-ambient-btn">Reset Section ↺</button>
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <span>Blur</span>
                  <span class="am-control-val" id="am-val-blur">30%</span>
                </div>
                <input type="range" class="am-slider-input" id="am-inp-blur" min="0" max="100" step="1" value="30">
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <span>Spread</span>
                  <span class="am-control-val" id="am-val-spread">134.9%</span>
                </div>
                <input type="range" class="am-slider-input" id="am-inp-spread" min="0" max="300" step="1" value="135">
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <span>Fade in duration</span>
                  <span class="am-control-val" id="am-val-fade">Off</span>
                </div>
                <input type="range" class="am-slider-input" id="am-inp-fade" min="0" max="3" step="0.1" value="0">
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <span>Brightness</span>
                  <span class="am-control-val" id="am-val-brightness">100%</span>
                </div>
                <input type="range" class="am-slider-input" id="am-inp-brightness" min="50" max="200" step="5" value="100">
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <span>Saturation</span>
                  <span class="am-control-val" id="am-val-saturation">120%</span>
                </div>
                <input type="range" class="am-slider-input" id="am-inp-saturation" min="50" max="200" step="5" value="120">
              </div>
            </div>
          </div>

          <!-- Tab 2: Synced Lyrics Display & Timing -->
          <div class="am-tab-content" id="am-tab-lyrics">
            <div class="am-settings-section">
              <div class="am-section-header">
                <span class="am-section-title">Lyrics & Display</span>
                <button class="am-section-reset-btn" id="am-reset-lyrics-btn">Reset Section ↺</button>
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <div>
                    <span>Highlight Active Lyric Line</span>
                    <div class="am-control-subdesc">Highlight and track the current lyric line as song progresses</div>
                  </div>
                  <label class="am-toggle-switch">
                    <input type="checkbox" id="am-inp-line-highlight">
                    <span class="am-toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <div>
                    <span>Sync Highlight to Specific Words</span>
                    <div class="am-control-subdesc">Syllable-by-syllable karaoke highlight matching exact vocals</div>
                  </div>
                  <label class="am-toggle-switch">
                    <input type="checkbox" id="am-inp-word-highlight">
                    <span class="am-toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <div>
                    <span>Highlight Animation Style</span>
                    <div class="am-control-subdesc">Visual animation effect on singing lyrics</div>
                  </div>
                  <select id="am-inp-highlight-style" class="am-select-input">
                    <option value="apple-glow">✨ Apple Glow (Smooth)</option>
                    <option value="karaoke-wave">🌊 Fluid Gradient Wave</option>
                    <option value="gradient-wipe">🎨 Continuous Gradient Wipe</option>
                    <option value="clean-fade">🍃 Minimalist Smooth Fade</option>
                  </select>
                </div>
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <div>
                    <span>Kanji Furigana (Hiragana Reading)</span>
                    <div class="am-control-subdesc">Show Hiragana readings (e.g. さかな) under Kanji characters</div>
                  </div>
                  <label class="am-toggle-switch">
                    <input type="checkbox" id="am-inp-furigana">
                    <span class="am-toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <div>
                    <span>Translate Japanese Lyrics to English</span>
                    <div class="am-control-subdesc">Show translated English subtitles under lyric lines via Google Translate</div>
                  </div>
                  <label class="am-toggle-switch">
                    <input type="checkbox" id="am-inp-translation">
                    <span class="am-toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <span>Font Size</span>
                  <span class="am-control-val" id="am-val-fontsize">26px</span>
                </div>
                <input type="range" class="am-slider-input" id="am-inp-fontsize" min="18" max="38" step="1" value="26">
              </div>

              <div class="am-control-row">
                <div class="am-control-label-row">
                  <span>Base Audio Sync Offset</span>
                  <span class="am-control-val" id="am-val-offset">0.0s</span>
                </div>
                <input type="range" class="am-slider-input" id="am-inp-offset" min="-2500" max="2500" step="50" value="0">
              </div>
            </div>
          </div>

          <!-- Tab 3: Lyrics Providers -->
          <div class="am-tab-content" id="am-tab-providers">
            <div class="am-settings-section">
              <div class="am-section-header">
                <span class="am-section-title">Lyrics Provider Priority</span>
                <button class="am-section-reset-btn" id="am-reset-providers-btn">Reset Section ↺</button>
              </div>
              <div class="am-provider-list" id="am-provider-list-container"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const panel = overlay.querySelector('#am-integrated-settings-panel');
    const header = overlay.querySelector('.am-modal-header');
    if (panel && header) {
      setupModalDragging(panel, header);
    }

    // Segmented tab navigation
    const tabBtns = overlay.querySelectorAll('.am-tab-btn');
    const tabContents = overlay.querySelectorAll('.am-tab-content');

    function switchTab(tabKey) {
      activeSettingsTab = tabKey;
      tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabKey));
      tabContents.forEach(content => content.classList.toggle('active', content.id === `am-tab-${tabKey}`));
    }

    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        switchTab(btn.dataset.tab);
      });
    });

    const resetPosBtn = overlay.querySelector('#am-modal-reset-pos-btn');
    if (resetPosBtn) {
      resetPosBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetModalPosition(panel);
      });
    }

    header.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      resetModalPosition(panel);
    });

    overlay.querySelector('#am-modal-close-btn').addEventListener('click', toggleIntegratedModal);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        toggleIntegratedModal();
      }
    });

    // Dismiss modal or quick tools bar on outside pointer down
    document.addEventListener('pointerdown', (e) => {
      const ov = document.getElementById('am-integrated-settings-overlay');
      if (ov && ov.classList.contains('visible')) {
        const p = document.getElementById('am-integrated-settings-panel');
        const trigger = document.getElementById('am-player-bar-trigger-btn');
        const footerBtn = document.getElementById('am-footer-settings-btn');
        if (p && !p.contains(e.target) && (!trigger || !trigger.contains(e.target)) && (!footerBtn || !footerBtn.contains(e.target))) {
          toggleIntegratedModal();
        }
      }

      const quickWidget = document.getElementById('am-quick-tools-widget');
      if (quickWidget && quickWidget.classList.contains('expanded')) {
        if (!quickWidget.contains(e.target)) {
          quickWidget.classList.remove('expanded');
        }
      }
    });

    // Section 1: Ambient Inputs
    const inpBlur = overlay.querySelector('#am-inp-blur');
    const valBlur = overlay.querySelector('#am-val-blur');
    inpBlur.addEventListener('input', () => {
      valBlur.textContent = `${inpBlur.value}%`;
      saveSetting('ambientBlur', parseInt(inpBlur.value, 10));
      applySettingsToDOM();
    });

    const inpSpread = overlay.querySelector('#am-inp-spread');
    const valSpread = overlay.querySelector('#am-val-spread');
    inpSpread.addEventListener('input', () => {
      valSpread.textContent = `${inpSpread.value}%`;
      saveSetting('ambientSpread', parseInt(inpSpread.value, 10));
      applySettingsToDOM();
    });

    const inpFade = overlay.querySelector('#am-inp-fade');
    const valFade = overlay.querySelector('#am-val-fade');
    inpFade.addEventListener('input', () => {
      const v = parseFloat(inpFade.value);
      valFade.textContent = v === 0 ? 'Off' : `${v.toFixed(1)}s`;
      saveSetting('ambientFadeDuration', v);
      applySettingsToDOM();
    });

    const inpBright = overlay.querySelector('#am-inp-brightness');
    const valBright = overlay.querySelector('#am-val-brightness');
    inpBright.addEventListener('input', () => {
      valBright.textContent = `${inpBright.value}%`;
      saveSetting('ambientBrightness', parseInt(inpBright.value, 10));
      applySettingsToDOM();
    });

    const inpSat = overlay.querySelector('#am-inp-saturation');
    const valSat = overlay.querySelector('#am-val-saturation');
    inpSat.addEventListener('input', () => {
      valSat.textContent = `${inpSat.value}%`;
      saveSetting('ambientSaturation', parseInt(inpSat.value, 10));
      applySettingsToDOM();
    });

    // Reset Ambient Section
    overlay.querySelector('#am-reset-ambient-btn').addEventListener('click', () => {
      settings.ambientBlur = DEFAULT_SETTINGS.ambientBlur;
      settings.ambientSpread = DEFAULT_SETTINGS.ambientSpread;
      settings.ambientFadeDuration = DEFAULT_SETTINGS.ambientFadeDuration;
      settings.ambientBrightness = DEFAULT_SETTINGS.ambientBrightness;
      settings.ambientSaturation = DEFAULT_SETTINGS.ambientSaturation;
      saveSetting('ambientBlur', settings.ambientBlur);
      saveSetting('ambientSpread', settings.ambientSpread);
      saveSetting('ambientFadeDuration', settings.ambientFadeDuration);
      saveSetting('ambientBrightness', settings.ambientBrightness);
      saveSetting('ambientSaturation', settings.ambientSaturation);
      updateModalInputsFromSettings();
      applySettingsToDOM();
    });

    // Section 3: Lyrics Inputs
    const inpLineHighlight = overlay.querySelector('#am-inp-line-highlight');
    if (inpLineHighlight) {
      inpLineHighlight.addEventListener('change', () => {
        saveSetting('lineHighlight', inpLineHighlight.checked);
        applySettingsToDOM();
        updateActiveLine();
      });
    }

    const inpWordHighlight = overlay.querySelector('#am-inp-word-highlight');
    if (inpWordHighlight) {
      inpWordHighlight.addEventListener('change', () => {
        saveSetting('wordHighlight', inpWordHighlight.checked);
        applySettingsToDOM();
        updateActiveLine();
      });
    }

    const inpHighlightStyle = overlay.querySelector('#am-inp-highlight-style');
    if (inpHighlightStyle) {
      inpHighlightStyle.addEventListener('change', () => {
        saveSetting('highlightStyle', inpHighlightStyle.value);
        applySettingsToDOM();
      });
    }

    const inpFurigana = overlay.querySelector('#am-inp-furigana');
    if (inpFurigana) {
      inpFurigana.addEventListener('change', () => {
        saveSetting('furiganaEnabled', inpFurigana.checked);
        if (currentLyrics.isSynced && currentLyrics.lines.length > 0) {
          renderLyricsUI();
          updateActiveLine();
        } else if (currentLyrics.plainText) {
          renderStaticLyrics(currentLyrics.plainText);
        }
      });
    }

    const inpTranslation = overlay.querySelector('#am-inp-translation');
    if (inpTranslation) {
      inpTranslation.addEventListener('change', () => {
        saveSetting('translationEnabled', inpTranslation.checked);
        if (inpTranslation.checked) {
          fetchTranslationForCurrentLyrics();
        }
        if (currentLyrics.isSynced && currentLyrics.lines.length > 0) {
          renderLyricsUI();
          updateActiveLine();
        } else if (currentLyrics.plainText) {
          renderStaticLyrics(currentLyrics.plainText);
        }
      });
    }

    const inpFont = overlay.querySelector('#am-inp-fontsize');
    const valFont = overlay.querySelector('#am-val-fontsize');
    inpFont.addEventListener('input', () => {
      valFont.textContent = `${inpFont.value}px`;
      saveSetting('fontSize', parseInt(inpFont.value, 10));
      applySettingsToDOM();
    });

    const inpOffset = overlay.querySelector('#am-inp-offset');
    const valOffset = overlay.querySelector('#am-val-offset');
    inpOffset.addEventListener('input', () => {
      const ms = parseInt(inpOffset.value, 10);
      valOffset.textContent = ms > 0 ? `+${(ms/1000).toFixed(1)}s` : `${(ms/1000).toFixed(1)}s`;
      saveSetting('syncOffset', ms);
      updateHeaderUI();
    });

    overlay.querySelector('#am-reset-lyrics-btn').addEventListener('click', () => {
      settings.fontSize = DEFAULT_SETTINGS.fontSize;
      settings.syncOffset = DEFAULT_SETTINGS.syncOffset;
      settings.lyricsEnabled = DEFAULT_SETTINGS.lyricsEnabled;
      settings.appleMode = DEFAULT_SETTINGS.appleMode;
      settings.lineHighlight = DEFAULT_SETTINGS.lineHighlight;
      settings.wordHighlight = DEFAULT_SETTINGS.wordHighlight;
      settings.highlightStyle = DEFAULT_SETTINGS.highlightStyle;
      settings.furiganaEnabled = DEFAULT_SETTINGS.furiganaEnabled;
      settings.translationEnabled = DEFAULT_SETTINGS.translationEnabled;
      saveSetting('fontSize', settings.fontSize);
      saveSetting('syncOffset', settings.syncOffset);
      saveSetting('lyricsEnabled', settings.lyricsEnabled);
      saveSetting('appleMode', settings.appleMode);
      saveSetting('lineHighlight', settings.lineHighlight);
      saveSetting('wordHighlight', settings.wordHighlight);
      saveSetting('highlightStyle', settings.highlightStyle);
      saveSetting('furiganaEnabled', settings.furiganaEnabled);
      saveSetting('translationEnabled', settings.translationEnabled);
      updateModalInputsFromSettings();
      applySettingsToDOM();
      updateHeaderUI();
      renderLyricsUI();
      updateActiveLine();
    });

    // Reset Provider Section
    overlay.querySelector('#am-reset-providers-btn').addEventListener('click', () => {
      settings.providerOrder = [...DEFAULT_SETTINGS.providerOrder];
      settings.enabledProviders = { ...DEFAULT_SETTINGS.enabledProviders };
      saveSetting('providerOrder', settings.providerOrder);
      saveSetting('enabledProviders', settings.enabledProviders);
      renderProviderListUI();
      lyricsCache.clear();
      safeSendMessage({ action: 'CLEAR_CACHE' });
      loadLyricsForCurrentTrack(true);
    });

    updateModalInputsFromSettings();
    renderProviderListUI();
  }

  function setupModalDragging(panel, header) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('#am-modal-close-btn') || e.target.closest('button')) return;
      isDragging = true;
      header.style.cursor = 'grabbing';

      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;

      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.left = `${startLeft}px`;
      panel.style.top = `${startTop}px`;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const newLeft = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, startLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, startTop + dy));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'grab';
      }
    });
  }

  function toggleIntegratedModal() {
    injectIntegratedModal();
    const overlay = document.getElementById('am-integrated-settings-overlay');
    if (!overlay) return;
    const isVisible = overlay.classList.contains('visible');
    const triggerBtn = document.getElementById('am-player-bar-trigger-btn');

    if (isVisible) {
      overlay.classList.remove('visible');
      if (triggerBtn) triggerBtn.classList.remove('active');
    } else {
      updateModalInputsFromSettings();
      renderProviderListUI();
      const panel = overlay.querySelector('#am-integrated-settings-panel');
      if (panel) {
        const tabBtns = panel.querySelectorAll('.am-tab-btn');
        const tabContents = panel.querySelectorAll('.am-tab-content');
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === activeSettingsTab));
        tabContents.forEach(c => c.classList.toggle('active', c.id === `am-tab-${activeSettingsTab}`));
      }
      overlay.classList.add('visible');
      if (triggerBtn) triggerBtn.classList.add('active');
    }
  }

  function updateModalInputsFromSettings() {
    const overlay = document.getElementById('am-integrated-settings-overlay');
    if (!overlay) return;

    overlay.querySelector('#am-inp-blur').value = settings.ambientBlur;
    overlay.querySelector('#am-val-blur').textContent = `${settings.ambientBlur}%`;

    overlay.querySelector('#am-inp-spread').value = settings.ambientSpread;
    overlay.querySelector('#am-val-spread').textContent = `${settings.ambientSpread}%`;

    overlay.querySelector('#am-inp-fade').value = settings.ambientFadeDuration;
    overlay.querySelector('#am-val-fade').textContent = settings.ambientFadeDuration > 0 ? `${settings.ambientFadeDuration.toFixed(1)}s` : 'Off';

    overlay.querySelector('#am-inp-brightness').value = settings.ambientBrightness;
    overlay.querySelector('#am-val-brightness').textContent = `${settings.ambientBrightness}%`;

    overlay.querySelector('#am-inp-saturation').value = settings.ambientSaturation;
    overlay.querySelector('#am-val-saturation').textContent = `${settings.ambientSaturation}%`;

    const inpLineHighlight = overlay.querySelector('#am-inp-line-highlight');
    if (inpLineHighlight) {
      inpLineHighlight.checked = settings.lineHighlight !== false;
    }

    const inpWordHighlight = overlay.querySelector('#am-inp-word-highlight');
    if (inpWordHighlight) {
      inpWordHighlight.checked = settings.wordHighlight !== false;
    }

    const inpHighlightStyle = overlay.querySelector('#am-inp-highlight-style');
    if (inpHighlightStyle) {
      inpHighlightStyle.value = settings.highlightStyle || 'apple-glow';
    }

    const inpFurigana = overlay.querySelector('#am-inp-furigana');
    if (inpFurigana) {
      inpFurigana.checked = settings.furiganaEnabled !== false;
    }

    const inpTranslation = overlay.querySelector('#am-inp-translation');
    if (inpTranslation) {
      inpTranslation.checked = Boolean(settings.translationEnabled);
    }

    overlay.querySelector('#am-inp-fontsize').value = settings.fontSize;
    overlay.querySelector('#am-val-fontsize').textContent = `${settings.fontSize}px`;

    overlay.querySelector('#am-inp-offset').value = settings.syncOffset;
    const ms = settings.syncOffset;
    overlay.querySelector('#am-val-offset').textContent = ms > 0 ? `+${(ms/1000).toFixed(1)}s` : `${(ms/1000).toFixed(1)}s`;
  }

  const PROVIDER_LABELS = {
    'lrclib': 'LRCLIB (Western & Global)',
    'netease': 'Netease (Japanese, Anime, Asian)',
    'kugou': 'Kugou (International & Asian)',
    'qq': 'QQ Music (International & Asian)',
    'youtube-cc': 'YouTube Captions (CC)',
    'native': 'YouTube Music Native Lyrics'
  };

  function renderProviderListUI() {
    const container = document.getElementById('am-provider-list-container');
    if (!container) return;

    container.innerHTML = '';
    const order = settings.providerOrder || DEFAULT_SETTINGS.providerOrder;

    order.forEach((providerKey, index) => {
      const item = document.createElement('div');
      item.className = 'am-provider-item';

      const isEnabled = settings.enabledProviders ? settings.enabledProviders[providerKey] !== false : true;
      const label = PROVIDER_LABELS[providerKey] || providerKey;

      item.innerHTML = `
        <div class="am-provider-left">
          <input type="checkbox" id="am-chk-${providerKey}" ${isEnabled ? 'checked' : ''}>
          <span>${index + 1}. ${label}</span>
        </div>
        <div class="am-provider-actions">
          <button class="am-reorder-btn" data-action="up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button class="am-reorder-btn" data-action="down" data-index="${index}" ${index === order.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
      `;

      item.querySelector(`input[type="checkbox"]`).addEventListener('change', (e) => {
        if (!settings.enabledProviders) settings.enabledProviders = {};
        settings.enabledProviders[providerKey] = e.target.checked;
        saveSetting('enabledProviders', settings.enabledProviders);
        lyricsCache.clear();
        safeSendMessage({ action: 'CLEAR_CACHE' });
        loadLyricsForCurrentTrack(true);
      });

      const upBtn = item.querySelector('[data-action="up"]');
      if (upBtn) {
        upBtn.addEventListener('click', () => {
          if (index > 0) {
            const temp = order[index];
            order[index] = order[index - 1];
            order[index - 1] = temp;
            settings.providerOrder = order;
            saveSetting('providerOrder', settings.providerOrder);
            renderProviderListUI();
            lyricsCache.clear();
            safeSendMessage({ action: 'CLEAR_CACHE' });
            loadLyricsForCurrentTrack(true);
          }
        });
      }

      const downBtn = item.querySelector('[data-action="down"]');
      if (downBtn) {
        downBtn.addEventListener('click', () => {
          if (index < order.length - 1) {
            const temp = order[index];
            order[index] = order[index + 1];
            order[index + 1] = temp;
            settings.providerOrder = order;
            saveSetting('providerOrder', settings.providerOrder);
            renderProviderListUI();
            lyricsCache.clear();
            safeSendMessage({ action: 'CLEAR_CACHE' });
            loadLyricsForCurrentTrack(true);
          }
        });
      }

      container.appendChild(item);
    });
  }

  // ==========================================================================
  // LRC PARSER & TIME SYNC ENGINE
  // ==========================================================================

  function parseLRC(lrcText) {
    if (!lrcText) return [];
    const lines = lrcText.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2,}):(\d{2}(?:\.\d{1,3})?)\]/g;
    let headerOffsetSec = 0;

    for (let rawLine of lines) {
      rawLine = rawLine.trim();
      if (!rawLine) continue;

      // Parse standard LRC header offset tag: [offset:+500] or [offset:-200]
      const offsetMatch = rawLine.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
      if (offsetMatch) {
        const ms = parseInt(offsetMatch[1], 10);
        if (!isNaN(ms)) {
          headerOffsetSec = ms / 1000;
        }
        continue;
      }

      let match;
      const timestamps = [];
      while ((match = timeRegex.exec(rawLine)) !== null) {
        const min = parseInt(match[1], 10);
        const sec = parseFloat(match[2]);
        timestamps.push(min * 60 + sec);
      }

      const text = rawLine.replace(/\[\d{2,}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();

      for (let time of timestamps) {
        const adjustedTime = Math.max(0, time + headerOffsetSec);
        result.push({ time: adjustedTime, text });
      }
    }

    result.sort((a, b) => a.time - b.time);
    return result;
  }

  // --- Word & Syllable Tokenizer & Timing Generator ---
  function tokenizeLineText(text) {
    if (!text) return [];
    const regexCmp = getCompoundRegex();
    let regex;
    if (regexCmp && containsJapanese(text)) {
      regex = new RegExp(`(${regexCmp.source}|[\\u4e00-\\u9fa5\\u3040-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7af]|[\\p{L}\\p{N}']+|\\s+|[^\\s\\p{L}\\p{N}]+)`, 'gu');
    } else {
      regex = /([\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]|[\p{L}\p{N}']+|\s+|[^\s\p{L}\p{N}]+)/gu;
    }
    const tokens = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[0]) tokens.push(match[0]);
    }
    return tokens.length > 0 ? tokens : [text];
  }

  function computeWordTimings(line, nextLine) {
    const textToSing = line.text || '♪';
    const tokens = tokenizeLineText(textToSing);
    const lineStart = line.time;
    const defaultDuration = 3.5;
    const lineDuration = nextLine && nextLine.time > lineStart
      ? Math.max(1.0, Math.min(8.0, nextLine.time - lineStart))
      : defaultDuration;

    // Filter to singing tokens (non-whitespace)
    const singingTokens = [];
    tokens.forEach((tok, idx) => {
      if (tok.trim().length > 0) {
        singingTokens.push({ token: tok, index: idx });
      }
    });

    const totalSinging = singingTokens.length;
    const activeSingDuration = lineDuration * 0.90; // 90% singing span, 10% breathing gap

    const tokenTimings = tokens.map((tok, idx) => {
      const isSinging = tok.trim().length > 0;
      if (!isSinging) {
        return { text: tok, isSpace: true, time: lineStart, duration: 0 };
      }
      const singOrder = singingTokens.findIndex(s => s.index === idx);
      const unitDuration = activeSingDuration / Math.max(1, totalSinging);
      const startTime = lineStart + (singOrder * unitDuration);
      return {
        text: tok,
        isSpace: false,
        time: startTime,
        duration: unitDuration
      };
    });

    return tokenTimings;
  }

  function renderLyricsUI() {
    const listContainer = document.getElementById('am-lyrics-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (currentLyrics.lines.length === 0) {
      if (currentLyrics.plainText) {
        renderStaticLyrics(currentLyrics.plainText);
      } else {
        listContainer.innerHTML = `
          <div class="am-empty-state">
            <div class="am-state-title">No Lyrics Found</div>
            <div class="am-state-desc">Lyrics are not available for this track yet.</div>
          </div>
        `;
      }
      return;
    }

    const fragment = document.createDocumentFragment();

    const topSpace = document.createElement('div');
    topSpace.className = 'am-lyric-line empty-space';
    fragment.appendChild(topSpace);

    currentLyrics.lines.forEach((line, index) => {
      const nextLine = currentLyrics.lines[index + 1];
      line.wordTimings = computeWordTimings(line, nextLine);

      const lineElem = document.createElement('div');
      lineElem.className = 'am-lyric-line';
      lineElem.dataset.index = index;
      lineElem.dataset.time = line.time;

      const primaryContainer = document.createElement('div');
      primaryContainer.className = 'am-line-primary';

      if (line.wordTimings && line.wordTimings.length > 0) {
        line.wordTimings.forEach((w, wIdx) => {
          if (w.isSpace) {
            primaryContainer.appendChild(document.createTextNode(w.text));
          } else {
            const span = document.createElement('span');
            span.className = 'am-word';
            span.dataset.wordIdx = wIdx;
            if (settings.furiganaEnabled !== false && containsKanji(w.text)) {
              span.innerHTML = addFurigana(w.text);
            } else {
              span.textContent = w.text;
            }
            primaryContainer.appendChild(span);
          }
        });
      } else {
        if (settings.furiganaEnabled !== false && containsKanji(line.text)) {
          primaryContainer.innerHTML = addFurigana(line.text || '♪');
        } else {
          primaryContainer.textContent = line.text || '♪';
        }
      }

      lineElem.appendChild(primaryContainer);

      if (settings.translationEnabled && line.translation) {
        const transElem = document.createElement('div');
        transElem.className = 'am-line-translation';
        transElem.textContent = line.translation;
        lineElem.appendChild(transElem);
      }

      if (settings.clickToSeek) {
        lineElem.title = 'Click to seek • Alt+Click to calibrate audio sync';
        lineElem.addEventListener('click', (e) => {
          const video = document.querySelector('video');
          if (!video) return;

          // Quick Calibration: Alt+Click or Shift+Click aligns lyric line to current playback
          if (e.altKey || e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            const newOffset = Math.round((line.time - video.currentTime) * 1000);
            setTrackOffset(newOffset);
            const sign = newOffset > 0 ? '+' : '';
            showToast(`🎯 Calibrated to audio playback: ${sign}${(newOffset / 1000).toFixed(1)}s`);
            return;
          }

          const eff = getEffectiveOffset();
          video.currentTime = Math.max(0, line.time - (eff / 1000));
          userScrolled = false;
          const resumeBtn = document.getElementById('am-resume-scroll-btn');
          if (resumeBtn) resumeBtn.classList.remove('visible');
          setActiveLine(index, true);
        });
      }

      fragment.appendChild(lineElem);
    });

    // Bottom Lyrics Footer: Source Attribution
    const hasJp = currentLyrics.lines.some(l => containsJapanese(l.text));
    updateQuickToolsWidget(hasJp);

    const footer = document.createElement('div');
    footer.className = 'am-lyrics-footer';

    let sourceDisplay = currentLyrics.source;
    if (sourceDisplay === 'native') sourceDisplay = 'YouTube Music';
    if (!sourceDisplay || sourceDisplay === 'none') sourceDisplay = 'Synced Engine';

    const eff = getEffectiveOffset();
    const sec = (eff / 1000).toFixed(1);
    const offsetLabel = (eff > 0 ? `+${sec}s` : `${sec}s`);

    footer.innerHTML = `
      <div class="am-sync-nudge-bar">
        <span class="am-sync-label">Sync:</span>
        <button class="am-sync-nudge-btn" data-delta="-500" title="Shift lyrics earlier by 0.5s">-0.5s</button>
        <button class="am-sync-nudge-btn" data-delta="-100" title="Shift lyrics earlier by 0.1s">-0.1s</button>
        <span class="am-sync-val ${eff !== 0 ? 'has-custom' : ''}" id="am-current-track-sync-val">${offsetLabel}</span>
        <button class="am-sync-nudge-btn" data-delta="100" title="Shift lyrics later by 0.1s">+0.1s</button>
        <button class="am-sync-nudge-btn" data-delta="500" title="Shift lyrics later by 0.5s">+0.5s</button>
        <button class="am-sync-reset-btn" id="am-sync-track-reset" title="Reset track audio sync" style="display: ${eff !== 0 ? 'inline-flex' : 'none'};">↺</button>
      </div>
      <div class="am-footer-credit-line">
        <span class="am-footer-dot"></span>
        <span>Lyrics provided by ${escapeHTML(sourceDisplay)}</span>
      </div>
      <div class="am-footer-actions">
        <button class="am-footer-pill-btn" id="am-footer-settings-btn" title="Ambient Light & Lyrics Settings">⚙ Settings</button>
      </div>
    `;

    footer.querySelectorAll('.am-sync-nudge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const delta = parseInt(btn.dataset.delta, 10);
        if (!isNaN(delta)) {
          adjustTrackOffset(delta);
          const current = getEffectiveOffset();
          const sign = current > 0 ? '+' : '';
          showToast(`Audio sync: ${sign}${(current / 1000).toFixed(1)}s`);
        }
      });
    });

    const resetTrackBtn = footer.querySelector('#am-sync-track-reset');
    if (resetTrackBtn) {
      resetTrackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetTrackOffset();
        showToast('Audio sync reset to 0.0s');
      });
    }

    const settingsBtn = footer.querySelector('#am-footer-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', toggleIntegratedModal);
    }

    fragment.appendChild(footer);

    const bottomSpace = document.createElement('div');
    bottomSpace.className = 'am-lyric-line empty-space';
    fragment.appendChild(bottomSpace);

    listContainer.appendChild(fragment);
    activeLineIndex = -1;
    updateActiveLine();
  }

  function renderStaticLyrics(plainText) {
    const listContainer = document.getElementById('am-lyrics-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const lines = plainText.split('\n');
    lines.forEach((rawText, idx) => {
      const trimmed = rawText.trim();
      const lineElem = document.createElement('div');
      lineElem.className = 'am-lyric-line static-line';
      lineElem.style.color = 'rgba(255, 255, 255, 0.85)';
      lineElem.style.filter = 'none';
      lineElem.style.cursor = 'default';

      const primary = document.createElement('div');
      primary.className = 'am-line-primary';
      if (settings.furiganaEnabled !== false && containsKanji(trimmed)) {
        primary.innerHTML = addFurigana(trimmed);
      } else {
        primary.textContent = trimmed || '';
      }
      lineElem.appendChild(primary);

      if (settings.translationEnabled && currentLyrics.translations && currentLyrics.translations[idx]) {
        const transElem = document.createElement('div');
        transElem.className = 'am-line-translation';
        transElem.textContent = currentLyrics.translations[idx];
        lineElem.appendChild(transElem);
      }

      listContainer.appendChild(lineElem);
    });

    // Footer Attribution for Static Lyrics
    const hasJp = containsJapanese(plainText);
    updateQuickToolsWidget(hasJp);

    const footer = document.createElement('div');
    footer.className = 'am-lyrics-footer';

    let sourceDisplay = currentLyrics.source;
    if (sourceDisplay === 'native') sourceDisplay = 'YouTube Music';
    if (!sourceDisplay || sourceDisplay === 'none') sourceDisplay = 'Standard Lyrics';

    footer.innerHTML = `
      <div class="am-footer-credit-line">
        <span class="am-footer-dot"></span>
        <span>Lyrics provided by ${escapeHTML(sourceDisplay)}</span>
      </div>
      <div class="am-footer-actions">
        <button class="am-footer-pill-btn" id="am-footer-settings-btn" title="Ambient Light & Lyrics Settings">⚙ Settings</button>
      </div>
    `;

    const settingsBtn = footer.querySelector('#am-footer-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', toggleIntegratedModal);

    listContainer.appendChild(footer);
  }

  function updateQuickToolsWidget(hasJp) {
    const widget = document.getElementById('am-quick-tools-widget');
    if (!widget) return;

    const hasLyrics = (currentLyrics.lines && currentLyrics.lines.length > 0) || Boolean(currentLyrics.plainText);
    if (!hasLyrics) {
      widget.classList.remove('visible', 'expanded');
      return;
    }

    widget.classList.add('visible');

    const jpSection = document.getElementById('am-quick-jp-section');
    const divider = document.getElementById('am-quick-divider');
    const circleIcon = document.getElementById('am-quick-circle-icon');

    if (hasJp) {
      if (jpSection) jpSection.style.display = 'inline-flex';
      if (divider) divider.style.display = 'block';
      if (circleIcon) circleIcon.textContent = '文A';

      const fBtn = document.getElementById('am-quick-furigana-btn');
      if (fBtn) fBtn.classList.toggle('active', settings.furiganaEnabled !== false);

      const tBtn = document.getElementById('am-quick-translate-btn');
      if (tBtn) tBtn.classList.toggle('active', Boolean(settings.translationEnabled));

      if (settings.translationEnabled && (!currentLyrics.translations || currentLyrics.translations.length === 0)) {
        fetchTranslationForCurrentLyrics();
      }
    } else {
      if (jpSection) jpSection.style.display = 'none';
      if (divider) divider.style.display = 'none';
      if (circleIcon) {
        circleIcon.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `;
      }
    }

    // Update sync offset value in quick bar
    const quickVal = document.getElementById('am-quick-sync-val');
    const quickReset = document.getElementById('am-quick-sync-reset');
    const eff = getEffectiveOffset();
    const sec = (eff / 1000).toFixed(1);
    const label = (eff > 0 ? `+${sec}s` : `${sec}s`);

    if (quickVal) {
      quickVal.textContent = label;
      if (eff !== 0) quickVal.classList.add('has-custom');
      else quickVal.classList.remove('has-custom');
    }

    if (quickReset) {
      quickReset.style.display = (eff !== 0 ? 'inline-flex' : 'none');
    }

    const styleBtn = document.getElementById('am-quick-style-btn');
    if (styleBtn) {
      const curStyle = HIGHLIGHT_STYLES.find(s => s.id === (settings.highlightStyle || 'apple-glow')) || HIGHLIGHT_STYLES[0];
      styleBtn.textContent = curStyle.label;
      styleBtn.title = `Style: ${curStyle.fullName} (Click to switch)`;
    }
  }

  function updateActiveLine() {
    if (!currentLyrics.isSynced || currentLyrics.lines.length === 0) return;

    const video = document.querySelector('video');
    if (!video) return;

    const currentTime = video.currentTime + (getEffectiveOffset() / 1000);

    let newIndex = -1;
    for (let i = 0; i < currentLyrics.lines.length; i++) {
      if (currentLyrics.lines[i].time <= currentTime) {
        newIndex = i;
      } else {
        break;
      }
    }

    if (newIndex !== activeLineIndex) {
      setActiveLine(newIndex, true);
    }

    // Update word-by-word / syllable karaoke highlight on active line
    if (activeLineIndex >= 0 && settings.lineHighlight !== false && settings.wordHighlight !== false) {
      updateActiveLineWordHighlight(currentTime);
    }
  }

  function updateActiveLineWordHighlight(currentTime) {
    const activeElem = document.querySelector(`.am-lyric-line[data-index="${activeLineIndex}"]`);
    if (!activeElem) return;

    const lineData = currentLyrics.lines[activeLineIndex];
    if (!lineData || !lineData.wordTimings) return;

    const wordSpans = activeElem.querySelectorAll('.am-word');
    wordSpans.forEach(span => {
      const wIdx = parseInt(span.dataset.wordIdx, 10);
      const w = lineData.wordTimings[wIdx];
      if (!w) return;

      const dur = Math.max(0.05, w.duration || 0.2);
      const percent = Math.max(0, Math.min(100, ((currentTime - w.time) / dur) * 100));
      span.style.setProperty('--am-word-fill', `${percent.toFixed(2)}%`);

      if (currentTime >= w.time + w.duration) {
        span.classList.add('sung');
        span.classList.remove('singing');
      } else if (currentTime >= w.time && currentTime < w.time + w.duration) {
        span.classList.add('singing');
        span.classList.remove('sung');
      } else {
        span.classList.remove('sung');
        span.classList.remove('singing');
      }
    });
  }

  function setActiveLine(newIndex, shouldScroll = true) {
    activeLineIndex = newIndex;
    const lines = document.querySelectorAll('.am-lyric-line[data-index]');

    lines.forEach((elem) => {
      const idx = parseInt(elem.dataset.index, 10);
      const wordSpans = elem.querySelectorAll('.am-word');

      if (idx === activeLineIndex) {
        if (settings.lineHighlight !== false) {
          elem.classList.add('active');
          elem.classList.remove('passed');
          if (settings.wordHighlight === false) {
            elem.classList.add('no-word-sync');
          } else {
            elem.classList.remove('no-word-sync');
          }
        } else {
          elem.classList.remove('active', 'passed', 'no-word-sync');
        }
      } else if (idx < activeLineIndex) {
        if (settings.lineHighlight !== false) {
          elem.classList.remove('active', 'no-word-sync');
          elem.classList.add('passed');
        } else {
          elem.classList.remove('active', 'passed', 'no-word-sync');
        }
        wordSpans.forEach(w => {
          w.classList.add('sung');
          w.classList.remove('singing');
          w.style.setProperty('--am-word-fill', '100%');
        });
      } else {
        elem.classList.remove('active', 'passed', 'no-word-sync');
        wordSpans.forEach(w => {
          w.classList.remove('sung', 'singing');
          w.style.setProperty('--am-word-fill', '0%');
        });
      }
    });

    if (shouldScroll && !userScrolled && activeLineIndex >= 0) {
      scrollToActiveLine(true);
    }
  }

  function scrollToActiveLine(smooth = true) {
    if (activeLineIndex < 0) return;
    const activeElem = document.querySelector(`.am-lyric-line[data-index="${activeLineIndex}"]`);
    if (!activeElem) return;

    const scrollContainer = document.getElementById('am-lyrics-scroll-container');
    let scrolled = false;

    // 1. Scroll internal lyrics container if it has overflow
    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + 10) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elemRect = activeElem.getBoundingClientRect();
      const relativeTop = elemRect.top - containerRect.top;
      const targetScroll = Math.round(scrollContainer.scrollTop + relativeTop - (scrollContainer.clientHeight / 2) + (elemRect.height / 2));

      scrollContainer.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: smooth ? 'smooth' : 'auto'
      });
      scrolled = true;
    }

    if (!scrolled) {
      // 2. Also check if an outer ancestor (ytmusic-tab-renderer, #side-panel, etc.) has overflow
      let parent = (scrollContainer || activeElem).parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (parent.scrollHeight > parent.clientHeight + 10) {
          const style = window.getComputedStyle(parent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            const parentRect = parent.getBoundingClientRect();
            const elemRect = activeElem.getBoundingClientRect();
            const relativeTop = elemRect.top - parentRect.top;
            const targetScroll = Math.round(parent.scrollTop + relativeTop - (parent.clientHeight / 2) + (elemRect.height / 2));
            parent.scrollTo({
              top: Math.max(0, targetScroll),
              behavior: smooth ? 'smooth' : 'auto'
            });
            scrolled = true;
            break;
          }
        }
        parent = parent.parentElement;
      }
    }

    // 3. Fallback only if no scroll container handled it
    if (!scrolled) {
      try {
        activeElem.scrollIntoView({
          behavior: smooth ? 'smooth' : 'auto',
          block: 'center',
          inline: 'nearest'
        });
      } catch (e) {}
    }
  }

  // ==========================================================================
  // MULTI-PROVIDER & FAST FALLBACK LOADER
  // ==========================================================================

  function tryGetNativeLyrics() {
    const shelf = getNativeLyricsShelf();
    if (shelf) {
      const desc = shelf.querySelector('#description') || shelf.querySelector('.description');
      if (desc && desc.textContent.trim()) {
        return { isSynced: false, lines: [], plainText: desc.textContent.trim(), source: 'YouTube Music' };
      }
    }
    return null;
  }

  function tryGetCaptionsLyrics() {
    const video = document.querySelector('video');
    if (video && video.textTracks && video.textTracks.length > 0) {
      const tracks = Array.from(video.textTracks);
      // Prioritize active or showing tracks
      tracks.sort((a, b) => (b.mode === 'showing' ? 1 : 0) - (a.mode === 'showing' ? 1 : 0));

      for (const track of tracks) {
        // If mode is 'disabled', track.cues remains null in browser. Set to 'hidden' to force load:
        if (track.mode === 'disabled') {
          track.mode = 'hidden';
        }
        if (track.cues && track.cues.length > 0) {
          const lines = [];
          for (let j = 0; j < track.cues.length; j++) {
            const cue = track.cues[j];
            const text = (cue.text || '').replace(/<[^>]+>/g, '').trim();
            if (text) {
              lines.push({
                time: cue.startTime,
                text: text
              });
            }
          }
          if (lines.length > 0) {
            lines.sort((a, b) => a.time - b.time);
            return { isSynced: true, lines, plainText: '', source: 'YouTube CC' };
          }
        }
      }
    }
    return null;
  }

  let durationRetryCount = 0;
  let lastDurationRetryKey = '';

  function loadLyricsForCurrentTrack(forceReload = false) {
    const trackInfo = getCurrentTrackInfo();
    const trackKey = `${trackInfo.cleanTitle}__${trackInfo.cleanArtist}`.toLowerCase();

    if (trackKey !== lastDurationRetryKey) {
      lastDurationRetryKey = trackKey;
      durationRetryCount = 0;
    }

    const video = document.querySelector('video');
    if (video && (isNaN(video.duration) || video.duration === 0)) {
      if (durationRetryCount < 6) {
        durationRetryCount++;
        setTimeout(() => loadLyricsForCurrentTrack(forceReload), 400);
        return;
      }
    }
    durationRetryCount = 0;

    if (!trackInfo.cleanTitle && !trackInfo.title) return;
    if (!forceReload && trackKey === currentTrackKey && currentLyrics.lines.length > 0) return;

    if (forceReload) {
      lyricsCache.delete(trackKey);
    }

    currentTrackKey = trackKey;
    activeLineIndex = -1;
    userScrolled = false;

    // Immediately hide the resume sync button on song transition
    const resumeBtn = document.getElementById('am-resume-scroll-btn');
    if (resumeBtn) resumeBtn.classList.remove('visible');

    // Preload artwork immediately to avoid ambient flicker
    if (trackInfo.artwork) {
      ambientEngine.preloadArtwork(trackInfo.artwork);
    }

    if (!forceReload && lyricsCache.has(trackKey)) {
      currentLyrics = lyricsCache.get(trackKey);
      isLoadingLyrics = false;
      renderCurrentLyricsState();
      return;
    }

    // Immediately reset currentLyrics so previous song lyrics NEVER stick around
    currentLyrics = {
      isSynced: false,
      lines: [],
      plainText: '',
      translations: [],
      source: 'none'
    };

    isLoadingLyrics = true;
    renderLoadingState(trackInfo.title);

    const requestId = ++currentFetchRequestId;

    // Determine effective provider execution order
    const order = settings.providerOrder || DEFAULT_SETTINGS.providerOrder;
    const enabledOrder = order.filter(p => !settings.enabledProviders || settings.enabledProviders[p] !== false);

    // Wake up text tracks early so browser fetches/parses captions cues while online fetch is running
    if (video && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        if (video.textTracks[i].mode === 'disabled') {
          video.textTracks[i].mode = 'hidden';
        }
      }
    }

    const firstOnlineIndex = enabledOrder.findIndex(p => ['lrclib', 'netease', 'kugou', 'qq'].includes(p));

    function tryGetLocalLyrics(provider) {
      if (provider === 'youtube-cc') {
        return tryGetCaptionsLyrics();
      }
      if (provider === 'native') {
        return tryGetNativeLyrics();
      }
      return null;
    }

    // Step 1: Check leading local providers ranked before online providers in exact user order
    const leadingLocalProviders = firstOnlineIndex === -1
      ? enabledOrder.filter(p => ['youtube-cc', 'native'].includes(p))
      : enabledOrder.slice(0, firstOnlineIndex).filter(p => ['youtube-cc', 'native'].includes(p));

    for (const p of leadingLocalProviders) {
      const localResult = tryGetLocalLyrics(p);
      if (localResult) {
        isLoadingLyrics = false;
        currentLyrics = localResult;
        lyricsCache.set(trackKey, currentLyrics);
        renderCurrentLyricsState();
        return;
      }
    }

    // Remaining local providers that follow online providers in user order
    const trailingLocalProviders = enabledOrder.filter(p =>
      ['youtube-cc', 'native'].includes(p) && !leadingLocalProviders.includes(p)
    );

    // Online providers to fetch via background
    const onlineProviders = enabledOrder.filter(p => ['lrclib', 'netease', 'kugou', 'qq'].includes(p));

    if (onlineProviders.length > 0) {
      safeSendMessage({
        action: 'FETCH_LYRICS',
        trackInfo,
        providerOrder: onlineProviders,
        enabledProviders: settings.enabledProviders
      }, (response) => {
        if (requestId !== currentFetchRequestId) return;

        // 1. Confident Synced Lyrics from Online Provider
        if (response && response.success && response.lyrics && response.synced) {
          isLoadingLyrics = false;
          currentLyrics = {
            isSynced: true,
            lines: parseLRC(response.lyrics),
            plainText: '',
            source: response.source || 'Synced'
          };
          lyricsCache.set(trackKey, currentLyrics);
          renderCurrentLyricsState();
          return;
        }

        // Online plain text candidate (if available)
        const onlinePlain = (response && response.success && response.lyrics) ? {
          isSynced: false,
          lines: [],
          plainText: response.lyrics,
          source: response.source || 'Standard'
        } : null;

        // 2. Waterfall to trailing local providers in exact configured order
        processTrailingLocal(trackInfo, trackKey, requestId, trailingLocalProviders, onlinePlain);
      });
    } else {
      processTrailingLocal(trackInfo, trackKey, requestId, trailingLocalProviders, null);
    }
  }

  function processTrailingLocal(trackInfo, trackKey, requestId, remainingProviders, onlinePlainFallback) {
    function step(idx) {
      if (requestId !== currentFetchRequestId) return;

      if (idx >= remainingProviders.length) {
        isLoadingLyrics = false;
        if (onlinePlainFallback) {
          currentLyrics = onlinePlainFallback;
        } else {
          currentLyrics = { isSynced: false, lines: [], plainText: '', source: 'none' };
        }
        lyricsCache.set(trackKey, currentLyrics);
        renderCurrentLyricsState();
        return;
      }

      const provider = remainingProviders[idx];
      if (provider === 'youtube-cc') {
        const cc = tryGetCaptionsLyrics();
        if (cc && cc.lines && cc.lines.length > 0) {
          isLoadingLyrics = false;
          currentLyrics = cc;
          lyricsCache.set(trackKey, currentLyrics);
          renderCurrentLyricsState();
          return;
        }

        // If cues are still being parsed by browser video element, retry once after short delay
        const video = document.querySelector('video');
        if (video && video.textTracks && video.textTracks.length > 0) {
          setTimeout(() => {
            if (requestId !== currentFetchRequestId) return;
            const retryCc = tryGetCaptionsLyrics();
            if (retryCc && retryCc.lines && retryCc.lines.length > 0) {
              isLoadingLyrics = false;
              currentLyrics = retryCc;
              lyricsCache.set(trackKey, currentLyrics);
              renderCurrentLyricsState();
            } else {
              step(idx + 1);
            }
          }, 350);
          return;
        }

        step(idx + 1);
      } else if (provider === 'native') {
        const nat = tryGetNativeLyrics();
        if (nat) {
          isLoadingLyrics = false;
          currentLyrics = nat;
          lyricsCache.set(trackKey, currentLyrics);
          renderCurrentLyricsState();
          return;
        }
        step(idx + 1);
      } else {
        step(idx + 1);
      }
    }

    step(0);
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // ==========================================================================
  // APP LIFECYCLE & WATCHERS
  // ==========================================================================

  function timeSyncLoop() {
    const video = document.querySelector('video');
    if (video && !video.paused) {
      if (Math.abs(video.currentTime - lastObservedTime) > 0.05) {
        lastObservedTime = video.currentTime;
        updateActiveLine();
      }
    }
    requestAnimationFrame(timeSyncLoop);
  }

  let lastBoundVideo = null;
  function bindVideoEvents() {
    const video = document.querySelector('video');
    if (video && video !== lastBoundVideo) {
      lastBoundVideo = video;
      video.addEventListener('seeking', () => updateActiveLine());
      video.addEventListener('seeked', () => {
        userScrolled = false;
        const resumeBtn = document.getElementById('am-resume-scroll-btn');
        if (resumeBtn) resumeBtn.classList.remove('visible');
        updateActiveLine();
        scrollToActiveLine(true);
      });
      video.addEventListener('play', () => {
        ambientEngine.injectContainers();
        updateActiveLine();
      });
    }
  }

  function isLyricsTabSelected() {
    const nativeLyricsTab = getNativeLyricsTab();
    if (!nativeLyricsTab) return false;
    return nativeLyricsTab.classList.contains('iron-selected') ||
           nativeLyricsTab.getAttribute('aria-selected') === 'true';
  }

  function setupWatchers() {
    // 1. Observe player state transitions (e.g. MINIPLAYER -> FULLSCREEN/DEFAULT or browsing albums)
    const playerPage = document.querySelector('ytmusic-player-page') || document.querySelector('ytmusic-app');
    if (playerPage && window.MutationObserver) {
      const pageObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'player-ui-state') {
            const state = playerPage.getAttribute('player-ui-state');
            if (state !== 'MINIPLAYER') {
              forceEnableNativeLyricsTab();
              ambientEngine.injectContainers();
              ambientEngine.drawFrame();
              if (isLyricsTabSelected() || isCustomLyricsTabActive) {
                activateLyricsTab();
                injectLyricsWrapper();
                renderCurrentLyricsState();
                scrollToActiveLine(true);
              }
            } else {
              // Hide ambient wrapper on minimize
              const ambientWrap = document.getElementById('am-player-ambient-wrapper');
              if (ambientWrap) ambientWrap.style.display = 'none';
            }
          }
        }
      });
      pageObserver.observe(playerPage, { attributes: true, attributeFilter: ['player-ui-state'] });
    }

    // 2. Main 500ms consistency watcher
    setInterval(() => {
      forceEnableNativeLyricsTab();
      hideNativeLyricsUnavailableMessage();
      bindVideoEvents();

      const playerPageElem = document.querySelector('ytmusic-player-page#player-page') || document.querySelector('ytmusic-player-page');
      const isPlayerOpen = playerPageElem ? playerPageElem.getAttribute('player-ui-state') !== 'MINIPLAYER' : true;

      // Check if user has the Lyrics tab active in the side panel
      const isSelected = isLyricsTabSelected();
      if (isSelected && !isCustomLyricsTabActive) {
        const shelf = getNativeLyricsShelf();
        const tabRenderer = getNativeLyricsTabRenderer();
        if (!shelf && (!tabRenderer || tabRenderer.hidden || tabRenderer.style.display === 'none')) {
          activateLyricsTab();
        }
      } else if (!isSelected && isCustomLyricsTabActive) {
        // User switched to UP NEXT, COMMENTS, or RELATED
        deactivateCustomLyricsTab();
      }

      // Self-heal: If player is open and lyrics tab is active, ensure DOM is connected and rendering
      if (isPlayerOpen && (isSelected || isCustomLyricsTabActive)) {
        const wrapper = document.getElementById('am-lyrics-wrapper');
        const customRenderer = document.getElementById('am-custom-lyrics-tab-renderer');
        if (!wrapper || !wrapper.isConnected || (isCustomLyricsTabActive && (!customRenderer || !customRenderer.isConnected))) {
          activateLyricsTab();
          injectLyricsWrapper();
          renderCurrentLyricsState();
        }
        if (isCustomLyricsTabActive) {
          const sidePanel = document.querySelector('ytmusic-player-page #side-panel') || document.querySelector('#side-panel');
          if (sidePanel) {
            Array.from(sidePanel.children).forEach(child => {
              if (child.id !== 'am-custom-lyrics-tab-renderer' &&
                  child.tagName.toLowerCase() !== 'tp-yt-paper-tabs' &&
                  !child.querySelector('tp-yt-paper-tabs') &&
                  !child.classList.contains('am-native-tab-hidden')) {
                child.classList.add('am-native-tab-hidden');
              }
            });
          }
        }
      }

      const track = getCurrentTrackInfo();
      const key = `${track.cleanTitle}__${track.cleanArtist}`.toLowerCase();
      if (key && key !== currentTrackKey) {
        loadLyricsForCurrentTrack();
        if (isCustomLyricsTabActive || isSelected) {
          setTimeout(() => {
            activateLyricsTab();
            injectLyricsWrapper();
            renderCurrentLyricsState();
          }, 100);
        }
      }
      ambientEngine.injectContainers();
      injectLyricsWrapper();
      injectIntegratedTriggers();
    }, 500);

    bindVideoEvents();
  }

  function init() {
    loadSettings();
    ambientEngine.init();
    forceEnableNativeLyricsTab();
    injectLyricsWrapper();
    injectIntegratedTriggers();
    setupWatchers();
    loadLyricsForCurrentTrack();
    requestAnimationFrame(timeSyncLoop);
    console.log('[AM-Lyrics] Ambient Light & Synced Lyrics initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
