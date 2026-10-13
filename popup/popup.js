/**
 * Ambient Light & Synced Lyrics Popup Script v1.0
 */

const DEFAULT_SETTINGS = {
  ambientEnabled: true,
  ambientBlur: 70,
  ambientSpread: 42,
  ambientFadeDuration: 0,
  ambientBrightness: 95,
  ambientSaturation: 120,

  providerOrder: ['lrclib', 'netease', 'kugou', 'qq', 'youtube-cc', 'native'],
  enabledProviders: {
    'lrclib': true,
    'netease': true,
    'kugou': true,
    'qq': true,
    'youtube-cc': true,
    'native': true
  },

  lyricsEnabled: true,
  appleMode: true,
  lineHighlight: true,
  wordHighlight: true,
  highlightStyle: 'apple-glow',
  furiganaEnabled: true,
  translationEnabled: false,
  fontSize: 26,
  clickToSeek: true,
  syncOffset: 0,
  trackOffsets: {}
};

const PROVIDER_LABELS = {
  'lrclib': 'LRCLIB (Western & Global)',
  'netease': 'Netease (Japanese, Anime, Asian)',
  'kugou': 'Kugou (International & Asian)',
  'qq': 'QQ Music (International & Asian)',
  'youtube-cc': 'YouTube Captions (CC)',
  'native': 'YouTube Music Native Lyrics'
};

