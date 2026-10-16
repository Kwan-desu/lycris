/**
 * Lyris — Popup Script v1.0
 * Lyrics in the light
 */

const DEFAULT_SETTINGS = {
  // Ambient Light
  ambientEnabled: true,
  ambientBlur: 70,
  ambientSpread: 42,
  ambientFadeDuration: 0.15,
  ambientBrightness: 95,
  ambientSaturation: 120,

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
  appleMode: true,
  lineHighlight: true,
  wordHighlight: true,
  highlightStyle: 'apple-glow',
  japaneseMode: 'furigana', // 'furigana' | 'original' | 'romaji' | 'hiragana' | 'katakana'
  showOriginal: false,
  furiganaEnabled: true,
  translationEnabled: false,
  backdropDimmer: true,
  fontSize: 40,
  clickToSeek: true,
  syncOffset: 0,
  trackOffsets: {}
};

const PROVIDER_LABELS = {
  'lrclib': 'LRCLIB (Western & Global)',
  'netease': 'Netease (Japanese, Anime, Asian)',
  'kugou': 'Kugou (International & Asian)',
  'qq': 'QQ Music (Off by default — opt-in)',
  'youtube-cc': 'YouTube Captions (CC)',
  'native': 'YouTube Music Native Lyrics'
};

document.addEventListener('DOMContentLoaded', () => {
  let settings = { ...DEFAULT_SETTINGS };

  // Tab switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      tabContents.forEach(c => {
        c.classList.toggle('active', c.id === `tab-${target}`);
      });
    });
  });

  // UI Elements - Lyrics
  const lyricsEnabledToggle = document.getElementById('lyricsEnabled');
  const japaneseModeSelect = document.getElementById('japaneseMode');
  const showOriginalToggle = document.getElementById('showOriginal');
  const fontSizeSlider = document.getElementById('fontSize');
  const fontSizeVal = document.getElementById('fontSizeVal');
  const wordHighlightToggle = document.getElementById('wordHighlight');
  const clickToSeekToggle = document.getElementById('clickToSeek');
  const translationEnabledToggle = document.getElementById('translationEnabled');
  const syncOffsetSlider = document.getElementById('syncOffset');
  const syncOffsetVal = document.getElementById('syncOffsetVal');

  const btnOffsetMinus = document.getElementById('btn-offset-minus');
  const btnOffsetReset = document.getElementById('btn-offset-reset');
  const btnOffsetPlus = document.getElementById('btn-offset-plus');

  // UI Elements - Light
  const ambientEnabledToggle = document.getElementById('ambientEnabled');
  const ambientBrightnessSlider = document.getElementById('ambientBrightness');
  const ambientBrightnessVal = document.getElementById('ambientBrightnessVal');
  const ambientBlurSlider = document.getElementById('ambientBlur');
  const ambientBlurVal = document.getElementById('ambientBlurVal');
  const ambientSpreadSlider = document.getElementById('ambientSpread');
  const ambientSpreadVal = document.getElementById('ambientSpreadVal');
  const ambientFadeSlider = document.getElementById('ambientFade');
  const ambientFadeVal = document.getElementById('ambientFadeVal');
  const ambientSaturationSlider = document.getElementById('ambientSaturation');
  const ambientSaturationVal = document.getElementById('ambientSaturationVal');

  // UI Elements - Providers
  const providerListContainer = document.getElementById('provider-list');

  // Resets
  const btnResetLyrics = document.getElementById('btn-reset-lyrics');
  const btnResetAmbient = document.getElementById('btn-reset-ambient');
  const btnResetSources = document.getElementById('btn-reset-sources');
  const btnResetAll = document.getElementById('btn-reset-all');

  // Track status
  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');
  const trackBadge = document.getElementById('track-badge');
  const trackBadgeDot = document.getElementById('track-badge-dot');
  const trackBadgeText = document.getElementById('track-badge-text');

  // Load Settings from storage
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    if (stored) {
      settings = { ...DEFAULT_SETTINGS, ...stored };
      updateUI();
    }
  });

  // Listen for storage changes from in-page settings
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (let key in changes) {
          settings[key] = changes[key].newValue;
        }
        updateUI();
      }
    });
  }

  const _saveTimers = {};
  function save(key, val, debounceMs = 0) {
    settings[key] = val;
    const persist = () => {
      chrome.storage.sync.set({ [key]: val });
    };
    if (debounceMs > 0) {
      clearTimeout(_saveTimers[key]);
      _saveTimers[key] = setTimeout(persist, debounceMs);
    } else {
      persist();
    }
  }

  function updateUI() {
    // Lyrics
    lyricsEnabledToggle.checked = settings.lyricsEnabled !== false;
    japaneseModeSelect.value = settings.japaneseMode || (settings.furiganaEnabled ? 'furigana' : 'original');
    showOriginalToggle.checked = settings.showOriginal !== false;
    fontSizeSlider.value = settings.fontSize || 40;
    fontSizeVal.textContent = `${settings.fontSize || 40}px`;
    wordHighlightToggle.checked = settings.wordHighlight !== false;
    clickToSeekToggle.checked = settings.clickToSeek !== false;
    translationEnabledToggle.checked = !!settings.translationEnabled;

    const offset = settings.syncOffset || 0;
    syncOffsetSlider.value = offset;
    syncOffsetVal.textContent = `${(offset / 1000).toFixed(1)}s`;

    // Light
    ambientEnabledToggle.checked = settings.ambientEnabled !== false;
    const brightness = (typeof settings.ambientBrightness === 'number') ? settings.ambientBrightness : (settings.ambientIntensity ?? 95);
    ambientBrightnessSlider.value = brightness;
    ambientBrightnessVal.textContent = `${brightness}%`;

    const blur = (typeof settings.ambientBlur === 'number') ? settings.ambientBlur : 70;
    ambientBlurSlider.value = blur;
    ambientBlurVal.textContent = `${blur}px`;

    const spread = (typeof settings.ambientSpread === 'number') ? settings.ambientSpread : 42;
    ambientSpreadSlider.value = spread;
    ambientSpreadVal.textContent = `${spread}%`;

    const fade = (typeof settings.ambientFadeDuration === 'number') ? settings.ambientFadeDuration : 0.15;
    ambientFadeSlider.value = fade;
    ambientFadeVal.textContent = fade === 0 ? 'Off' : `${Number(fade).toFixed(2)}s`;

    const sat = (typeof settings.ambientSaturation === 'number') ? settings.ambientSaturation : 120;
    ambientSaturationSlider.value = sat;
    ambientSaturationVal.textContent = `${sat}%`;

    renderProviders();
  }

  function renderProviders() {
    providerListContainer.innerHTML = '';
    const order = settings.providerOrder ? [...settings.providerOrder] : [...DEFAULT_SETTINGS.providerOrder];
    const enabled = settings.enabledProviders ? { ...settings.enabledProviders } : { ...DEFAULT_SETTINGS.enabledProviders };

    order.forEach((id, index) => {
      const item = document.createElement('div');
      item.className = 'provider-item';

      const info = document.createElement('div');
      info.className = 'provider-info';

      const check = document.createElement('input');
      check.type = 'checkbox';
      // QQ runs only when explicitly enabled (background.js requires qq === true);
      // all other providers are on unless explicitly disabled.
      check.checked = id === 'qq' ? (enabled.qq === true) : (enabled[id] !== false);
      check.addEventListener('change', () => {
        enabled[id] = check.checked;
        settings.enabledProviders = enabled;
        save('enabledProviders', settings.enabledProviders);
      });

      const label = document.createElement('span');
      label.textContent = PROVIDER_LABELS[id] || id;

      info.appendChild(check);
      info.appendChild(label);

      const arrows = document.createElement('div');
      arrows.className = 'provider-arrows';

      const btnUp = document.createElement('button');
      btnUp.className = 'btn-arrow';
      btnUp.innerHTML = '▲';
      btnUp.title = 'Move Up';
      btnUp.disabled = index === 0;
      btnUp.addEventListener('click', () => {
        if (index > 0) {
          const temp = order[index];
          order[index] = order[index - 1];
          order[index - 1] = temp;
          settings.providerOrder = [...order];
          save('providerOrder', settings.providerOrder);
          renderProviders();
        }
      });

      const btnDown = document.createElement('button');
      btnDown.className = 'btn-arrow';
      btnDown.innerHTML = '▼';
      btnDown.title = 'Move Down';
      btnDown.disabled = index === order.length - 1;
      btnDown.addEventListener('click', () => {
        if (index < order.length - 1) {
          const temp = order[index];
          order[index] = order[index + 1];
          order[index + 1] = temp;
          settings.providerOrder = [...order];
          save('providerOrder', settings.providerOrder);
          renderProviders();
        }
      });

      arrows.appendChild(btnUp);
      arrows.appendChild(btnDown);

      item.appendChild(info);
      item.appendChild(arrows);
      providerListContainer.appendChild(item);
    });
  }

  // Event Listeners - Lyrics
  lyricsEnabledToggle.addEventListener('change', () => {
    save('lyricsEnabled', lyricsEnabledToggle.checked);
    save('appleMode', lyricsEnabledToggle.checked);
  });

  japaneseModeSelect.addEventListener('change', () => {
    const val = japaneseModeSelect.value;
    save('japaneseMode', val);
    save('furiganaEnabled', val === 'furigana');
  });

  showOriginalToggle.addEventListener('change', () => {
    save('showOriginal', showOriginalToggle.checked);
  });

  fontSizeSlider.addEventListener('input', () => {
    const val = parseInt(fontSizeSlider.value, 10);
    fontSizeVal.textContent = `${val}px`;
    save('fontSize', val, 250);
  });
  fontSizeSlider.addEventListener('change', () => {
    const val = parseInt(fontSizeSlider.value, 10);
    save('fontSize', val, 0);
  });

  wordHighlightToggle.addEventListener('change', () => {
    save('wordHighlight', wordHighlightToggle.checked);
  });

  clickToSeekToggle.addEventListener('change', () => {
    save('clickToSeek', clickToSeekToggle.checked);
  });

  translationEnabledToggle.addEventListener('change', () => {
    save('translationEnabled', translationEnabledToggle.checked);
  });

  syncOffsetSlider.addEventListener('input', () => {
    const val = parseInt(syncOffsetSlider.value, 10);
    syncOffsetVal.textContent = `${(val / 1000).toFixed(1)}s`;
    save('syncOffset', val, 250);
  });
  syncOffsetSlider.addEventListener('change', () => {
    const val = parseInt(syncOffsetSlider.value, 10);
    save('syncOffset', val, 0);
  });

  btnOffsetMinus.addEventListener('click', () => {
    let cur = parseInt(syncOffsetSlider.value, 10) - 100;
    if (cur < -2500) cur = -2500;
    syncOffsetSlider.value = cur;
    syncOffsetVal.textContent = `${(cur / 1000).toFixed(1)}s`;
    save('syncOffset', cur);
  });

  btnOffsetPlus.addEventListener('click', () => {
    let cur = parseInt(syncOffsetSlider.value, 10) + 100;
    if (cur > 2500) cur = 2500;
    syncOffsetSlider.value = cur;
    syncOffsetVal.textContent = `${(cur / 1000).toFixed(1)}s`;
    save('syncOffset', cur);
  });

  btnOffsetReset.addEventListener('click', () => {
    syncOffsetSlider.value = 0;
    syncOffsetVal.textContent = '0.0s';
    save('syncOffset', 0);
  });

  // Event Listeners - Light
  ambientEnabledToggle.addEventListener('change', () => {
    save('ambientEnabled', ambientEnabledToggle.checked);
  });

  ambientBrightnessSlider.addEventListener('input', () => {
    const val = parseInt(ambientBrightnessSlider.value, 10);
    ambientBrightnessVal.textContent = `${val}%`;
    save('ambientBrightness', val, 250);
  });
  ambientBrightnessSlider.addEventListener('change', () => {
    const val = parseInt(ambientBrightnessSlider.value, 10);
    save('ambientBrightness', val, 0);
  });

  ambientBlurSlider.addEventListener('input', () => {
    const val = parseInt(ambientBlurSlider.value, 10);
    ambientBlurVal.textContent = `${val}px`;
    save('ambientBlur', val, 250);
  });
  ambientBlurSlider.addEventListener('change', () => {
    const val = parseInt(ambientBlurSlider.value, 10);
    save('ambientBlur', val, 0);
  });

  ambientSpreadSlider.addEventListener('input', () => {
    const val = parseInt(ambientSpreadSlider.value, 10);
    ambientSpreadVal.textContent = `${val}%`;
    save('ambientSpread', val, 250);
  });
  ambientSpreadSlider.addEventListener('change', () => {
    const val = parseInt(ambientSpreadSlider.value, 10);
    save('ambientSpread', val, 0);
  });

  ambientFadeSlider.addEventListener('input', () => {
    const val = parseFloat(ambientFadeSlider.value);
    ambientFadeVal.textContent = val === 0 ? 'Off' : `${val.toFixed(2)}s`;
    save('ambientFadeDuration', val, 250);
  });
  ambientFadeSlider.addEventListener('change', () => {
    const val = parseFloat(ambientFadeSlider.value);
    save('ambientFadeDuration', val, 0);
  });

  ambientSaturationSlider.addEventListener('input', () => {
    const val = parseInt(ambientSaturationSlider.value, 10);
    ambientSaturationVal.textContent = `${val}%`;
    save('ambientSaturation', val, 250);
  });
  ambientSaturationSlider.addEventListener('change', () => {
    const val = parseInt(ambientSaturationSlider.value, 10);
    save('ambientSaturation', val, 0);
  });

  // Section Resets
  btnResetLyrics.addEventListener('click', () => {
    settings.lyricsEnabled = DEFAULT_SETTINGS.lyricsEnabled;
    settings.appleMode = DEFAULT_SETTINGS.appleMode;
    settings.japaneseMode = DEFAULT_SETTINGS.japaneseMode;
    settings.showOriginal = DEFAULT_SETTINGS.showOriginal;
    settings.furiganaEnabled = DEFAULT_SETTINGS.furiganaEnabled;
    settings.fontSize = DEFAULT_SETTINGS.fontSize;
    settings.wordHighlight = DEFAULT_SETTINGS.wordHighlight;
    settings.clickToSeek = DEFAULT_SETTINGS.clickToSeek;
    settings.translationEnabled = DEFAULT_SETTINGS.translationEnabled;
    settings.backdropDimmer = DEFAULT_SETTINGS.backdropDimmer;
    settings.syncOffset = DEFAULT_SETTINGS.syncOffset;

    chrome.storage.sync.set({
      lyricsEnabled: settings.lyricsEnabled,
      appleMode: settings.appleMode,
      japaneseMode: settings.japaneseMode,
      showOriginal: settings.showOriginal,
      furiganaEnabled: settings.furiganaEnabled,
      fontSize: settings.fontSize,
      wordHighlight: settings.wordHighlight,
      clickToSeek: settings.clickToSeek,
      translationEnabled: settings.translationEnabled,
      backdropDimmer: settings.backdropDimmer,
      syncOffset: settings.syncOffset
    }, updateUI);
  });

  btnResetAmbient.addEventListener('click', () => {
    settings.ambientEnabled = DEFAULT_SETTINGS.ambientEnabled;
    settings.ambientBrightness = DEFAULT_SETTINGS.ambientBrightness;
    settings.ambientBlur = DEFAULT_SETTINGS.ambientBlur;
    settings.ambientSpread = DEFAULT_SETTINGS.ambientSpread;
    settings.ambientFadeDuration = DEFAULT_SETTINGS.ambientFadeDuration;
    settings.ambientSaturation = DEFAULT_SETTINGS.ambientSaturation;

    chrome.storage.sync.set({
      ambientEnabled: settings.ambientEnabled,
      ambientBrightness: settings.ambientBrightness,
      ambientBlur: settings.ambientBlur,
      ambientSpread: settings.ambientSpread,
      ambientFadeDuration: settings.ambientFadeDuration,
      ambientSaturation: settings.ambientSaturation
    }, updateUI);
  });

  btnResetSources.addEventListener('click', () => {
    settings.providerOrder = [...DEFAULT_SETTINGS.providerOrder];
    settings.enabledProviders = { ...DEFAULT_SETTINGS.enabledProviders };

    chrome.storage.sync.set({
      providerOrder: settings.providerOrder,
      enabledProviders: settings.enabledProviders
    }, updateUI);
  });

  btnResetAll.addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    chrome.storage.sync.set(DEFAULT_SETTINGS, updateUI);
  });

  // Query Current Track Info from YouTube Music tab
  function updateTrackCard() {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_STATUS' }, (res) => {
          if (chrome.runtime.lastError || !res) return;
          const track = res.trackInfo || res.track;
          if (track && track.title) {
            trackTitle.textContent = track.title;
            trackArtist.textContent = track.artist || 'Unknown Artist';
            trackBadge.classList.add('active');
            const isSynced = res.isSynced || (res.currentLyrics && res.currentLyrics.isSynced);
            trackBadgeText.textContent = isSynced ? 'Synced' : 'Active';
          }
        });
      }
    });
  }
  updateTrackCard();
});
