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
    ambientBrightness: 95, // 95%
    ambientSpread: 42, // 42%
    ambientBlur: 70, // 70px
    ambientSaturation: 120, // 120%
    ambientFadeDuration: 0.15, // 0.15s (0 = Off)

    // Provider Priority
    providerOrder: ['lrclib', 'netease', 'kugou', 'qq', 'youtube-cc', 'native'],
    enabledProviders: {
      'lrclib': true,
      'netease': true,
      'kugou': true,
      'qq': false, // Disabled by default: QQ's public endpoint frequently returns HTTP 500; opt-in via Sources
      'youtube-cc': true,
      'native': true
    },

    // Lyrics
    lyricsEnabled: true,
    appleMode: true, // Alias for backward compatibility
    lineHighlight: true, // Highlight active lyric line
    wordHighlight: true, // Syllable/word synchronized karaoke highlight to specific words
    highlightStyle: 'apple-glow', // 'apple-glow' | 'karaoke-wave' | 'gradient-wipe' | 'clean-fade'
    japaneseMode: 'furigana', // 'original' | 'furigana' | 'romaji' | 'hiragana' | 'katakana'
    showOriginal: false, // Display original Japanese beneath readings
    furiganaEnabled: true, // Alias for backward compatibility
    translationEnabled: false, // Display English translation under Japanese lines
    backdropDimmer: true, // Dark backdrop for text readability over bright ambient light
    fontSize: 40, // 40px default (Apple Music typography contract)
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

  // Independent outer-edge spread multipliers for the ambient projector.
  // Horizontal (left/right) and vertical (top/bottom) bloom are scaled separately so the glow
  // stays balanced around YouTube Music's right-aligned player. Mirrored into CSS as
  // --am-spread-x / --am-spread-y by applySettingsToDOM().
  const AMBIENT_SPREAD_X = 1.0;
  const AMBIENT_SPREAD_Y = 1.0;

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
        // Fetch ALL stored keys (null), not just DEFAULT_SETTINGS keys, so legacy migration
        // can detect keys that are genuinely absent from storage (e.g. ambientBrightness).
        chrome.storage.sync.get(null, (storedAll) => {
          const stored = storedAll || {};
          // Start from defaults, overlay stored values.
          settings = { ...DEFAULT_SETTINGS, ...stored };
          // Legacy key migrations: only apply when the modern key was never stored.
          if (stored.ambientIntensity !== undefined && stored.ambientBrightness === undefined) {
            settings.ambientBrightness = stored.ambientIntensity;
          }
          if (stored.ambientLighting !== undefined && stored.ambientEnabled === undefined) {
            settings.ambientEnabled = stored.ambientLighting;
          }
          if (settings.highlightStyle === 'color-neon') {
            settings.highlightStyle = 'gradient-wipe';
          }
          if (stored.appleMode !== undefined && stored.lyricsEnabled === undefined) {
            settings.lyricsEnabled = stored.appleMode;
          }
          if (stored.japaneseMode !== undefined) {
            settings.japaneseMode = stored.japaneseMode;
          }
          applySettingsToDOM();
          updateLyrisSettingsUI();
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
          if (key === 'ambientIntensity' && changes.ambientBrightness === undefined) {
            settings.ambientBrightness = changes.ambientIntensity.newValue;
          }
          if (key === 'ambientBrightness') {
            settings.ambientIntensity = changes.ambientBrightness.newValue;
          }
          if (key === 'ambientLighting' && changes.ambientEnabled === undefined) {
            settings.ambientEnabled = changes.ambientLighting.newValue;
          }
          if (key === 'ambientEnabled') {
            settings.ambientLighting = changes.ambientEnabled.newValue;
          }
          if (key === 'providerOrder' || key === 'enabledProviders') {
            lyricsNeedReload = true;
          }
          if (key === 'japaneseMode' || key === 'showOriginal' || key === 'furiganaEnabled' ||
              key === 'translationEnabled' || key === 'fontSize' || key === 'wordHighlight' ||
              key === 'lineHighlight' || key === 'highlightStyle' || key === 'clickToSeek' ||
              key === 'lyricsEnabled' || key === 'appleMode') {
            lyricsNeedRerender = true;
            if (key === 'translationEnabled' && changes.translationEnabled.newValue) {
              fetchTranslationForCurrentLyrics();
            }
          }
        }

        applySettingsToDOM();
        updateLyrisSettingsUI();

        if (typeof ambientEngine !== 'undefined' && ambientEngine) {
          if (changes.ambientEnabled || changes.ambientLighting) {
            ambientEngine.toggle((settings.ambientEnabled ?? settings.ambientLighting) !== false);
          }
          if (changes.ambientBrightness || changes.ambientIntensity) {
            ambientEngine.updateBrightness(settings.ambientBrightness ?? settings.ambientIntensity ?? 95);
          }
          if (changes.ambientSpread) {
            ambientEngine.updateSpread(settings.ambientSpread ?? 42);
          }
          if (changes.ambientBlur) {
            ambientEngine.updateBlur(settings.ambientBlur ?? 70);
          }
          if (changes.ambientSaturation) {
            ambientEngine.updateSaturation(settings.ambientSaturation ?? 120);
          }
          if (changes.ambientFadeDuration) {
            ambientEngine.updateFadeDuration(settings.ambientFadeDuration ?? 0.15);
          }
        }

        if (lyricsNeedReload) {
          lyricsCache.clear();
          safeSendMessage({ action: 'CLEAR_CACHE' });
          loadLyricsForCurrentTrack(true);
        } else if (lyricsNeedRerender) {
          renderCurrentLyricsState();
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
        if (request.action === 'GET_STATUS' || request.action === 'GET_TRACK_INFO') {
          const metadata = getCurrentTrackInfo();
          sendResponse({
            track: metadata,
            trackInfo: metadata,
            currentLyrics: currentLyrics,
            lyricsSource: currentLyrics.source,
            isSynced: Boolean(currentLyrics.isSynced),
            lineCount: currentLyrics.lines ? currentLyrics.lines.length : 0,
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

  const _saveDebounceTimers = {};
  function saveSetting(key, val, debounceMs = 0) {
    settings[key] = val;
    applySettingsToDOM();
    if (key === 'japaneseMode' || key === 'showOriginal' || key === 'furiganaEnabled' ||
        key === 'translationEnabled' || key === 'fontSize' || key === 'wordHighlight' ||
        key === 'lineHighlight' || key === 'highlightStyle' || key === 'clickToSeek' ||
        key === 'lyricsEnabled' || key === 'appleMode') {
      renderCurrentLyricsState();
      updateActiveLine();
    }

    const persist = () => {
      if (isExtensionValid() && chrome.storage && chrome.storage.sync) {
        try {
          chrome.storage.sync.set({ [key]: val });
        } catch (e) {}
      }
    };

    if (debounceMs > 0) {
      clearTimeout(_saveDebounceTimers[key]);
      _saveDebounceTimers[key] = setTimeout(persist, debounceMs);
    } else {
      persist();
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
    const eff = getEffectiveOffset();
    const sec = (eff / 1000).toFixed(1);
    const label = (eff > 0 ? `+${sec}s` : `${sec}s`);

    const lyrisVal = document.getElementById('lyris-foot-sync-val') || document.getElementById('am-current-track-sync-val');
    if (lyrisVal) {
      lyrisVal.textContent = label;
      if (eff !== 0) lyrisVal.classList.add('has-custom');
      else lyrisVal.classList.remove('has-custom');
    }

    const lyrisReset = document.getElementById('lyris-foot-sync-reset') || document.getElementById('am-sync-track-reset');
    if (lyrisReset) {
      lyrisReset.style.display = (eff !== 0 ? 'inline-block' : 'none');
    }

    updateHeaderUI();
  }

  function showToast(message) {
    let toast = document.getElementById('lyris-toast') || document.getElementById('am-sync-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'lyris-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2200);
  }

  function applySettingsToDOM() {
    const root = document.documentElement;

    const blurPx = (typeof settings.ambientBlur === 'number') ? settings.ambientBlur : 70;
    const spreadVal = (typeof settings.ambientSpread === 'number') ? settings.ambientSpread : 42;
    const spreadRatio = (spreadVal / 100).toFixed(2);
    const spreadScale = (1.0 + (spreadVal / 100) * 0.5).toFixed(3);
    const brightnessVal = (typeof settings.ambientBrightness === 'number') ? settings.ambientBrightness : (settings.ambientIntensity ?? 95);
    const satVal = (typeof settings.ambientSaturation === 'number') ? settings.ambientSaturation : 120;
    const fadeVal = (typeof settings.ambientFadeDuration === 'number') ? settings.ambientFadeDuration : 0.15;
    const fontVal = (typeof settings.fontSize === 'number') ? settings.fontSize : 40;

    root.style.setProperty('--ly-font-size', `${fontVal}px`);
    root.style.setProperty('--am-font-size', `${fontVal}px`);
    root.style.setProperty('--am-blur', `${blurPx}px`);
    root.style.setProperty('--am-spread', spreadRatio);
    root.style.setProperty('--am-spread-x', (spreadVal / 100 * AMBIENT_SPREAD_X).toFixed(3));
    root.style.setProperty('--am-spread-y', (spreadVal / 100 * AMBIENT_SPREAD_Y).toFixed(3));
    root.style.setProperty('--am-spread-scale', spreadScale);
    root.style.setProperty('--am-brightness', `${brightnessVal}%`);
    root.style.setProperty('--am-saturation', `${satVal}%`);
    root.style.setProperty('--am-fade-duration', fadeVal > 0 ? `${fadeVal}s` : '0s');

    const playerAmbient = document.getElementById('am-player-ambient-wrapper');
    if (playerAmbient) {
      playerAmbient.style.display = (settings.ambientEnabled !== false) ? 'block' : 'none';
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

    const isTabSelected = isLyricsTabSelected();
    const shouldShowLyrics = isCustomActive && isTabSelected;

    const wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');
    if (wrapper) {
      wrapper.dataset.highlightStyle = settings.highlightStyle || 'apple-glow';
      wrapper.hidden = !shouldShowLyrics;
      if (!shouldShowLyrics) {
        wrapper.style.display = 'none';
      } else {
        wrapper.style.removeProperty('display');
      }
      wrapper.classList.toggle('has-backdrop-dimmer', settings.backdropDimmer !== false);
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

  const ROMAJI_MAP = {
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
    'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
    'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
    'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
    'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
    'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
    'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
    'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
    'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
    'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'wo', 'ん': 'n',
    'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
    'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
    'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
    'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
    'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
    'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
    'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
    'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
    'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
    'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
    'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
    'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
    'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
    'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
    'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
    'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
    'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo',
    'ゔ': 'vu'
  };

  function katakanaToHiragana(str) {
    if (!str) return '';
    return str.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  function hiraganaToKatakana(str) {
    if (!str) return '';
    return str.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  }

  function textToHiragana(text) {
    if (!text) return '';
    const compounds = (typeof window !== 'undefined' && window.AM_KANJI_COMPOUNDS) || {};
    const singles = (typeof window !== 'undefined' && window.AM_KANJI_SINGLE) || {};
    let res = text;
    const regex = getCompoundRegex();
    if (regex) {
      res = res.replace(regex, m => compounds[m] || m);
    }
    res = res.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ch => singles[ch] || ch);
    return katakanaToHiragana(res);
  }

  function kanaToRomaji(kana) {
    if (!kana) return '';
    const hira = katakanaToHiragana(kana);
    let out = '';
    let i = 0;
    while (i < hira.length) {
      if (hira[i] === 'っ' || hira[i] === 'ッ') {
        const next2 = hira.slice(i + 1, i + 3);
        const next1 = hira.slice(i + 1, i + 2);
        const r = ROMAJI_MAP[next2] || ROMAJI_MAP[next1];
        if (r) {
          out += r[0];
        }
        i++;
        continue;
      }
      if (hira[i] === 'ー') {
        const lastChar = out.slice(-1);
        if (/[aeiou]/i.test(lastChar)) {
          out += lastChar;
        } else {
          out += '-';
        }
        i++;
        continue;
      }
      const pair = hira.slice(i, i + 2);
      if (ROMAJI_MAP[pair]) {
        out += ROMAJI_MAP[pair];
        i += 2;
        continue;
      }
      const single = hira[i];
      if (ROMAJI_MAP[single]) {
        out += ROMAJI_MAP[single];
        i++;
        continue;
      }
      out += single;
      i++;
    }
    return out.trim();
  }

  function convertJapaneseLine(text, mode) {
    if (typeof text === 'object' && text !== null) {
      text = text.text || '';
    }
    if (!text || mode === 'original' || !containsJapanese(text)) {
      return escapeHTML(text || '');
    }
    if (mode === 'furigana') {
      return addFurigana(text);
    }
    const hira = textToHiragana(text);
    if (mode === 'hiragana') {
      return escapeHTML(hira);
    }
    if (mode === 'katakana') {
      return escapeHTML(hiraganaToKatakana(hira));
    }
    if (mode === 'romaji') {
      return escapeHTML(kanaToRomaji(hira));
    }
    return escapeHTML(text);
  }

  let isTranslatingKey = null;

  function fetchTranslationForCurrentLyrics() {
    if (!settings.translationEnabled) return;
    // Guard against a duplicate request for the SAME track only; a different track may proceed
    if (isTranslatingKey !== null && isTranslatingKey === currentTrackKey) return;

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

    const key = currentTrackKey;
    isTranslatingKey = key;

    safeSendMessage({
      action: 'TRANSLATE_LYRICS',
      lines: rawLines,
      cacheKey: key
    }, (response) => {
      // Only release the in-flight marker if it still belongs to THIS request, so a late
      // callback for an old track can't clear a newer track's in-progress translation.
      if (isTranslatingKey === key) isTranslatingKey = null;
      if (key !== currentTrackKey) {
        // Song changed while fetching — discard and attempt translation for the new track
        if (settings.translationEnabled) fetchTranslationForCurrentLyrics();
        return;
      }
      if (response && response.success && Array.isArray(response.translations)) {
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

      const spreadNum = (typeof spreadVal === 'number' && isFinite(spreadVal)) ? spreadVal : 42;
      const spreadRatio = spreadNum / 100.0;

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

      // 4. Independent horizontal / vertical margin expansion (must match content.css wrapper,
      //    which uses --am-spread-x / --am-spread-y). Left/right use the X factor, top/bottom the Y factor.
      const marginX = 0.15 + spreadRatio * 0.45 * AMBIENT_SPREAD_X;
      const marginY = 0.15 + spreadRatio * 0.45 * AMBIENT_SPREAD_Y;
      const totalScaleX = 1.0 + 2.0 * marginX;
      const totalScaleY = 1.0 + 2.0 * marginY;

      // 5. Video coordinates inside the ambient canvas
      const vx = Math.round(targetW * ((marginX + fracX) / totalScaleX));
      const vy = Math.round(targetH * ((marginY + fracY) / totalScaleY));
      const vw = Math.round(targetW * (fracW / totalScaleX));
      const vh = Math.round(targetH * (fracH / totalScaleY));

      // 6. Sample perimeter edge strips (4% depth)
      const dx = Math.max(2, Math.round(sw * 0.04));
      const dy = Math.max(2, Math.round(sh * 0.04));

      // 7. High-density edge count: fine, dense bands (30 to 80 bands)
      const numBands = Math.max(30, Math.min(80, Math.round(spreadNum * 0.45) + 16));

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

    toggle(enabled) {
      settings.ambientEnabled = Boolean(enabled);
      applySettingsToDOM();
      if (settings.ambientEnabled) {
        this.drawFrame(true);
      }
    }

    updateBrightness(val) {
      settings.ambientBrightness = parseInt(val, 10);
      applySettingsToDOM();
      this.drawFrame(true);
    }

    updateSpread(val) {
      settings.ambientSpread = parseFloat(val);
      applySettingsToDOM();
      this.drawFrame(true);
    }

    updateBlur(val) {
      settings.ambientBlur = parseInt(val, 10);
      applySettingsToDOM();
      this.drawFrame(true);
    }

    updateSaturation(val) {
      settings.ambientSaturation = parseInt(val, 10);
      applySettingsToDOM();
    }

    updateFadeDuration(val) {
      settings.ambientFadeDuration = parseFloat(val);
      applySettingsToDOM();
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
    } else {
      // MediaSession can carry a localized/shortened title (seen live: "Idol" while the player bar
      // shows "アイドル - Idol"). Prefer the player-bar title when it contains the MediaSession title
      // (a stale bar title from the previous track won't, so track changes stay safe).
      const barElem = document.querySelector('ytmusic-player-bar .title');
      const barTitle = barElem ? (barElem.getAttribute('title') || barElem.textContent || '').trim() : '';
      if (barTitle && barTitle !== title && barTitle.toLowerCase().includes(title.toLowerCase())) {
        title = barTitle;
      }
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
      '#side-panel ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"] ytmusic-message-renderer, ' +
      '#side-panel ytmusic-tab-renderer[tab-id="FEmusic_lyrics"] ytmusic-message-renderer'
    );
    messages.forEach(m => {
      m.style.setProperty('display', 'none', 'important');
      m.style.setProperty('visibility', 'hidden', 'important');
      m.style.setProperty('height', '0px', 'important');
    });
  }

  function renderLoadingState(title) {
    const listContainer = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
    if (!listContainer) return;
    listContainer.innerHTML = `
      <div class="lyris-state am-loading-state">
        <div class="lyris-spinner am-spinner"></div>
        <div>
          <h3 class="am-state-title">Finding lyrics…</h3>
          <p class="am-state-desc">${escapeHTML(title || 'Current track')}</p>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    const listContainer = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
    if (!listContainer) return;
    listContainer.innerHTML = `
      <div class="lyris-state am-empty-state">
        <h3 class="am-state-title">No matching lyrics</h3>
        <p class="am-state-desc">Lyrics are not available for this track yet.</p>
        <button class="am-state-btn" id="lyris-empty-search-btn">Search lyrics</button>
      </div>
    `;
    const btn = listContainer.querySelector('#lyris-empty-search-btn');
    if (btn) btn.addEventListener('click', () => openSearchModal());
  }

  function renderCurrentLyricsState() {
    hideNativeLyricsUnavailableMessage();
    if (currentTrackKey === '__ad__') {
      renderAdState();
    } else if (isLoadingLyrics) {
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
             const tabId = (t.getAttribute('tab-id') || '').toLowerCase();
             if (tabId.includes('lyrics')) return true;
             const aria = (t.getAttribute('aria-label') || '').toLowerCase();
             if (aria.includes('lyrics') || aria.includes('歌詞')) return true;
             const txt = (t.textContent || '').trim().toLowerCase();
             return txt === 'lyrics' || txt === '歌詞' || txt === 'letra' || txt === 'paroles' || txt === 'songtext';
           });
  }

  function getAllSidePanelTabs() {
    const parentTabs = document.querySelector('ytmusic-player-page #side-panel tp-yt-paper-tabs') ||
                       document.querySelector('ytmusic-player-page tp-yt-paper-tabs') ||
                       document.querySelector('#side-panel tp-yt-paper-tabs') ||
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

    // Attach listener to parent tp-yt-paper-tabs container for global tab-switching handling
    const parentTabs = lyricsTab.closest('tp-yt-paper-tabs') ||
                       document.querySelector('ytmusic-player-page #side-panel tp-yt-paper-tabs') ||
                       document.querySelector('#side-panel tp-yt-paper-tabs') ||
                       document.querySelector('tp-yt-paper-tabs');
    if (parentTabs && !parentTabs._amTabsBound) {
      parentTabs._amTabsBound = true;
      const onTabClick = (e) => {
        const clickedTab = e.target.closest('tp-yt-paper-tab');
        if (clickedTab) {
          if (clickedTab === lyricsTab) {
            setTimeout(activateLyricsTab, 10);
          } else {
            deactivateCustomLyricsTab();
          }
        }
      };
      parentTabs.addEventListener('click', onTabClick, true);
      parentTabs.addEventListener('iron-select', () => setTimeout(handleTabSwitch, 20));
      parentTabs.addEventListener('selected-changed', () => setTimeout(handleTabSwitch, 20));
    }

    // Intercept click on the native lyrics tab
    if (!lyricsTab._amLyricsClickBound) {
      lyricsTab._amLyricsClickBound = true;
      lyricsTab.addEventListener('click', () => {
        setTimeout(activateLyricsTab, 10);
      }, true);
    }

    // Attach click listeners to sibling tabs (UP NEXT, RELATED, COMMENTS) to hide custom lyrics immediately
    const allTabs = getAllSidePanelTabs();
    allTabs.forEach(tab => {
      if (tab !== lyricsTab && !tab._amOtherTabClickBound) {
        tab._amOtherTabClickBound = true;
        tab.addEventListener('click', () => {
          deactivateCustomLyricsTab();
        }, true);
      }
    });
  }

  function updateLyricsPaneGeometry() {
    const side = document.querySelector('ytmusic-player-page #side-panel') || document.querySelector('#side-panel');
    const wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');
    if (!side || !wrapper) return;

    // Reset side panel scroll so it never creates phantom offsets
    side.scrollTop = 0;

    const header = side.querySelector('ytmusic-tab-header-shelf-renderer') ||
                   side.querySelector('tp-yt-paper-tabs') ||
                   document.querySelector('tp-yt-paper-tabs');
    let top = 48;
    if (header) {
      const headerRect = header.getBoundingClientRect();
      const sideRect = side.getBoundingClientRect();
      if (headerRect.height > 0) {
        const diff = headerRect.bottom - sideRect.top;
        if (diff >= 36 && diff <= 68) {
          top = diff;
        } else if (headerRect.height >= 36 && headerRect.height <= 68) {
          top = headerRect.height;
        }
      }
    }
    const safeTop = Math.min(64, Math.max(40, Math.round(top)));
    wrapper.style.top = `${safeTop}px`;
    wrapper.style.height = `calc(100% - ${safeTop}px)`;
  }

  function concealNativeLyrics(conceal) {
    const shelf = getNativeLyricsShelf();
    if (shelf) {
      if (conceal) shelf.classList.add('lyris-native-hidden');
      else shelf.classList.remove('lyris-native-hidden');
    }
  }

  function injectLyricsWrapper() {
    const side = document.querySelector('ytmusic-player-page #side-panel') || document.querySelector('#side-panel');
    if (!side) return false;

    let wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');
    if (!wrapper || !wrapper.isConnected || wrapper.parentElement !== side) {
      if (wrapper) wrapper.remove();
      wrapper = createLyricsDOM();
      side.appendChild(wrapper);
    }

    if (!isLyricsTabSelected()) {
      wrapper.hidden = true;
      wrapper.style.display = 'none';
    }

    updateLyricsPaneGeometry();
    return true;
  }

  function activateLyricsTab() {
    if (settings.lyricsEnabled === false || settings.appleMode === false) {
      deactivateCustomLyricsTab();
      return;
    }

    isCustomLyricsTabActive = true;
    hideNativeLyricsUnavailableMessage();
    injectLyricsWrapper();

    const wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');
    if (wrapper) {
      wrapper.hidden = false;
      wrapper.style.removeProperty('display');
    }

    const side = document.querySelector('ytmusic-player-page #side-panel') || document.querySelector('#side-panel');
    if (side) {
      side.scrollTop = 0;
    }

    concealNativeLyrics(true);
    updateLyricsPaneGeometry();

    const lyricsTab = getNativeLyricsTab();
    if (lyricsTab) {
      const parentTabs = lyricsTab.closest('tp-yt-paper-tabs');
      if (parentTabs) {
        const tabs = Array.from(parentTabs.querySelectorAll('tp-yt-paper-tab'));
        const idx = tabs.indexOf(lyricsTab);
        tabs.forEach(t => {
          if (t !== lyricsTab) {
            t.classList.remove('iron-selected');
            t.setAttribute('aria-selected', 'false');
          }
        });
        if (idx !== -1 && parentTabs.selected !== idx && parentTabs.selected !== String(idx)) {
          try {
            parentTabs.selected = idx;
          } catch (e) {}
        }
      }
      lyricsTab.classList.add('iron-selected');
      lyricsTab.setAttribute('aria-selected', 'true');
    }

    const lyricsBtn = document.getElementById('lyris-lyrics-btn');
    if (lyricsBtn) {
      lyricsBtn.classList.add('active');
      lyricsBtn.setAttribute('aria-expanded', 'true');
    }

    const list = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
    if (!list || !list.children.length) {
      renderCurrentLyricsState();
    }
    scrollToActiveLine(true);
  }

  function deactivateCustomLyricsTab() {
    isCustomLyricsTabActive = false;
    const wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');
    if (wrapper) {
      wrapper.hidden = true;
      wrapper.style.display = 'none';
    }

    concealNativeLyrics(false);

    // Clean up any stray concealment classes on native side panel
    const side = document.querySelector('ytmusic-player-page #side-panel') || document.querySelector('#side-panel');
    if (side) {
      side.querySelectorAll('.lyris-native-hidden, .am-native-tab-hidden').forEach(el => {
        el.classList.remove('lyris-native-hidden', 'am-native-tab-hidden');
      });
    }

    // Clean up selection state on lyrics tab if another tab is clicked
    const lyricsTab = getNativeLyricsTab();
    if (lyricsTab) {
      lyricsTab.classList.remove('iron-selected');
      lyricsTab.setAttribute('aria-selected', 'false');
    }

    const lyricsBtn = document.getElementById('lyris-lyrics-btn');
    if (lyricsBtn) {
      lyricsBtn.classList.remove('active');
      lyricsBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function handleTabSwitch() {
    if (isLyricsTabSelected()) {
      activateLyricsTab();
    } else {
      deactivateCustomLyricsTab();
    }
  }

  function handleLyricsBtnClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Ensure full player page is open (if currently miniplayer or collapsed)
    const playerPage = document.querySelector('ytmusic-player-page');
    if (playerPage && (playerPage.hidden || window.getComputedStyle(playerPage).display === 'none' || playerPage.getAttribute('player-ui-state') === 'MINIPLAYER')) {
      const expandBtn = document.querySelector('ytmusic-player-bar #player-page-button, ytmusic-player-bar .toggle-player-page-button, ytmusic-player-bar #thumbnail, ytmusic-player-bar .thumbnail-image-wrapper');
      if (expandBtn) expandBtn.click();
    }

    const lyricsTab = getNativeLyricsTab();
    const allTabs = getAllSidePanelTabs();
    const wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');
    const isShowing = wrapper && !wrapper.hidden && wrapper.style.display !== 'none';

    if (isShowing) {
      // Toggle OFF: switch to UP NEXT (queue) tab
      const upNextTab = allTabs.find(t => {
        const id = (t.getAttribute('tab-id') || '').toLowerCase();
        if (id.includes('up_next') || id.includes('queue')) return true;
        const txt = (t.textContent || '').trim().toLowerCase();
        return txt.includes('next') || txt.includes('queue') || txt.includes('次') || txt.includes('cola') || txt.includes('file');
      }) || allTabs[0];

      if (upNextTab) {
        upNextTab.click();
      }
      deactivateCustomLyricsTab();
    } else {
      // Toggle ON: switch to LYRICS tab
      if (lyricsTab) {
        lyricsTab.click();
      }
      activateLyricsTab();
    }
  }

  function injectIntegratedTriggers() {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return;

    const rightControls = playerBar.querySelector('.right-controls-buttons') ||
                          document.querySelector('#right-controls-buttons') ||
                          playerBar;

    // 1. Show/Toggle Lyrics Trigger Button (#lyris-lyrics-btn)
    let lyricsBtn = document.getElementById('lyris-lyrics-btn');
    if (!lyricsBtn) {
      lyricsBtn = document.createElement('button');
      lyricsBtn.id = 'lyris-lyrics-btn';
      lyricsBtn.className = 'lyris-player-btn am-player-bar-trigger';
      lyricsBtn.title = 'Show / Hide lyrics';
      lyricsBtn.setAttribute('aria-label', 'Show lyrics');
      lyricsBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          <path d="M8 9h8M8 13h5"></path>
        </svg>
      `;
      lyricsBtn.addEventListener('click', handleLyricsBtnClick);
      rightControls.appendChild(lyricsBtn);
    } else if (lyricsBtn.parentElement !== rightControls) {
      rightControls.appendChild(lyricsBtn);
    }

    // 2. Settings Trigger Button (#lyris-settings-btn)
    let settingsBtn = document.getElementById('lyris-settings-btn') || document.getElementById('am-player-bar-trigger-btn');
    if (!settingsBtn) {
      settingsBtn = document.createElement('button');
      settingsBtn.id = 'lyris-settings-btn';
      settingsBtn.className = 'lyris-player-btn am-player-bar-trigger';
      settingsBtn.title = 'Lyris settings (Lyrics, Ambient Light & Sources)';
      settingsBtn.setAttribute('aria-label', 'Lyris settings');
      settingsBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="7" x2="20" y2="7"></line>
          <line x1="4" y1="17" x2="20" y2="17"></line>
          <circle cx="9" cy="7" r="3" fill="currentColor"></circle>
          <circle cx="15" cy="17" r="3" fill="currentColor"></circle>
        </svg>
      `;
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLyrisSettings();
      });
      rightControls.appendChild(settingsBtn);
    } else {
      settingsBtn.id = 'lyris-settings-btn';
      if (settingsBtn.parentElement !== rightControls || rightControls.lastElementChild !== settingsBtn) {
        rightControls.appendChild(settingsBtn);
      }
    }

    const wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');
    const isShowing = wrapper && !wrapper.hidden && wrapper.style.display !== 'none';
    const isLyricsActive = isShowing || isLyricsTabSelected() || isCustomLyricsTabActive;
    lyricsBtn.classList.toggle('active', Boolean(isLyricsActive));
    lyricsBtn.setAttribute('aria-expanded', isLyricsActive ? 'true' : 'false');

    const settingsPanel = document.getElementById('lyris-settings');
    const isSettingsOpen = settingsPanel && !settingsPanel.hidden;
    settingsBtn.classList.toggle('active', Boolean(isSettingsOpen));
    settingsBtn.setAttribute('aria-expanded', isSettingsOpen ? 'true' : 'false');

    injectLyrisSettings();
    injectSearchModal();
  }

  function createLyricsDOM() {
    const wrapper = document.createElement('div');
    wrapper.id = 'lyris-lyrics-wrapper';
    wrapper.className = 'lyris-lyrics-wrapper';

    wrapper.innerHTML = `
      <div id="lyris-quick-controls" role="toolbar" aria-label="Quick controls">
        <button id="lyris-quick-toggle-btn" type="button" aria-expanded="false" title="Quick controls">
          <span class="lyris-quick-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
          <span id="lyris-quick-badge">振</span>
        </button>
        <div id="lyris-quick-drawer">
          <button id="lyris-quick-translate" type="button" aria-pressed="false">Translate</button>
          <button id="lyris-quick-dimmer" type="button" class="lyris-quick-pill-btn" aria-pressed="true" title="Toggle dark background for readability">Dim</button>
          <div class="lyris-quick-separator" aria-hidden="true"></div>
          <div class="lyris-quick-script-group" role="radiogroup" aria-label="Japanese script mode">
            <button class="lyris-quick-script-btn" data-mode="furigana" type="button" role="radio" aria-checked="false">振</button>
            <button class="lyris-quick-script-btn" data-mode="romaji" type="button" role="radio" aria-checked="false">Aa</button>
            <button class="lyris-quick-script-btn" data-mode="hiragana" type="button" role="radio" aria-checked="false">あ</button>
            <button class="lyris-quick-script-btn" data-mode="katakana" type="button" role="radio" aria-checked="false">ア</button>
            <button class="lyris-quick-script-btn" data-mode="original" type="button" role="radio" aria-checked="false">原</button>
          </div>
        </div>
      </div>

      <div class="lyris-scroll" id="lyris-scroll" tabindex="0" aria-label="Lyrics, scroll to browse">
        <div class="lyris-list" id="lyris-list"></div>
      </div>

      <button class="lyris-resume" id="lyris-resume-btn" title="Jump back to current lyric line" hidden>
        <span class="am-resume-pulse-dot"></span>
        <span>Resume sync</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="7" y1="17" x2="17" y2="7"></line>
          <polyline points="7 7 17 7 17 17"></polyline>
        </svg>
      </button>
    `;

    const scrollContainer = wrapper.querySelector('#lyris-scroll');
    const resumeBtn = wrapper.querySelector('#lyris-resume-btn');

    if (scrollContainer && resumeBtn) {
      const onUserBrowse = () => {
        if (!currentLyrics.isSynced) return;
        userScrolled = true;
        updateResumeSyncButton();
      };

      scrollContainer.addEventListener('wheel', onUserBrowse, { passive: true });
      scrollContainer.addEventListener('touchmove', onUserBrowse, { passive: true });
      scrollContainer.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
          onUserBrowse();
        }
      });
      scrollContainer.addEventListener('scroll', () => {
        updateResumeSyncButton();
      }, { passive: true });

      resumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userScrolled = false;
        resumeBtn.hidden = true;
        resumeBtn.classList.remove('visible');
        scrollToActiveLine(true);
      });
    }

    // Quick Controls: collapsed trigger + expandable drawer
    const quickControls = wrapper.querySelector('#lyris-quick-controls');
    const quickToggle = wrapper.querySelector('#lyris-quick-toggle-btn');
    const quickDrawer = wrapper.querySelector('#lyris-quick-drawer');
    const quickTranslate = wrapper.querySelector('#lyris-quick-translate');

    if (quickToggle && quickControls) {
      quickToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = quickControls.classList.toggle('is-expanded');
        quickToggle.setAttribute('aria-expanded', String(expanded));
      });

      // Close drawer on click outside
      document.addEventListener('click', (e) => {
        if (quickControls.classList.contains('is-expanded') && !quickControls.contains(e.target)) {
          quickControls.classList.remove('is-expanded');
          quickToggle.setAttribute('aria-expanded', 'false');
        }
      });

      // Close drawer on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && quickControls.classList.contains('is-expanded')) {
          quickControls.classList.remove('is-expanded');
          quickToggle.setAttribute('aria-expanded', 'false');
          quickToggle.focus();
        }
      });
    }

    if (quickTranslate) {
      quickTranslate.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.translationEnabled = !settings.translationEnabled;
        saveSetting('translationEnabled', settings.translationEnabled);
        updateQuickControlsUI();
        const panelCheckbox = document.querySelector('#lyris-opt-translation');
        if (panelCheckbox) panelCheckbox.checked = settings.translationEnabled;
        if (settings.translationEnabled) fetchTranslationForCurrentLyrics();
        renderCurrentLyricsState();
      });
    }

    const quickDimmer = wrapper.querySelector('#lyris-quick-dimmer');
    if (quickDimmer) {
      quickDimmer.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.backdropDimmer = !(settings.backdropDimmer !== false);
        saveSetting('backdropDimmer', settings.backdropDimmer);
        applySettingsToDOM();
        updateQuickControlsUI();
        const panelCheckbox = document.querySelector('#lyris-opt-backdrop-dimmer');
        if (panelCheckbox) panelCheckbox.checked = settings.backdropDimmer !== false;
      });
    }

    wrapper.querySelectorAll('.lyris-quick-script-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        settings.japaneseMode = mode;
        saveSetting('japaneseMode', mode);
        updateQuickControlsUI();
        const panelSelect = document.querySelector('#lyris-opt-japanese-mode');
        if (panelSelect) panelSelect.value = mode;
        renderCurrentLyricsState();
      });
    });

    updateQuickControlsUI();

    return wrapper;
  }

  function handleManualScroll() {
    userScrolled = true;
    updateResumeSyncButton();
  }

  function updateHeaderUI() {
    const offsetDisplay = document.getElementById('lyris-foot-sync-val') || document.getElementById('am-offset-display');
    if (offsetDisplay) {
      const eff = getEffectiveOffset();
      const sec = (eff / 1000).toFixed(1);
      offsetDisplay.textContent = (eff > 0 ? `+${sec}s` : `${sec}s`);
    }
  }

  // ==========================================================================
  // IN-PAGE RESTRAINED SETTINGS DIALOG (#lyris-settings) & SEARCH MODAL
  // ==========================================================================

  let activeLyrisTab = 'lyrics';

  function updateResumeSyncButton() {
    const resumeBtn = document.getElementById('lyris-resume-btn') || document.getElementById('am-resume-scroll-btn');
    if (!resumeBtn) return;
    if (!currentLyrics.isSynced || activeLineIndex < 0) {
      resumeBtn.hidden = true;
      resumeBtn.classList.remove('visible');
      return;
    }
    const scrollContainer = document.getElementById('lyris-scroll') || document.getElementById('am-lyrics-scroll-container');
    const activeElem = document.querySelector(`.lyris-line[data-index="${activeLineIndex}"], .am-lyric-line[data-index="${activeLineIndex}"]`);
    if (!scrollContainer || !activeElem) {
      resumeBtn.hidden = true;
      resumeBtn.classList.remove('visible');
      return;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    const elemRect = activeElem.getBoundingClientRect();
    const relativeY = (elemRect.top + elemRect.height / 2) - containerRect.top;
    const followY = Math.min(120, Math.max(80, scrollContainer.clientHeight * 0.24));
    const isAway = Math.abs(relativeY - followY) > 35;

    if (userScrolled && isAway) {
      resumeBtn.hidden = false;
      resumeBtn.classList.add('visible');
    } else {
      resumeBtn.hidden = true;
      resumeBtn.classList.remove('visible');
    }
  }

  function showToast(message) {
    let toast = document.getElementById('lyris-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'lyris-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2200);
  }

  function injectSearchModal() {
    if (document.getElementById('lyris-search-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'lyris-search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Manual lyrics search');
    modal.hidden = true;

    modal.innerHTML = `
      <div class="lyris-search-head">
        <h3>Find Lyrics</h3>
        <button class="lyris-icon-btn" id="lyris-search-close-btn" aria-label="Close search (Esc)">✕</button>
      </div>
      <form class="lyris-search-form" id="lyris-search-form">
        <input type="text" class="lyris-search-input" id="lyris-search-input" placeholder="Title or artist…" autocomplete="off" />
        <button type="submit" class="lyris-search-btn">Search</button>
      </form>
      <div class="lyris-search-results" id="lyris-search-results">
        <div style="font-size:12px;color:var(--ly-muted);text-align:center;padding:16px;">Type song title or artist to search synced candidates</div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#lyris-search-close-btn').addEventListener('click', closeSearchModal);

    const form = modal.querySelector('#lyris-search-form');
    const input = modal.querySelector('#lyris-search-input');
    const resultsContainer = modal.querySelector('#lyris-search-results');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = input.value.trim();
      if (!query) return;

      resultsContainer.innerHTML = '<div style="font-size:12px;color:var(--ly-muted);text-align:center;padding:16px;">Searching…</div>';

      safeSendMessage({ action: 'SEARCH_LYRICS_CANDIDATES', query }, (response) => {
        if (!response || !response.candidates || response.candidates.length === 0) {
          resultsContainer.innerHTML = '<div style="font-size:12px;color:var(--ly-muted);text-align:center;padding:16px;">No candidates found. Try a different query.</div>';
          return;
        }

        resultsContainer.innerHTML = '';
        response.candidates.forEach(cand => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'lyris-candidate-item';
          const durSec = cand.duration ? `${Math.floor(cand.duration / 60)}:${String(Math.floor(cand.duration % 60)).padStart(2, '0')}` : '';
          item.innerHTML = `
            <span class="lyris-candidate-title">${escapeHTML(cand.title || 'Unknown Title')}</span>
            <span class="lyris-candidate-meta">${escapeHTML(cand.artist || 'Unknown Artist')} • ${escapeHTML(cand.source || 'LRCLIB')} ${durSec ? '• ' + durSec : ''} ${cand.synced === true ? '• ⏱ Synced' : (cand.synced === false ? '• Plain' : '')}</span>
          `;
          item.addEventListener('click', () => {
            resultsContainer.innerHTML = '<div style="font-size:12px;color:var(--ly-muted);text-align:center;padding:16px;">Loading candidate lyrics…</div>';
            safeSendMessage({ action: 'FETCH_CANDIDATE_LYRICS', candidate: cand }, (res) => {
              if (res && res.success && res.lyrics) {
                const trackInfo = getCurrentTrackInfo();
                const trackKey = `${trackInfo.cleanTitle}__${trackInfo.cleanArtist}`.toLowerCase();
                // Cancel any in-flight automatic fetch so it cannot overwrite the user's chosen lyrics
                currentFetchRequestId++;
                isLoadingLyrics = false;
                currentTrackKey = trackKey;
                currentLyrics = {
                  isSynced: res.synced,
                  lines: res.synced ? parseLRC(res.lyrics) : [],
                  plainText: res.synced ? '' : res.lyrics,
                  source: `${res.source || 'Manual'} (${cand.title})`
                };
                lyricsCache.set(trackKey, currentLyrics);
                renderCurrentLyricsState();
                closeSearchModal();
                showToast(`Applied lyrics: ${cand.title}`);
              } else {
                showToast('Could not load candidate lyrics.');
                closeSearchModal();
              }
            });
          });
          resultsContainer.appendChild(item);
        });
      });
    });
  }

  let searchModalReturnFocus = null;

  function openSearchModal(defaultQuery) {
    injectSearchModal();
    const modal = document.getElementById('lyris-search-modal');
    if (!modal) return;
    searchModalReturnFocus = document.activeElement;
    modal.hidden = false;
    const input = modal.querySelector('#lyris-search-input');
    if (input) {
      const track = getCurrentTrackInfo();
      input.value = defaultQuery || `${track.cleanTitle || track.title} ${track.cleanArtist || track.artist}`.trim();
      input.focus();
      input.select();
    }
  }

  function closeSearchModal() {
    const modal = document.getElementById('lyris-search-modal');
    if (modal) modal.hidden = true;
    // Return focus to whatever opened the modal (e.g. the "Wrong song?" footer button)
    if (searchModalReturnFocus && searchModalReturnFocus.isConnected && typeof searchModalReturnFocus.focus === 'function') {
      searchModalReturnFocus.focus();
    }
    searchModalReturnFocus = null;
  }

  function injectLyrisSettings() {
    if (document.getElementById('lyris-settings')) return;

    const panel = document.createElement('div');
    panel.id = 'lyris-settings';
    panel.className = 'lyris-settings';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Lyris settings');
    panel.hidden = true;

    panel.innerHTML = `
      <div class="lyris-settings-head">
        <div class="lyris-brand">
          <svg class="lyris-mark-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="5" width="9" height="3" rx="1.5" fill="currentColor" opacity="0.5"></rect>
            <rect x="4" y="10.5" width="15" height="3" rx="1.5" fill="currentColor"></rect>
            <circle cx="13.3" cy="12" r="2.2" fill="#fff"></circle>
            <rect x="4" y="16" width="11.5" height="3" rx="1.5" fill="currentColor" opacity="0.5"></rect>
          </svg>
          <span class="lyris-wordmark">lyris</span>
        </div>
        <button class="lyris-icon-btn" id="lyris-settings-close-btn" aria-label="Close settings (Esc)">✕</button>
      </div>
      <div class="lyris-settings-tabs" role="tablist">
        <button role="tab" id="lyris-tab-lyrics" aria-selected="true" data-tab="lyrics">Lyrics</button>
        <button role="tab" id="lyris-tab-light" aria-selected="false" data-tab="light">Light</button>
        <button role="tab" id="lyris-tab-sources" aria-selected="false" data-tab="sources">Sources</button>
      </div>
      <div class="lyris-settings-body">
        <!-- Lyrics Pane -->
        <div class="lyris-pane" id="lyris-pane-lyrics">
          <label class="lyris-setting">
            <span>Synced lyrics</span>
            <input type="checkbox" id="lyris-opt-lyrics-enabled">
          </label>
          <label class="lyris-setting">
            <span>Japanese script</span>
            <select id="lyris-opt-japanese-mode">
              <option value="furigana">Furigana</option>
              <option value="romaji">Romaji</option>
              <option value="hiragana">Hiragana</option>
              <option value="katakana">Katakana</option>
              <option value="original">Original only</option>
            </select>
          </label>
          <label class="lyris-setting">
            <span>Show original text</span>
            <input type="checkbox" id="lyris-opt-show-original">
          </label>
          <label class="lyris-setting">
            <span>Line translation</span>
            <input type="checkbox" id="lyris-opt-translation">
          </label>
          <div class="lyris-setting-range">
            <div class="lyris-range-label">
              <span>Lyric font size</span>
              <output id="lyris-font-size-val">40px</output>
            </div>
            <input type="range" id="lyris-opt-font-size" min="24" max="52" step="2" value="40">
          </div>
          <label class="lyris-setting">
            <span>Word & syllable karaoke</span>
            <input type="checkbox" id="lyris-opt-word-karaoke">
          </label>
          <label class="lyris-setting">
            <span>Background dimming (readability)</span>
            <input type="checkbox" id="lyris-opt-backdrop-dimmer">
          </label>
          <label class="lyris-setting">
            <span>Click lyric to seek</span>
            <input type="checkbox" id="lyris-opt-click-seek">
          </label>
          <button class="lyris-text-action" id="lyris-reset-lyrics-btn">Reset lyrics settings</button>
        </div>

        <!-- Light Pane -->
        <div class="lyris-pane" id="lyris-pane-light" hidden>
          <label class="lyris-setting">
            <span>Ambient lighting</span>
            <input type="checkbox" id="lyris-opt-ambient-enabled">
          </label>
          <div class="lyris-setting-range">
            <div class="lyris-range-label">
              <span>Intensity</span>
              <output id="lyris-intensity-val">95%</output>
            </div>
            <input type="range" id="lyris-opt-intensity" min="25" max="150" step="5" value="95">
          </div>
          <div class="lyris-setting-range">
            <div class="lyris-range-label">
              <span>Spread</span>
              <output id="lyris-spread-val">42%</output>
            </div>
            <input type="range" id="lyris-opt-spread" min="0" max="400" step="1" value="42">
          </div>
          <div class="lyris-setting-range">
            <div class="lyris-range-label">
              <span>Blur</span>
              <output id="lyris-blur-val">70px</output>
            </div>
            <input type="range" id="lyris-opt-blur" min="0" max="140" step="5" value="70">
          </div>
          <div class="lyris-setting-range">
            <div class="lyris-range-label">
              <span>Saturation</span>
              <output id="lyris-sat-val">120%</output>
            </div>
            <input type="range" id="lyris-opt-saturation" min="50" max="200" step="5" value="120">
          </div>
          <div class="lyris-setting-range">
            <div class="lyris-range-label">
              <span>Fade duration</span>
              <output id="lyris-fade-val">0.15s</output>
            </div>
            <input type="range" id="lyris-opt-fade" min="0" max="1.5" step="0.05" value="0.15">
          </div>
          <button class="lyris-text-action" id="lyris-reset-light-btn">Reset light settings</button>
        </div>

        <!-- Sources Pane -->
        <div class="lyris-pane" id="lyris-pane-sources" hidden>
          <p class="lyris-settings-note">Checked top to bottom. Use the arrows to change waterfall priority.</p>
          <div class="lyris-sources-list" id="lyris-sources-container"></div>
          <button class="lyris-text-action" id="lyris-reset-sources-btn">Reset provider order</button>
        </div>
      </div>
      <div class="lyris-settings-foot">
        <span class="lyris-status-dot"></span>
        <span id="lyris-settings-status">Ready</span>
        <span class="lyris-version-label">v1.1.0</span>
      </div>
    `;

    document.body.appendChild(panel);

    const tabs = panel.querySelectorAll('.lyris-settings-tabs button');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        activeLyrisTab = tab.dataset.tab;
        panel.querySelector('#lyris-pane-lyrics').hidden = (activeLyrisTab !== 'lyrics');
        panel.querySelector('#lyris-pane-light').hidden = (activeLyrisTab !== 'light');
        panel.querySelector('#lyris-pane-sources').hidden = (activeLyrisTab !== 'sources');
        if (activeLyrisTab === 'sources') {
          renderSourcesListUI();
        }
      });
    });

    panel.querySelector('#lyris-settings-close-btn').addEventListener('click', () => closeLyrisSettings(true));

    setupLyrisSettingsControls(panel);
    updateLyrisSettingsUI();
  }

  function setupLyrisSettingsControls(panel) {
    // 1. Lyrics controls
    const lyToggle = panel.querySelector('#lyris-opt-lyrics-enabled');
    if (lyToggle) {
      lyToggle.addEventListener('change', () => {
        const val = lyToggle.checked;
        settings.lyricsEnabled = val;
        settings.appleMode = val;
        saveSetting('lyricsEnabled', val);
        saveSetting('appleMode', val);
        applySettingsToDOM();
        if (val) {
          if (isLyricsTabSelected()) {
            activateLyricsTab();
          }
        } else {
          deactivateCustomLyricsTab();
        }
      });
    }

    const jMode = panel.querySelector('#lyris-opt-japanese-mode');
    if (jMode) {
      jMode.addEventListener('change', () => {
        settings.japaneseMode = jMode.value;
        saveSetting('japaneseMode', settings.japaneseMode);
        renderCurrentLyricsState();
      });
    }

    const showOrig = panel.querySelector('#lyris-opt-show-original');
    if (showOrig) {
      showOrig.addEventListener('change', () => {
        settings.showOriginal = showOrig.checked;
        saveSetting('showOriginal', settings.showOriginal);
        renderCurrentLyricsState();
      });
    }

    const transOpt = panel.querySelector('#lyris-opt-translation');
    if (transOpt) {
      transOpt.addEventListener('change', () => {
        settings.translationEnabled = transOpt.checked;
        saveSetting('translationEnabled', settings.translationEnabled);
        if (settings.translationEnabled && (!currentLyrics.translations || currentLyrics.translations.length === 0)) {
          fetchTranslationForCurrentLyrics();
        } else {
          renderCurrentLyricsState();
        }
      });
    }

    const fontSizeInput = panel.querySelector('#lyris-opt-font-size');
    const fontSizeVal = panel.querySelector('#lyris-font-size-val');
    if (fontSizeInput) {
      fontSizeInput.addEventListener('input', () => {
        const val = parseInt(fontSizeInput.value, 10);
        if (fontSizeVal) fontSizeVal.textContent = `${val}px`;
        settings.fontSize = val;
        document.documentElement.style.setProperty('--ly-font-size', `${val}px`);
        document.documentElement.style.setProperty('--am-font-size', `${val}px`);
        saveSetting('fontSize', val, 250);
      });
      fontSizeInput.addEventListener('change', () => {
        const val = parseInt(fontSizeInput.value, 10);
        saveSetting('fontSize', val, 0);
      });
    }

    const wordKaraoke = panel.querySelector('#lyris-opt-word-karaoke');
    if (wordKaraoke) {
      wordKaraoke.addEventListener('change', () => {
        settings.wordHighlight = wordKaraoke.checked;
        saveSetting('wordHighlight', settings.wordHighlight);
      });
    }

    const clickSeek = panel.querySelector('#lyris-opt-click-seek');
    if (clickSeek) {
      clickSeek.addEventListener('change', () => {
        settings.clickToSeek = clickSeek.checked;
        saveSetting('clickToSeek', settings.clickToSeek);
      });
    }

    const backdropDimmer = panel.querySelector('#lyris-opt-backdrop-dimmer');
    if (backdropDimmer) {
      backdropDimmer.addEventListener('change', () => {
        settings.backdropDimmer = backdropDimmer.checked;
        saveSetting('backdropDimmer', settings.backdropDimmer);
        applySettingsToDOM();
        updateQuickControlsUI();
      });
    }

    // Reset Lyrics
    const resetLyricsBtn = panel.querySelector('#lyris-reset-lyrics-btn');
    if (resetLyricsBtn) {
      resetLyricsBtn.addEventListener('click', () => {
        settings.lyricsEnabled = DEFAULT_SETTINGS.lyricsEnabled;
        settings.appleMode = DEFAULT_SETTINGS.appleMode;
        settings.japaneseMode = DEFAULT_SETTINGS.japaneseMode;
        settings.showOriginal = DEFAULT_SETTINGS.showOriginal;
        settings.translationEnabled = DEFAULT_SETTINGS.translationEnabled;
        settings.backdropDimmer = DEFAULT_SETTINGS.backdropDimmer;
        settings.fontSize = DEFAULT_SETTINGS.fontSize;
        settings.wordHighlight = DEFAULT_SETTINGS.wordHighlight;
        settings.clickToSeek = DEFAULT_SETTINGS.clickToSeek;

        const toSave = {
          lyricsEnabled: DEFAULT_SETTINGS.lyricsEnabled,
          appleMode: DEFAULT_SETTINGS.appleMode,
          japaneseMode: DEFAULT_SETTINGS.japaneseMode,
          showOriginal: DEFAULT_SETTINGS.showOriginal,
          translationEnabled: DEFAULT_SETTINGS.translationEnabled,
          backdropDimmer: DEFAULT_SETTINGS.backdropDimmer,
          fontSize: DEFAULT_SETTINGS.fontSize,
          wordHighlight: DEFAULT_SETTINGS.wordHighlight,
          clickToSeek: DEFAULT_SETTINGS.clickToSeek
        };
        try {
          chrome.storage.sync.set(toSave);
        } catch (e) {
          console.warn('[Lyris] Storage error:', e);
        }

        applySettingsToDOM();
        updateLyrisSettingsUI();
        renderCurrentLyricsState();
        showToast('Lyrics settings reset to defaults');
      });
    }

    // 2. Light controls
    const ambToggle = panel.querySelector('#lyris-opt-ambient-enabled');
    if (ambToggle) {
      ambToggle.addEventListener('change', () => {
        const val = ambToggle.checked;
        settings.ambientEnabled = val;
        settings.ambientLighting = val;
        saveSetting('ambientEnabled', val);
        saveSetting('ambientLighting', val);
        applySettingsToDOM();
        ambientEngine.toggle(val);
      });
    }

    const intInput = panel.querySelector('#lyris-opt-intensity');
    const intVal = panel.querySelector('#lyris-intensity-val');
    if (intInput) {
      intInput.addEventListener('input', () => {
        const val = parseInt(intInput.value, 10);
        if (intVal) intVal.textContent = `${val}%`;
        settings.ambientBrightness = val;
        settings.ambientIntensity = val;
        ambientEngine.updateBrightness(val);
        saveSetting('ambientBrightness', val, 250);
        saveSetting('ambientIntensity', val, 250);
      });
      intInput.addEventListener('change', () => {
        const val = parseInt(intInput.value, 10);
        saveSetting('ambientBrightness', val, 0);
        saveSetting('ambientIntensity', val, 0);
      });
    }

    const spreadInput = panel.querySelector('#lyris-opt-spread');
    const spreadVal = panel.querySelector('#lyris-spread-val');
    if (spreadInput) {
      spreadInput.addEventListener('input', () => {
        const val = parseInt(spreadInput.value, 10);
        if (spreadVal) spreadVal.textContent = `${val}%`;
        settings.ambientSpread = val;
        ambientEngine.updateSpread(val);
        saveSetting('ambientSpread', val, 250);
      });
      spreadInput.addEventListener('change', () => {
        const val = parseInt(spreadInput.value, 10);
        saveSetting('ambientSpread', val, 0);
      });
    }

    const blurInput = panel.querySelector('#lyris-opt-blur');
    const blurVal = panel.querySelector('#lyris-blur-val');
    if (blurInput) {
      blurInput.addEventListener('input', () => {
        const val = parseInt(blurInput.value, 10);
        if (blurVal) blurVal.textContent = `${val}px`;
        settings.ambientBlur = val;
        ambientEngine.updateBlur(val);
        saveSetting('ambientBlur', val, 250);
      });
      blurInput.addEventListener('change', () => {
        const val = parseInt(blurInput.value, 10);
        saveSetting('ambientBlur', val, 0);
      });
    }

    const satInput = panel.querySelector('#lyris-opt-saturation');
    const satVal = panel.querySelector('#lyris-sat-val');
    if (satInput) {
      satInput.addEventListener('input', () => {
        const val = parseInt(satInput.value, 10);
        if (satVal) satVal.textContent = `${val}%`;
        settings.ambientSaturation = val;
        ambientEngine.updateSaturation(val);
        saveSetting('ambientSaturation', val, 250);
      });
      satInput.addEventListener('change', () => {
        const val = parseInt(satInput.value, 10);
        saveSetting('ambientSaturation', val, 0);
      });
    }

    const fadeInput = panel.querySelector('#lyris-opt-fade');
    const fadeVal = panel.querySelector('#lyris-fade-val');
    if (fadeInput) {
      fadeInput.addEventListener('input', () => {
        const val = parseFloat(fadeInput.value);
        if (fadeVal) fadeVal.textContent = val === 0 ? 'Off' : `${val.toFixed(2)}s`;
        settings.ambientFadeDuration = val;
        ambientEngine.updateFadeDuration(val);
        saveSetting('ambientFadeDuration', val, 250);
      });
      fadeInput.addEventListener('change', () => {
        const val = parseFloat(fadeInput.value);
        saveSetting('ambientFadeDuration', val, 0);
      });
    }

    // Reset Light
    const resetLightBtn = panel.querySelector('#lyris-reset-light-btn');
    if (resetLightBtn) {
      resetLightBtn.addEventListener('click', () => {
        settings.ambientEnabled = DEFAULT_SETTINGS.ambientEnabled;
        settings.ambientLighting = DEFAULT_SETTINGS.ambientLighting;
        settings.ambientBrightness = DEFAULT_SETTINGS.ambientBrightness;
        settings.ambientIntensity = DEFAULT_SETTINGS.ambientIntensity;
        settings.ambientSpread = DEFAULT_SETTINGS.ambientSpread;
        settings.ambientBlur = DEFAULT_SETTINGS.ambientBlur;
        settings.ambientSaturation = DEFAULT_SETTINGS.ambientSaturation;
        settings.ambientFadeDuration = DEFAULT_SETTINGS.ambientFadeDuration;

        const toSave = {
          ambientEnabled: DEFAULT_SETTINGS.ambientEnabled,
          ambientLighting: DEFAULT_SETTINGS.ambientLighting,
          ambientBrightness: DEFAULT_SETTINGS.ambientBrightness,
          ambientIntensity: DEFAULT_SETTINGS.ambientIntensity,
          ambientSpread: DEFAULT_SETTINGS.ambientSpread,
          ambientBlur: DEFAULT_SETTINGS.ambientBlur,
          ambientSaturation: DEFAULT_SETTINGS.ambientSaturation,
          ambientFadeDuration: DEFAULT_SETTINGS.ambientFadeDuration
        };
        try {
          chrome.storage.sync.set(toSave);
        } catch (e) {
          console.warn('[Lyris] Storage error:', e);
        }

        applySettingsToDOM();
        ambientEngine.toggle(DEFAULT_SETTINGS.ambientEnabled);
        ambientEngine.updateBrightness(DEFAULT_SETTINGS.ambientBrightness);
        ambientEngine.updateSpread(DEFAULT_SETTINGS.ambientSpread);
        ambientEngine.updateBlur(DEFAULT_SETTINGS.ambientBlur);
        ambientEngine.updateSaturation(DEFAULT_SETTINGS.ambientSaturation);
        ambientEngine.updateFadeDuration(DEFAULT_SETTINGS.ambientFadeDuration);
        updateLyrisSettingsUI();
        showToast('Light settings reset to defaults');
      });
    }

    // 3. Reset Sources
    const resetSourcesBtn = panel.querySelector('#lyris-reset-sources-btn');
    if (resetSourcesBtn) {
      resetSourcesBtn.addEventListener('click', () => {
        settings.providerOrder = [...DEFAULT_SETTINGS.providerOrder];
        settings.enabledProviders = { ...DEFAULT_SETTINGS.enabledProviders };
        // Single atomic write -> one storage.onChanged event -> one lyrics reload
        try {
          chrome.storage.sync.set({ providerOrder: settings.providerOrder, enabledProviders: settings.enabledProviders });
        } catch (e) {}
        renderSourcesListUI();
        showToast('Provider order reset to defaults');
      });
    }
  }

  function updateLyrisSettingsUI() {
    const panel = document.getElementById('lyris-settings');
    if (!panel) return;

    const lyEnabled = panel.querySelector('#lyris-opt-lyrics-enabled');
    if (lyEnabled) lyEnabled.checked = (settings.lyricsEnabled ?? settings.appleMode) !== false;

    const jMode = panel.querySelector('#lyris-opt-japanese-mode');
    if (jMode) jMode.value = settings.japaneseMode || 'furigana';

    const showOrig = panel.querySelector('#lyris-opt-show-original');
    if (showOrig) showOrig.checked = settings.showOriginal === true;

    const transOpt = panel.querySelector('#lyris-opt-translation');
    if (transOpt) transOpt.checked = Boolean(settings.translationEnabled);

    const fsInput = panel.querySelector('#lyris-opt-font-size');
    const fsVal = panel.querySelector('#lyris-font-size-val');
    const fontSize = settings.fontSize || 40;
    if (fsInput) fsInput.value = fontSize;
    if (fsVal) fsVal.textContent = `${fontSize}px`;

    const wk = panel.querySelector('#lyris-opt-word-karaoke');
    if (wk) wk.checked = settings.wordHighlight !== false;

    const cs = panel.querySelector('#lyris-opt-click-seek');
    if (cs) cs.checked = settings.clickToSeek !== false;

    const dimOpt = panel.querySelector('#lyris-opt-backdrop-dimmer');
    if (dimOpt) dimOpt.checked = settings.backdropDimmer !== false;

    const amb = panel.querySelector('#lyris-opt-ambient-enabled');
    if (amb) amb.checked = (settings.ambientEnabled ?? settings.ambientLighting) !== false;

    const intInput = panel.querySelector('#lyris-opt-intensity');
    const intVal = panel.querySelector('#lyris-intensity-val');
    const intensity = settings.ambientBrightness ?? settings.ambientIntensity ?? 95;
    if (intInput) intInput.value = intensity;
    if (intVal) intVal.textContent = `${intensity}%`;

    const spreadInput = panel.querySelector('#lyris-opt-spread');
    const spreadVal = panel.querySelector('#lyris-spread-val');
    const spread = settings.ambientSpread ?? 42;
    if (spreadInput) spreadInput.value = spread;
    if (spreadVal) spreadVal.textContent = `${spread}%`;

    const blurInput = panel.querySelector('#lyris-opt-blur');
    const blurVal = panel.querySelector('#lyris-blur-val');
    const blur = settings.ambientBlur ?? 70;
    if (blurInput) blurInput.value = blur;
    if (blurVal) blurVal.textContent = `${blur}px`;

    const satInput = panel.querySelector('#lyris-opt-saturation');
    const satVal = panel.querySelector('#lyris-sat-val');
    const sat = settings.ambientSaturation ?? 120;
    if (satInput) satInput.value = sat;
    if (satVal) satVal.textContent = `${sat}%`;

    const fadeInput = panel.querySelector('#lyris-opt-fade');
    const fadeVal = panel.querySelector('#lyris-fade-val');
    const fade = settings.ambientFadeDuration ?? 0.15;
    if (fadeInput) fadeInput.value = fade;
    if (fadeVal) fadeVal.textContent = fade === 0 ? 'Off' : `${Number(fade).toFixed(2)}s`;

    renderSourcesListUI();
    updateQuickControlsUI();
  }

  function updateQuickControlsUI() {
    const badgeLabels = { furigana: '振', romaji: 'Aa', hiragana: 'あ', katakana: 'ア', original: '原' };
    const currentMode = settings.japaneseMode || 'furigana';
    const isTranslateOn = Boolean(settings.translationEnabled);

    // Update trigger badge text
    const badge = document.getElementById('lyris-quick-badge');
    if (badge) badge.textContent = badgeLabels[currentMode] || '振';

    // Update translate-active indicator on trigger
    const toggleBtn = document.getElementById('lyris-quick-toggle-btn');
    if (toggleBtn) toggleBtn.classList.toggle('translate-active', isTranslateOn);

    // Update translate pill
    const translateBtn = document.getElementById('lyris-quick-translate');
    if (translateBtn) {
      translateBtn.classList.toggle('active', isTranslateOn);
      translateBtn.setAttribute('aria-pressed', String(isTranslateOn));
    }

    // Update dimmer pill
    const dimmerBtn = document.getElementById('lyris-quick-dimmer');
    if (dimmerBtn) {
      const isDimmerOn = settings.backdropDimmer !== false;
      dimmerBtn.classList.toggle('active', isDimmerOn);
      dimmerBtn.setAttribute('aria-pressed', String(isDimmerOn));
    }

    // Update script radio buttons
    document.querySelectorAll('.lyris-quick-script-btn').forEach(btn => {
      const match = btn.dataset.mode === currentMode;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-checked', String(match));
    });
  }

  function renderSourcesListUI() {
    const container = document.getElementById('lyris-sources-container');
    if (!container) return;

    container.innerHTML = '';
    const order = [...(settings.providerOrder || DEFAULT_SETTINGS.providerOrder)];
    const enabled = { ...(settings.enabledProviders || DEFAULT_SETTINGS.enabledProviders) };

    const names = {
      'lrclib': 'LRCLIB (Synced & Plain)',
      'netease': 'NetEase Music (网易云音乐)',
      'kugou': 'KuGou Music (酷狗音乐)',
      'youtube-cc': 'YouTube Captions (CC)',
      'native': 'YouTube Music Native',
      'qq': 'QQ Music (Disabled by default)'
    };

    order.forEach((providerId, index) => {
      // QQ runs only when explicitly enabled (background.js requires qq === true);
      // all other providers are on unless explicitly disabled.
      const isChecked = providerId === 'qq' ? (enabled.qq === true) : (enabled[providerId] !== false);
      const row = document.createElement('div');
      row.className = 'lyris-source-row';

      row.innerHTML = `
        <label class="lyris-source-info">
          <input type="checkbox" data-provider="${providerId}" ${isChecked ? 'checked' : ''}>
          <span>${names[providerId] || providerId}</span>
        </label>
        <div style="display:flex;gap:4px;">
          <button class="lyris-icon-btn" data-action="up" title="Move up" ${index === 0 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>▲</button>
          <button class="lyris-icon-btn" data-action="down" title="Move down" ${index === order.length - 1 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>▼</button>
        </div>
      `;

      const chk = row.querySelector('input[type="checkbox"]');
      chk.addEventListener('change', () => {
        enabled[providerId] = chk.checked;
        settings.enabledProviders = { ...enabled };
        saveSetting('enabledProviders', settings.enabledProviders);
        // Reload is handled once by the storage.onChanged listener (providerOrder/enabledProviders)
      });

      const upBtn = row.querySelector('[data-action="up"]');
      if (upBtn && index > 0) {
        upBtn.addEventListener('click', () => {
          const temp = order[index];
          order[index] = order[index - 1];
          order[index - 1] = temp;
          settings.providerOrder = [...order];
          saveSetting('providerOrder', settings.providerOrder);
          renderSourcesListUI();
        });
      }

      const downBtn = row.querySelector('[data-action="down"]');
      if (downBtn && index < order.length - 1) {
        downBtn.addEventListener('click', () => {
          const temp = order[index];
          order[index] = order[index + 1];
          order[index + 1] = temp;
          settings.providerOrder = [...order];
          saveSetting('providerOrder', settings.providerOrder);
          renderSourcesListUI();
        });
      }

      container.appendChild(row);
    });
  }

  function openLyrisSettings() {
    injectLyrisSettings();
    const panel = document.getElementById('lyris-settings');
    if (panel) {
      panel.hidden = false;
      updateLyrisSettingsUI();
    }
    const trigger = document.getElementById('lyris-settings-btn');
    if (trigger) {
      trigger.classList.add('active');
      trigger.setAttribute('aria-expanded', 'true');
    }
  }

  function closeLyrisSettings(restoreFocus = true) {
    const panel = document.getElementById('lyris-settings');
    if (panel) panel.hidden = true;
    const trigger = document.getElementById('lyris-settings-btn');
    if (trigger) {
      trigger.classList.remove('active');
      trigger.setAttribute('aria-expanded', 'false');
      // Return focus to the trigger only for keyboard/explicit closes, never when the user
      // dismissed the panel by clicking something else (that would steal their focus).
      if (restoreFocus === true) trigger.focus();
    }
  }

  function toggleLyrisSettings() {
    const panel = document.getElementById('lyris-settings');
    if (panel && !panel.hidden) {
      closeLyrisSettings();
    } else {
      openLyrisSettings();
    }
  }

  function toggleIntegratedModal() {
    toggleLyrisSettings();
  }

  // Global Esc key and click outside listener.
  // Capture phase + stopPropagation so Esc closes OUR dialog without also triggering
  // YouTube Music's own Esc handling (e.g. collapsing the player page).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const settingsPanel = document.getElementById('lyris-settings');
      if (settingsPanel && !settingsPanel.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeLyrisSettings(true);
        return;
      }
      const searchModal = document.getElementById('lyris-search-modal');
      if (searchModal && !searchModal.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeSearchModal();
        return;
      }
    }
  }, true);

  window.addEventListener('click', (e) => {
    const panel = document.getElementById('lyris-settings');
    const trigger = document.getElementById('lyris-settings-btn');
    if (panel && !panel.hidden) {
      if (!panel.contains(e.target) && !trigger?.contains(e.target)) {
        closeLyrisSettings(false);
      }
    }
  });

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

    const singingTokens = [];
    tokens.forEach((tok, idx) => {
      if (tok.trim().length > 0) {
        singingTokens.push({ token: tok, index: idx });
      }
    });

    const totalSinging = singingTokens.length;
    const activeSingDuration = lineDuration * 0.90;

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

  function renderLoadingState(title) {
    const listContainer = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
    if (!listContainer) return;
    listContainer.innerHTML = `
      <div class="lyris-state am-loading-state">
        <div class="lyris-spinner am-spinner"></div>
        <div class="lyris-state-text">
          <h3>Finding lyrics…</h3>
          <p>${escapeHTML(title || 'Current track')}</p>
        </div>
      </div>
    `;
  }

  function renderLyricsUI() {
    const listContainer = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    listContainer.classList.remove('lyris-plain');

    if (currentLyrics.lines.length === 0) {
      if (currentLyrics.plainText) {
        renderStaticLyrics(currentLyrics.plainText);
      } else {
        listContainer.innerHTML = `
          <div class="lyris-state am-empty-state">
            <h3>No matching lyrics</h3>
            <p>Lyrics are not available for this track yet.</p>
            <button class="am-state-btn" id="lyris-empty-search-btn">Search lyrics</button>
          </div>
        `;
        const btn = listContainer.querySelector('#lyris-empty-search-btn');
        if (btn) btn.addEventListener('click', () => openSearchModal());
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    const mode = settings.japaneseMode || 'furigana';

    currentLyrics.lines.forEach((line, index) => {
      const nextLine = currentLyrics.lines[index + 1];
      line.wordTimings = computeWordTimings(line, nextLine);

      const lineElem = document.createElement('div');
      lineElem.className = 'lyris-line am-lyric-line';
      lineElem.dataset.index = index;
      lineElem.dataset.time = line.time;

      const primaryContainer = document.createElement('div');
      primaryContainer.className = 'lyris-line-primary am-line-primary';

      if (line.wordTimings && line.wordTimings.length > 0) {
        line.wordTimings.forEach((w, wIdx) => {
          if (w.isSpace) {
            primaryContainer.appendChild(document.createTextNode(w.text));
          } else {
            const span = document.createElement('span');
            span.className = 'lyris-word am-word';
            span.dataset.wordIdx = wIdx;
            const converted = convertJapaneseLine(w.text, mode);
            span.innerHTML = (converted && typeof converted === 'object' && 'text' in converted) ? converted.text : (converted || '');
            primaryContainer.appendChild(span);
          }
        });
      } else {
        const converted = convertJapaneseLine(line.text || '♪', mode);
        primaryContainer.innerHTML = (converted && typeof converted === 'object' && 'text' in converted) ? converted.text : (converted || '');
      }

      lineElem.appendChild(primaryContainer);

      // Dual-line Japanese reading layout: show original beneath reading if enabled
      if (settings.showOriginal === true && mode !== 'original' && mode !== 'furigana' && containsJapanese(line.text)) {
        const origElem = document.createElement('div');
        origElem.className = 'lyris-original-line';
        origElem.textContent = line.text;
        lineElem.appendChild(origElem);
      }

      // Line translation underneath if enabled
      if (settings.translationEnabled && line.translation) {
        const transElem = document.createElement('div');
        transElem.className = 'lyris-translation-line am-line-translation';
        transElem.textContent = line.translation;
        lineElem.appendChild(transElem);
      }

      lineElem.title = 'Click to seek • Alt+Click to calibrate audio sync';
      // Keyboard access: lines are focusable and Enter/Space behave like a click
      // (Alt/Shift+Enter calibrates, mirroring Alt/Shift+Click).
      lineElem.tabIndex = 0;
      lineElem.setAttribute('role', 'button');
      lineElem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation(); // don't let the scroll container treat Space as manual browsing
          lineElem.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: e.altKey, shiftKey: e.shiftKey }));
        }
      });
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

        if (settings.clickToSeek === false) return;

        const eff = getEffectiveOffset();
        video.currentTime = Math.max(0, line.time - (eff / 1000));
        userScrolled = false;
        const resumeBtn = document.getElementById('lyris-resume-btn') || document.getElementById('am-resume-scroll-btn');
        if (resumeBtn) {
          resumeBtn.hidden = true;
          resumeBtn.classList.remove('visible');
        }
        setActiveLine(index, true);
      });

      fragment.appendChild(lineElem);
    });

    // Provider Footer (Follows final lyric)
    const trackInfo = getCurrentTrackInfo();
    let sourceDisplay = currentLyrics.source;
    if (sourceDisplay === 'native') sourceDisplay = 'YouTube Music';
    if (!sourceDisplay || sourceDisplay === 'none') sourceDisplay = 'Synced Engine';

    const eff = getEffectiveOffset();
    const sec = (eff / 1000).toFixed(1);
    const offsetLabel = (eff > 0 ? `+${sec}s` : `${sec}s`);

    const footer = document.createElement('div');
    footer.className = 'lyris-provider-foot am-lyrics-footer';

    footer.innerHTML = `
      <div class="lyris-foot-source">
        <strong>Lyrics by ${escapeHTML(sourceDisplay)}</strong>
        <span>Estimated word & syllable timing • ${escapeHTML(trackInfo.cleanTitle || trackInfo.title || 'Track')}</span>
      </div>
      <div class="lyris-foot-sync-row">
        <span class="lyris-foot-sync-label">Sync:</span>
        <button class="lyris-nudge-btn" data-delta="-500" title="Shift earlier 0.5s">-0.5s</button>
        <button class="lyris-nudge-btn" data-delta="-100" title="Shift earlier 0.1s">-0.1s</button>
        <span class="lyris-sync-val ${eff !== 0 ? 'has-custom' : ''}" id="lyris-foot-sync-val">${offsetLabel}</span>
        <button class="lyris-nudge-btn" data-delta="100" title="Shift later 0.1s">+0.1s</button>
        <button class="lyris-nudge-btn" data-delta="500" title="Shift later 0.5s">+0.5s</button>
        <button class="lyris-nudge-reset" id="lyris-foot-sync-reset" title="Reset track audio sync" style="display: ${eff !== 0 ? 'inline-block' : 'none'};">↺</button>
      </div>
      <div class="lyris-foot-actions">
        <button class="lyris-foot-btn" id="lyris-foot-search-btn">Wrong song? Find another</button>
      </div>
    `;

    footer.querySelectorAll('.lyris-nudge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const delta = parseInt(btn.dataset.delta, 10);
        if (!isNaN(delta)) {
          adjustTrackOffset(delta);
          const current = getEffectiveOffset();
          const sign = current > 0 ? '+' : '';
          const disp = document.getElementById('lyris-foot-sync-val');
          if (disp) disp.textContent = `${sign}${(current / 1000).toFixed(1)}s`;
          const rst = document.getElementById('lyris-foot-sync-reset');
          if (rst) rst.style.display = current !== 0 ? 'inline-block' : 'none';
          showToast(`Audio sync: ${sign}${(current / 1000).toFixed(1)}s`);
        }
      });
    });

    const resetTrackBtn = footer.querySelector('#lyris-foot-sync-reset');
    if (resetTrackBtn) {
      resetTrackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetTrackOffset();
        const disp = document.getElementById('lyris-foot-sync-val');
        if (disp) disp.textContent = '0.0s';
        resetTrackBtn.style.display = 'none';
        showToast('Audio sync reset to 0.0s');
      });
    }

    const wrongSongBtn = footer.querySelector('#lyris-foot-search-btn');
    if (wrongSongBtn) {
      wrongSongBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSearchModal();
      });
    }

    fragment.appendChild(footer);
    listContainer.appendChild(fragment);

    activeLineIndex = -1;
    updateActiveLine();
    updateQuickControlsUI();
  }

  function renderStaticLyrics(plainText) {
    const listContainer = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    listContainer.classList.add('lyris-plain');

    const mode = settings.japaneseMode || 'furigana';
    const lines = plainText.split('\n');
    lines.forEach((rawText, idx) => {
      const trimmed = rawText.trim();
      const lineElem = document.createElement('div');
      lineElem.className = 'lyris-line am-lyric-line static-line';

      const primary = document.createElement('div');
      primary.className = 'lyris-line-primary am-line-primary';
      const converted = convertJapaneseLine(trimmed || '', mode);
      primary.innerHTML = (converted && typeof converted === 'object' && 'text' in converted) ? converted.text : (converted || '');
      lineElem.appendChild(primary);

      if (settings.showOriginal === true && mode !== 'original' && mode !== 'furigana' && containsJapanese(trimmed)) {
        const origElem = document.createElement('div');
        origElem.className = 'lyris-original-line';
        origElem.textContent = trimmed;
        lineElem.appendChild(origElem);
      }

      if (settings.translationEnabled && currentLyrics.translations && currentLyrics.translations[idx]) {
        const transElem = document.createElement('div');
        transElem.className = 'lyris-translation-line am-line-translation';
        transElem.textContent = currentLyrics.translations[idx];
        lineElem.appendChild(transElem);
      }

      listContainer.appendChild(lineElem);
    });

    // Footer Attribution for Static Lyrics
    const footer = document.createElement('div');
    footer.className = 'lyris-provider-foot am-lyrics-footer';

    let sourceDisplay = currentLyrics.source;
    if (sourceDisplay === 'native') sourceDisplay = 'YouTube Music';
    if (!sourceDisplay || sourceDisplay === 'none') sourceDisplay = 'Plain Lyrics';

    footer.innerHTML = `
      <div class="lyris-foot-source">
        <strong>Lyrics by ${escapeHTML(sourceDisplay)}</strong>
        <span>Plain lyrics (Timestamps unavailable for this match)</span>
      </div>
      <div class="lyris-foot-actions">
        <button class="lyris-foot-btn" id="lyris-foot-find-synced-btn">Find synced lyrics</button>
        <button class="lyris-foot-btn" id="lyris-foot-search-btn">Wrong song? Find another</button>
      </div>
    `;

    const findSyncedBtn = footer.querySelector('#lyris-foot-find-synced-btn');
    if (findSyncedBtn) {
      findSyncedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadLyricsForCurrentTrack(true);
      });
    }

    const wrongSongBtn = footer.querySelector('#lyris-foot-search-btn');
    if (wrongSongBtn) {
      wrongSongBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSearchModal();
      });
    }

    listContainer.appendChild(footer);
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

    if (activeLineIndex >= 0 && settings.lineHighlight !== false && settings.wordHighlight !== false) {
      updateActiveLineWordHighlight(currentTime);
    }
  }

  function updateActiveLineWordHighlight(currentTime) {
    const activeElem = document.querySelector(`.lyris-line[data-index="${activeLineIndex}"], .am-lyric-line[data-index="${activeLineIndex}"]`);
    if (!activeElem) return;

    const lineData = currentLyrics.lines[activeLineIndex];
    if (!lineData || !lineData.wordTimings) return;

    const wordSpans = activeElem.querySelectorAll('.lyris-word, .am-word');
    wordSpans.forEach(span => {
      const wIdx = parseInt(span.dataset.wordIdx, 10);
      const w = lineData.wordTimings[wIdx];
      if (!w) return;

      const dur = Math.max(0.05, w.duration || 0.2);
      const percent = Math.max(0, Math.min(100, ((currentTime - w.time) / dur) * 100));
      span.style.setProperty('--fill', `${percent.toFixed(1)}%`);
      span.style.setProperty('--ly-word-fill', `${percent.toFixed(1)}%`);
      span.style.setProperty('--am-word-fill', `${percent.toFixed(1)}%`);

      if (currentTime >= w.time + w.duration) {
        span.classList.add('sung');
        span.classList.remove('live', 'singing');
      } else if (currentTime >= w.time && currentTime < w.time + w.duration) {
        span.classList.add('live', 'singing');
        span.classList.remove('sung');
      } else {
        span.classList.remove('sung', 'live', 'singing');
      }
    });
  }

  function setActiveLine(newIndex, shouldScroll = true) {
    activeLineIndex = newIndex;
    const lines = document.querySelectorAll('.lyris-line[data-index], .am-lyric-line[data-index]');

    lines.forEach((elem) => {
      const idx = parseInt(elem.dataset.index, 10);
      const wordSpans = elem.querySelectorAll('.lyris-word, .am-word');

      if (idx === activeLineIndex) {
        elem.classList.add('current', 'active');
        elem.classList.remove('past', 'passed');
      } else if (idx < activeLineIndex) {
        elem.classList.remove('current', 'active');
        elem.classList.add('past', 'passed');
        wordSpans.forEach(w => {
          w.classList.add('sung');
          w.classList.remove('live', 'singing');
          w.style.setProperty('--fill', '100%');
          w.style.setProperty('--ly-word-fill', '100%');
          w.style.setProperty('--am-word-fill', '100%');
        });
      } else {
        elem.classList.remove('current', 'active', 'past', 'passed');
        wordSpans.forEach(w => {
          w.classList.remove('sung', 'live', 'singing');
          w.style.setProperty('--fill', '0%');
          w.style.setProperty('--ly-word-fill', '0%');
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
    const activeElem = document.querySelector(`.lyris-line[data-index="${activeLineIndex}"], .am-lyric-line[data-index="${activeLineIndex}"]`);
    if (!activeElem) return;

    const scrollContainer = document.getElementById('lyris-scroll') || document.getElementById('am-lyrics-scroll-container');
    if (!scrollContainer) return;

    // Follow offset geometry contract:
    // followY = clamp(scrollContainer.clientHeight * 0.24, 80px, 120px)
    const containerRect = scrollContainer.getBoundingClientRect();
    const elemRect = activeElem.getBoundingClientRect();
    const relativeTop = (elemRect.top + elemRect.height / 2) - containerRect.top;
    const followY = Math.min(120, Math.max(80, scrollContainer.clientHeight * 0.24));
    const targetScroll = Math.round(scrollContainer.scrollTop + relativeTop - followY);

    scrollContainer.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: smooth ? 'smooth' : 'auto'
    });
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
  let durationRetryTimer = null;

  function isAdPlaying() {
    const player = document.querySelector('#movie_player');
    if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) return true;
    const byline = document.querySelector('ytmusic-player-bar .byline');
    return !!(byline && /video will play after ad/i.test(byline.textContent || ''));
  }

  function renderAdState() {
    const listContainer = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
    if (!listContainer) return;
    listContainer.classList.remove('lyris-plain');
    listContainer.innerHTML = `
      <div class="lyris-state">
        <h3>Lyrics after the ad</h3>
        <p>Lyris will load lyrics as soon as your song starts.</p>
      </div>
    `;
  }

  function loadLyricsForCurrentTrack(forceReload = false) {
    // During ads the player reports the ad as the current track; never search for it.
    if (isAdPlaying()) {
      if (currentTrackKey === '__ad__') return; // already showing the ad state
      currentFetchRequestId++;
      currentTrackKey = '__ad__';
      currentLyrics = { isSynced: false, lines: [], plainText: '', source: 'none' };
      isLoadingLyrics = false;
      renderAdState();
      return;
    }
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
        // Keep a single retry timer so repeated watcher calls don't stack multiple retries
        clearTimeout(durationRetryTimer);
        durationRetryTimer = setTimeout(() => loadLyricsForCurrentTrack(forceReload), 400);
        return;
      }
    }
    clearTimeout(durationRetryTimer);
    durationRetryTimer = null;
    durationRetryCount = 0;

    if (!trackInfo.cleanTitle && !trackInfo.title) return;
    // Skip if this exact track is already loaded, already loading, or cached — prevents
    // duplicate FETCH_LYRICS requests from the 500ms watcher firing during a load.
    if (!forceReload && trackKey === currentTrackKey &&
        (isLoadingLyrics || lyricsCache.has(trackKey) || currentLyrics.lines.length > 0)) return;

    if (forceReload) {
      lyricsCache.delete(trackKey);
    }

    currentTrackKey = trackKey;
    activeLineIndex = -1;
    userScrolled = false;

    // Immediately hide the resume sync button on song transition
    const resumeBtn = document.getElementById('lyris-resume-btn') || document.getElementById('am-resume-scroll-btn');
    if (resumeBtn) {
      resumeBtn.hidden = true;
      resumeBtn.classList.remove('visible');
    }

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
        const resumeBtn = document.getElementById('lyris-resume-btn') || document.getElementById('am-resume-scroll-btn');
        if (resumeBtn) {
          resumeBtn.hidden = true;
          resumeBtn.classList.remove('visible');
        }
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
    if (settings.lyricsEnabled === false || settings.appleMode === false) {
      return false;
    }

    const nativeLyricsTab = getNativeLyricsTab();
    if (!nativeLyricsTab) return false;

    const parentTabs = nativeLyricsTab.closest('tp-yt-paper-tabs') ||
                       document.querySelector('ytmusic-player-page #side-panel tp-yt-paper-tabs') ||
                       document.querySelector('#side-panel tp-yt-paper-tabs') ||
                       document.querySelector('tp-yt-paper-tabs');
    if (parentTabs) {
      const tabs = Array.from(parentTabs.querySelectorAll('tp-yt-paper-tab'));
      const lyricsIndex = tabs.indexOf(nativeLyricsTab);

      // 1. If ANY other tab is selected, lyrics tab is NOT selected
      const anotherTabSelected = tabs.some(t => {
        if (t === nativeLyricsTab) return false;
        return t.classList.contains('iron-selected') || t.getAttribute('aria-selected') === 'true';
      });
      if (anotherTabSelected) {
        return false;
      }

      // 2. Check Polymer parentTabs.selected
      if (parentTabs.selected !== undefined && parentTabs.selected !== null) {
        const selIdx = parseInt(parentTabs.selected, 10);
        if (!isNaN(selIdx) && lyricsIndex !== -1) {
          return selIdx === lyricsIndex;
        }
        const selStr = String(parentTabs.selected).toLowerCase();
        if (selStr.includes('lyrics')) return true;
        if (selStr.includes('up_next') || selStr.includes('queue') || selStr.includes('comments') || selStr.includes('related')) {
          return false;
        }
      }

      // 3. Fallback: check lyricsTab itself
      if (nativeLyricsTab.classList.contains('iron-selected') ||
          nativeLyricsTab.getAttribute('aria-selected') === 'true') {
        return true;
      }
    }

    return false;
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
              if (isLyricsTabSelected()) {
                activateLyricsTab();
                renderCurrentLyricsState();
                scrollToActiveLine(true);
              }
            } else {
              const ambientWrap = document.getElementById('am-player-ambient-wrapper');
              if (ambientWrap) ambientWrap.style.display = 'none';
            }
          }
        }
      });
      pageObserver.observe(playerPage, { attributes: true, attributeFilter: ['player-ui-state'] });
    }

    // 2. Window resize watcher to adjust lyrics pane geometry below tabs
    window.addEventListener('resize', () => {
      updateLyricsPaneGeometry();
    }, { passive: true });

    // 3. Main 500ms consistency watcher
    setInterval(() => {
      forceEnableNativeLyricsTab();
      hideNativeLyricsUnavailableMessage();
      bindVideoEvents();

      const isSelected = isLyricsTabSelected();
      const wrapper = document.getElementById('lyris-lyrics-wrapper') || document.getElementById('am-lyrics-wrapper');

      if (isSelected) {
        if (!wrapper || !wrapper.isConnected) {
          injectLyricsWrapper();
        }
        if (wrapper && wrapper.hidden) {
          activateLyricsTab();
        }
        const list = document.getElementById('lyris-list') || document.getElementById('am-lyrics-list');
        if (!list || !list.children.length) {
          renderCurrentLyricsState();
        }
      } else {
        if (wrapper && (!wrapper.hidden || wrapper.style.display !== 'none')) {
          deactivateCustomLyricsTab();
        }
      }

      const track = getCurrentTrackInfo();
      const key = `${track.cleanTitle}__${track.cleanArtist}`.toLowerCase();
      if (key && key !== currentTrackKey) {
        loadLyricsForCurrentTrack();
        if (isSelected) {
          setTimeout(() => {
            activateLyricsTab();
            renderCurrentLyricsState();
          }, 100);
        }
      }

      ambientEngine.injectContainers();
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
    console.log('[Lyris] Lyrics in the light — ambient light & synced lyrics initialized.');
  }

  // Test-only hook: lets the Node test suite (tests/) reach pure helpers inside this IIFE.
  // The global is never defined on music.youtube.com, so this is a no-op in production.
  if (typeof globalThis.__LYRIS_TEST_HOOK__ === 'function') {
    globalThis.__LYRIS_TEST_HOOK__({
      parseLRC, tokenizeLineText, computeWordTimings, kanaToRomaji, textToHiragana,
      hiraganaToKatakana, katakanaToHiragana, convertJapaneseLine, addFurigana,
      containsJapanese, escapeHTML, decomposeTrackInfo, DEFAULT_SETTINGS
    });
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