document.addEventListener('DOMContentLoaded', () => {
  let settings = { ...DEFAULT_SETTINGS };

  // Elements
  const ambientEnabledToggle = document.getElementById('ambientEnabled');
  const ambientBlurSlider = document.getElementById('ambientBlur');
  const ambientBlurVal = document.getElementById('ambientBlurVal');
  const ambientSpreadSlider = document.getElementById('ambientSpread');
  const ambientSpreadVal = document.getElementById('ambientSpreadVal');
  const ambientFadeSlider = document.getElementById('ambientFade');
  const ambientFadeVal = document.getElementById('ambientFadeVal');
  const ambientBrightnessSlider = document.getElementById('ambientBrightness');
  const ambientBrightnessVal = document.getElementById('ambientBrightnessVal');
  const ambientSaturationSlider = document.getElementById('ambientSaturation');
  const ambientSaturationVal = document.getElementById('ambientSaturationVal');

  const lyricsEnabledToggle = document.getElementById('lyricsEnabled');
  const lineHighlightToggle = document.getElementById('lineHighlight');
  const wordHighlightToggle = document.getElementById('wordHighlight');
  const highlightStyleSelect = document.getElementById('highlightStyle');
  const clickToSeekToggle = document.getElementById('clickToSeek');
  const furiganaEnabledToggle = document.getElementById('furiganaEnabled');
  const translationEnabledToggle = document.getElementById('translationEnabled');
  const fontSizeSlider = document.getElementById('fontSize');
  const fontSizeVal = document.getElementById('fontSizeVal');
  const syncOffsetSlider = document.getElementById('syncOffset');
  const syncOffsetVal = document.getElementById('syncOffsetVal');

  const btnOffsetMinus = document.getElementById('btn-offset-minus');
  const btnOffsetReset = document.getElementById('btn-offset-reset');
  const btnOffsetPlus = document.getElementById('btn-offset-plus');

  const btnResetAmbient = document.getElementById('btn-reset-ambient');
  const btnResetProviders = document.getElementById('btn-reset-providers');
  const btnResetLyrics = document.getElementById('btn-reset-lyrics');
  const btnResetAll = document.getElementById('btn-reset-all');

  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');
  const trackBadge = document.getElementById('track-badge');
  const trackBadgeText = document.getElementById('track-badge-text');

  // Load Settings
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    settings = { ...DEFAULT_SETTINGS, ...stored };
    updateUI();
  });

  function save(key, val) {
    settings[key] = val;
    chrome.storage.sync.set({ [key]: val });
  }

  function updateUI() {
    ambientEnabledToggle.checked = settings.ambientEnabled;
    ambientBlurSlider.value = settings.ambientBlur;
    ambientBlurVal.textContent = `${settings.ambientBlur}%`;

    ambientSpreadSlider.value = settings.ambientSpread;
    ambientSpreadVal.textContent = `${settings.ambientSpread}%`;

    ambientFadeSlider.value = settings.ambientFadeDuration;
    ambientFadeVal.textContent = settings.ambientFadeDuration > 0 ? `${settings.ambientFadeDuration.toFixed(1)}s` : 'Off';

    ambientBrightnessSlider.value = settings.ambientBrightness;
    ambientBrightnessVal.textContent = `${settings.ambientBrightness}%`;

    ambientSaturationSlider.value = settings.ambientSaturation;
    ambientSaturationVal.textContent = `${settings.ambientSaturation}%`;

    if (lyricsEnabledToggle) {
      lyricsEnabledToggle.checked = (settings.lyricsEnabled !== false) && (settings.appleMode !== false);
    }
    if (lineHighlightToggle) {
      lineHighlightToggle.checked = settings.lineHighlight !== false;
    }
    if (wordHighlightToggle) {
      wordHighlightToggle.checked = settings.wordHighlight !== false;
    }
    if (highlightStyleSelect) {
      highlightStyleSelect.value = settings.highlightStyle || 'apple-glow';
    }
    clickToSeekToggle.checked = settings.clickToSeek;
    if (furiganaEnabledToggle) {
      furiganaEnabledToggle.checked = settings.furiganaEnabled !== false;
    }
    if (translationEnabledToggle) {
      translationEnabledToggle.checked = Boolean(settings.translationEnabled);
    }
    fontSizeSlider.value = settings.fontSize;
    fontSizeVal.textContent = `${settings.fontSize}px`;

    syncOffsetSlider.value = settings.syncOffset;
    const ms = settings.syncOffset;
    syncOffsetVal.textContent = ms > 0 ? `+${(ms / 1000).toFixed(1)}s` : `${(ms / 1000).toFixed(1)}s`;

    renderProviders();
  }

  function renderProviders() {
    const list = document.getElementById('provider-list');
    if (!list) return;
    list.innerHTML = '';

    const order = settings.providerOrder || DEFAULT_SETTINGS.providerOrder;

    order.forEach((key, index) => {
      const item = document.createElement('div');
      item.className = 'provider-item';

      const isEnabled = settings.enabledProviders ? settings.enabledProviders[key] !== false : true;
      const label = PROVIDER_LABELS[key] || key;

      item.innerHTML = `
        <div class="provider-left">
          <input type="checkbox" id="chk-${key}" ${isEnabled ? 'checked' : ''}>
          <span>${index + 1}. ${label}</span>
        </div>
        <div class="provider-actions">
          <button class="btn-reorder" data-action="up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn-reorder" data-action="down" data-index="${index}" ${index === order.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
      `;

      item.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
        if (!settings.enabledProviders) settings.enabledProviders = {};
        settings.enabledProviders[key] = e.target.checked;
        save('enabledProviders', settings.enabledProviders);
      });

      const upBtn = item.querySelector('[data-action="up"]');
      if (upBtn) {
        upBtn.addEventListener('click', () => {
          if (index > 0) {
            const temp = order[index];
            order[index] = order[index - 1];
            order[index - 1] = temp;
            settings.providerOrder = order;
            save('providerOrder', settings.providerOrder);
            renderProviders();
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
            save('providerOrder', settings.providerOrder);
            renderProviders();
          }
        });
      }

      list.appendChild(item);
    });
  }

  // Event Listeners: Ambient
  ambientEnabledToggle.addEventListener('change', () => save('ambientEnabled', ambientEnabledToggle.checked));
  ambientBlurSlider.addEventListener('input', () => {
    ambientBlurVal.textContent = `${ambientBlurSlider.value}%`;
    save('ambientBlur', parseInt(ambientBlurSlider.value, 10));
  });
  ambientSpreadSlider.addEventListener('input', () => {
    ambientSpreadVal.textContent = `${ambientSpreadSlider.value}%`;
    save('ambientSpread', parseInt(ambientSpreadSlider.value, 10));
  });
  ambientFadeSlider.addEventListener('input', () => {
    const v = parseFloat(ambientFadeSlider.value);
    ambientFadeVal.textContent = v === 0 ? 'Off' : `${v.toFixed(1)}s`;
    save('ambientFadeDuration', v);
  });
  ambientBrightnessSlider.addEventListener('input', () => {
    ambientBrightnessVal.textContent = `${ambientBrightnessSlider.value}%`;
    save('ambientBrightness', parseInt(ambientBrightnessSlider.value, 10));
  });
  ambientSaturationSlider.addEventListener('input', () => {
    ambientSaturationVal.textContent = `${ambientSaturationSlider.value}%`;
    save('ambientSaturation', parseInt(ambientSaturationSlider.value, 10));
  });

  // Section Resets
  btnResetAmbient.addEventListener('click', () => {
    settings.ambientBlur = DEFAULT_SETTINGS.ambientBlur;
    settings.ambientSpread = DEFAULT_SETTINGS.ambientSpread;
    settings.ambientFadeDuration = DEFAULT_SETTINGS.ambientFadeDuration;
    settings.ambientBrightness = DEFAULT_SETTINGS.ambientBrightness;
    settings.ambientSaturation = DEFAULT_SETTINGS.ambientSaturation;
    save('ambientBlur', settings.ambientBlur);
    save('ambientSpread', settings.ambientSpread);
    save('ambientFadeDuration', settings.ambientFadeDuration);
    save('ambientBrightness', settings.ambientBrightness);
    save('ambientSaturation', settings.ambientSaturation);
    updateUI();
  });

  btnResetProviders.addEventListener('click', () => {
    settings.providerOrder = [...DEFAULT_SETTINGS.providerOrder];
    settings.enabledProviders = { ...DEFAULT_SETTINGS.enabledProviders };
    save('providerOrder', settings.providerOrder);
    save('enabledProviders', settings.enabledProviders);
    renderProviders();
  });

  btnResetLyrics.addEventListener('click', () => {
    settings.lyricsEnabled = DEFAULT_SETTINGS.lyricsEnabled;
    settings.appleMode = DEFAULT_SETTINGS.appleMode;
    settings.lineHighlight = DEFAULT_SETTINGS.lineHighlight;
    settings.wordHighlight = DEFAULT_SETTINGS.wordHighlight;
    settings.highlightStyle = DEFAULT_SETTINGS.highlightStyle;
    settings.furiganaEnabled = DEFAULT_SETTINGS.furiganaEnabled;
    settings.translationEnabled = DEFAULT_SETTINGS.translationEnabled;
    settings.fontSize = DEFAULT_SETTINGS.fontSize;
    settings.clickToSeek = DEFAULT_SETTINGS.clickToSeek;
    settings.syncOffset = DEFAULT_SETTINGS.syncOffset;
    save('lyricsEnabled', settings.lyricsEnabled);
    save('appleMode', settings.appleMode);
    save('lineHighlight', settings.lineHighlight);
    save('wordHighlight', settings.wordHighlight);
    save('highlightStyle', settings.highlightStyle);
    save('furiganaEnabled', settings.furiganaEnabled);
    save('translationEnabled', settings.translationEnabled);
    save('fontSize', settings.fontSize);
    save('clickToSeek', settings.clickToSeek);
    save('syncOffset', settings.syncOffset);
    updateUI();
  });

  btnResetAll.addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    chrome.storage.sync.set(DEFAULT_SETTINGS, () => updateUI());
  });

  // Lyrics Events
  if (lyricsEnabledToggle) {
    lyricsEnabledToggle.addEventListener('change', () => {
      save('lyricsEnabled', lyricsEnabledToggle.checked);
      save('appleMode', lyricsEnabledToggle.checked);
    });
  }
  if (lineHighlightToggle) {
    lineHighlightToggle.addEventListener('change', () => {
      save('lineHighlight', lineHighlightToggle.checked);
    });
  }
  if (wordHighlightToggle) {
    wordHighlightToggle.addEventListener('change', () => {
      save('wordHighlight', wordHighlightToggle.checked);
    });
  }
  if (highlightStyleSelect) {
    highlightStyleSelect.addEventListener('change', () => {
      save('highlightStyle', highlightStyleSelect.value);
    });
  }
  if (furiganaEnabledToggle) {
    furiganaEnabledToggle.addEventListener('change', () => {
      save('furiganaEnabled', furiganaEnabledToggle.checked);
    });
  }
  if (translationEnabledToggle) {
    translationEnabledToggle.addEventListener('change', () => {
      save('translationEnabled', translationEnabledToggle.checked);
    });
  }
  clickToSeekToggle.addEventListener('change', () => save('clickToSeek', clickToSeekToggle.checked));
  fontSizeSlider.addEventListener('input', () => {
    fontSizeVal.textContent = `${fontSizeSlider.value}px`;
    save('fontSize', parseInt(fontSizeSlider.value, 10));
  });
  syncOffsetSlider.addEventListener('input', () => {
    const ms = parseInt(syncOffsetSlider.value, 10);
    syncOffsetVal.textContent = ms > 0 ? `+${(ms / 1000).toFixed(1)}s` : `${(ms / 1000).toFixed(1)}s`;
    save('syncOffset', ms);
  });

  btnOffsetMinus.addEventListener('click', () => {
    let cur = parseInt(syncOffsetSlider.value, 10) - 100;
    if (cur < -2500) cur = -2500;
    syncOffsetSlider.value = cur;
    syncOffsetVal.textContent = cur > 0 ? `+${(cur / 1000).toFixed(1)}s` : `${(cur / 1000).toFixed(1)}s`;
    save('syncOffset', cur);
  });

  btnOffsetPlus.addEventListener('click', () => {
    let cur = parseInt(syncOffsetSlider.value, 10) + 100;
    if (cur > 2500) cur = 2500;
    syncOffsetSlider.value = cur;
    syncOffsetVal.textContent = cur > 0 ? `+${(cur / 1000).toFixed(1)}s` : `${(cur / 1000).toFixed(1)}s`;
    save('syncOffset', cur);
  });

  btnOffsetReset.addEventListener('click', () => {
    syncOffsetSlider.value = 0;
    syncOffsetVal.textContent = '0.0s';
    save('syncOffset', 0);
  });

  // Query Active Tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const activeTab = tabs[0];
    if (!activeTab.url || !activeTab.url.includes('music.youtube.com')) {
      trackTitle.textContent = 'YouTube Music Inactive';
      trackArtist.textContent = 'Switch to YouTube Music to view live track';
      trackBadge.className = 'track-badge';
      trackBadgeText.textContent = 'Inactive';
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        trackTitle.textContent = 'Connected to YT Music';
        trackArtist.textContent = 'Play a song to view lyrics';
        trackBadge.className = 'track-badge';
        trackBadgeText.textContent = 'Ready';
        return;
      }

      if (res.track && res.track.title) {
        trackTitle.textContent = res.track.title;
        trackArtist.textContent = res.track.artist || 'Unknown Artist';
        if (res.isSynced) {
          trackBadge.className = 'track-badge synced';
          trackBadgeText.textContent = `Synced (${res.lyricsSource || 'Multi'})`;
        } else if (res.lyricsSource && res.lyricsSource !== 'none') {
          trackBadge.className = 'track-badge static';
          trackBadgeText.textContent = 'Standard Lyrics';
        } else {
          trackBadge.className = 'track-badge';
          trackBadgeText.textContent = 'Searching...';
        }
      }
    });
  });
});
