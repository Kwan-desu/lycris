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
      applySettingsToUI();
    }
  });

  // Listen for storage changes from in-page settings
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (let key in changes) {
          settings[key] = changes[key].newValue !== undefined ? changes[key].newValue : DEFAULT_SETTINGS[key];
        }
        applySettingsToUI();
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

  function saveSettings(obj) {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(key => {
      save(key, obj[key]);
    });
  }

  function applySettingsToUI() {
    const highlightSelect = document.getElementById('highlightStyle');
    if (highlightSelect) highlightSelect.value = settings.highlightStyle || 'apple-glow';

    // Lyrics
    if (lyricsEnabledToggle) lyricsEnabledToggle.checked = settings.lyricsEnabled !== false;
    if (japaneseModeSelect) japaneseModeSelect.value = settings.japaneseMode || (settings.furiganaEnabled ? 'furigana' : 'original');
    if (showOriginalToggle) showOriginalToggle.checked = settings.showOriginal !== false;
    if (fontSizeSlider) fontSizeSlider.value = settings.fontSize || 40;
    if (fontSizeVal) fontSizeVal.textContent = `${settings.fontSize || 40}px`;
    if (wordHighlightToggle) wordHighlightToggle.checked = settings.wordHighlight !== false;
    if (clickToSeekToggle) clickToSeekToggle.checked = settings.clickToSeek !== false;
    if (translationEnabledToggle) translationEnabledToggle.checked = !!settings.translationEnabled;

    const offset = settings.syncOffset || 0;
    if (syncOffsetSlider) syncOffsetSlider.value = offset;
    if (syncOffsetVal) syncOffsetVal.textContent = `${(offset / 1000).toFixed(1)}s`;

    // Light
    if (ambientEnabledToggle) ambientEnabledToggle.checked = settings.ambientEnabled !== false;
    const brightness = (typeof settings.ambientBrightness === 'number') ? settings.ambientBrightness : (settings.ambientIntensity ?? 95);
    if (ambientBrightnessSlider) ambientBrightnessSlider.value = brightness;
    if (ambientBrightnessVal) ambientBrightnessVal.textContent = `${brightness}%`;

    const blur = (typeof settings.ambientBlur === 'number') ? settings.ambientBlur : 70;
    if (ambientBlurSlider) ambientBlurSlider.value = blur;
    if (ambientBlurVal) ambientBlurVal.textContent = `${blur}px`;

    const spread = (typeof settings.ambientSpread === 'number') ? settings.ambientSpread : 42;
    if (ambientSpreadSlider) ambientSpreadSlider.value = spread;
    if (ambientSpreadVal) ambientSpreadVal.textContent = `${spread}%`;

    const fade = (typeof settings.ambientFadeDuration === 'number') ? settings.ambientFadeDuration : 0.15;
    if (ambientFadeSlider) ambientFadeSlider.value = fade;
    if (ambientFadeVal) ambientFadeVal.textContent = fade === 0 ? 'Off' : `${Number(fade).toFixed(2)}s`;

    const sat = (typeof settings.ambientSaturation === 'number') ? settings.ambientSaturation : 120;
    if (ambientSaturationSlider) ambientSaturationSlider.value = sat;
    if (ambientSaturationVal) ambientSaturationVal.textContent = `${sat}%`;

    renderProviders();
  }

  const updateUI = applySettingsToUI;

  function renderProviders() {
    if (!providerListContainer) return;
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
  if (lyricsEnabledToggle) {
    lyricsEnabledToggle.addEventListener('change', () => {
      save('lyricsEnabled', lyricsEnabledToggle.checked);
      save('appleMode', lyricsEnabledToggle.checked);
    });
  }

  if (japaneseModeSelect) {
    japaneseModeSelect.addEventListener('change', () => {
      const val = japaneseModeSelect.value;
      save('japaneseMode', val);
      save('furiganaEnabled', val === 'furigana');
    });
  }

  if (showOriginalToggle) {
    showOriginalToggle.addEventListener('change', () => {
      save('showOriginal', showOriginalToggle.checked);
    });
  }

  if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', () => {
      const val = parseInt(fontSizeSlider.value, 10);
      if (fontSizeVal) fontSizeVal.textContent = `${val}px`;
      save('fontSize', val, 250);
    });
    fontSizeSlider.addEventListener('change', () => {
      const val = parseInt(fontSizeSlider.value, 10);
      save('fontSize', val, 0);
    });
  }

  if (wordHighlightToggle) {
    wordHighlightToggle.addEventListener('change', () => {
      save('wordHighlight', wordHighlightToggle.checked);
    });
  }

  const highlightSelect = document.getElementById('highlightStyle');
  if (highlightSelect) {
    highlightSelect.addEventListener('change', (e) => {
      saveSettings({ highlightStyle: e.target.value });
    });
  }

  if (clickToSeekToggle) {
    clickToSeekToggle.addEventListener('change', () => {
      save('clickToSeek', clickToSeekToggle.checked);
    });
  }

  if (translationEnabledToggle) {
    translationEnabledToggle.addEventListener('change', () => {
      save('translationEnabled', translationEnabledToggle.checked);
    });
  }

  if (syncOffsetSlider) {
    syncOffsetSlider.addEventListener('input', () => {
      const val = parseInt(syncOffsetSlider.value, 10);
      if (syncOffsetVal) syncOffsetVal.textContent = `${(val / 1000).toFixed(1)}s`;
      save('syncOffset', val, 250);
    });
    syncOffsetSlider.addEventListener('change', () => {
      const val = parseInt(syncOffsetSlider.value, 10);
      save('syncOffset', val, 0);
    });
  }

  if (btnOffsetMinus) {
    btnOffsetMinus.addEventListener('click', () => {
      let cur = parseInt(syncOffsetSlider ? syncOffsetSlider.value : 0, 10) - 100;
      if (cur < -2500) cur = -2500;
      if (syncOffsetSlider) syncOffsetSlider.value = cur;
      if (syncOffsetVal) syncOffsetVal.textContent = `${(cur / 1000).toFixed(1)}s`;
      save('syncOffset', cur);
    });
  }

  if (btnOffsetPlus) {
    btnOffsetPlus.addEventListener('click', () => {
      let cur = parseInt(syncOffsetSlider ? syncOffsetSlider.value : 0, 10) + 100;
      if (cur > 2500) cur = 2500;
      if (syncOffsetSlider) syncOffsetSlider.value = cur;
      if (syncOffsetVal) syncOffsetVal.textContent = `${(cur / 1000).toFixed(1)}s`;
      save('syncOffset', cur);
    });
  }

  if (btnOffsetReset) {
    btnOffsetReset.addEventListener('click', () => {
      if (syncOffsetSlider) syncOffsetSlider.value = 0;
      if (syncOffsetVal) syncOffsetVal.textContent = '0.0s';
      save('syncOffset', 0);
    });
  }

  // Event Listeners - Light
  if (ambientEnabledToggle) {
    ambientEnabledToggle.addEventListener('change', () => {
      save('ambientEnabled', ambientEnabledToggle.checked);
    });
  }

  if (ambientBrightnessSlider) {
    ambientBrightnessSlider.addEventListener('input', () => {
      const val = parseInt(ambientBrightnessSlider.value, 10);
      if (ambientBrightnessVal) ambientBrightnessVal.textContent = `${val}%`;
      save('ambientBrightness', val, 250);
    });
    ambientBrightnessSlider.addEventListener('change', () => {
      const val = parseInt(ambientBrightnessSlider.value, 10);
      save('ambientBrightness', val, 0);
    });
  }

  if (ambientBlurSlider) {
    ambientBlurSlider.addEventListener('input', () => {
      const val = parseInt(ambientBlurSlider.value, 10);
      if (ambientBlurVal) ambientBlurVal.textContent = `${val}px`;
      save('ambientBlur', val, 250);
    });
    ambientBlurSlider.addEventListener('change', () => {
      const val = parseInt(ambientBlurSlider.value, 10);
      save('ambientBlur', val, 0);
    });
  }

  if (ambientSpreadSlider) {
    ambientSpreadSlider.addEventListener('input', () => {
      const val = parseInt(ambientSpreadSlider.value, 10);
      if (ambientSpreadVal) ambientSpreadVal.textContent = `${val}%`;
      save('ambientSpread', val, 250);
    });
    ambientSpreadSlider.addEventListener('change', () => {
      const val = parseInt(ambientSpreadSlider.value, 10);
      save('ambientSpread', val, 0);
    });
  }

  if (ambientFadeSlider) {
    ambientFadeSlider.addEventListener('input', () => {
      const val = parseFloat(ambientFadeSlider.value);
      if (ambientFadeVal) ambientFadeVal.textContent = val === 0 ? 'Off' : `${val.toFixed(2)}s`;
      save('ambientFadeDuration', val, 250);
    });
    ambientFadeSlider.addEventListener('change', () => {
      const val = parseFloat(ambientFadeSlider.value);
      save('ambientFadeDuration', val, 0);
    });
  }

  if (ambientSaturationSlider) {
    ambientSaturationSlider.addEventListener('input', () => {
      const val = parseInt(ambientSaturationSlider.value, 10);
      if (ambientSaturationVal) ambientSaturationVal.textContent = `${val}%`;
      save('ambientSaturation', val, 250);
    });
    ambientSaturationSlider.addEventListener('change', () => {
      const val = parseInt(ambientSaturationSlider.value, 10);
      save('ambientSaturation', val, 0);
    });
  }

  // Section Resets
  if (btnResetLyrics) {
    btnResetLyrics.addEventListener('click', () => {
      settings.lyricsEnabled = DEFAULT_SETTINGS.lyricsEnabled;
      settings.appleMode = DEFAULT_SETTINGS.appleMode;
      settings.highlightStyle = DEFAULT_SETTINGS.highlightStyle;
      settings.japaneseMode = DEFAULT_SETTINGS.japaneseMode;
      settings.showOriginal = DEFAULT_SETTINGS.showOriginal;
      settings.furiganaEnabled = DEFAULT_SETTINGS.furiganaEnabled;
      settings.fontSize = DEFAULT_SETTINGS.fontSize;
      settings.wordHighlight = DEFAULT_SETTINGS.wordHighlight;
      settings.clickToSeek = DEFAULT_SETTINGS.clickToSeek;
      settings.translationEnabled = DEFAULT_SETTINGS.translationEnabled;
      settings.syncOffset = DEFAULT_SETTINGS.syncOffset;

      chrome.storage.sync.set({
        lyricsEnabled: settings.lyricsEnabled,
        appleMode: settings.appleMode,
        highlightStyle: settings.highlightStyle,
        japaneseMode: settings.japaneseMode,
        showOriginal: settings.showOriginal,
        furiganaEnabled: settings.furiganaEnabled,
        fontSize: settings.fontSize,
        wordHighlight: settings.wordHighlight,
        clickToSeek: settings.clickToSeek,
        translationEnabled: settings.translationEnabled,
        syncOffset: settings.syncOffset
      }, applySettingsToUI);
    });
  }

  if (btnResetAmbient) {
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
      }, applySettingsToUI);
    });
  }

  if (btnResetSources) {
    btnResetSources.addEventListener('click', () => {
      settings.providerOrder = [...DEFAULT_SETTINGS.providerOrder];
      settings.enabledProviders = { ...DEFAULT_SETTINGS.enabledProviders };

      chrome.storage.sync.set({
        providerOrder: settings.providerOrder,
        enabledProviders: settings.enabledProviders
      }, applySettingsToUI);
    });
  }

  if (btnResetAll) {
    btnResetAll.addEventListener('click', () => {
      settings = { ...DEFAULT_SETTINGS };
      chrome.storage.sync.set(DEFAULT_SETTINGS, applySettingsToUI);
    });
  }

  // Query Current Track Info from YouTube Music tab
  function updateTrackCard() {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_STATUS' }, (res) => {
          if (chrome.runtime.lastError || !res) return;
          const track = res.trackInfo || res.track;
          if (track && track.title) {
            if (trackTitle) trackTitle.textContent = track.title;
            if (trackArtist) trackArtist.textContent = track.artist || 'Unknown Artist';
            if (trackBadge) trackBadge.classList.add('active');
            const isSynced = res.isSynced || (res.currentLyrics && res.currentLyrics.isSynced);
            if (trackBadgeText) trackBadgeText.textContent = isSynced ? 'Synced' : 'Active';
          }
        });
      }
    });
  }
  updateTrackCard();
});
