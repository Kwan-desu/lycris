/**
 * Ambient Light & Synced Lyrics for YouTube Music
 * Background Service Worker - Configurable Provider Order & Cover Analyzer
 */

const lyricsCache = new Map();
const translationCache = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_LYRICS') {
    handleFetchLyrics(request.trackInfo, request.providerOrder, request.enabledProviders)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[Background] Lyrics fetch error:', err);
        sendResponse({ success: false, synced: false, error: err.message, source: 'none' });
      });
    return true;
  } else if (request.action === 'CLEAR_CACHE') {
    lyricsCache.clear();
    translationCache.clear();
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'TRANSLATE_LYRICS') {
    handleTranslateLyrics(request.lines, request.cacheKey)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[Background] Translation error:', err);
        sendResponse({ success: false, translations: [] });
      });
    return true;
  } else if (request.action === 'SEARCH_LYRICS_CANDIDATES') {
    handleSearchCandidates(request.query)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[Background] Search candidates error:', err);
        sendResponse({ success: false, candidates: [] });
      });
    return true;
  } else if (request.action === 'FETCH_CANDIDATE_LYRICS') {
    handleFetchCandidateLyrics(request.candidate)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[Background] Candidate fetch error:', err);
        sendResponse({ success: false, lyrics: '', synced: false });
      });
    return true;
  }
});

// Clear cached lyrics when settings change in storage
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      lyricsCache.clear();
      translationCache.clear();
    }
  });
}

function fetchWithTimeout(url, options = {}, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function handleFetchLyrics(trackInfo, customOrder, enabledProviders) {
  if (!trackInfo || (!trackInfo.title && !trackInfo.cleanTitle)) {
    return { success: false, synced: false, source: 'none' };
  }

  const cacheKey = `${trackInfo.cleanTitle || trackInfo.title}__${trackInfo.cleanArtist || trackInfo.artist}`.toLowerCase();
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  // Determine provider execution order: QQ Music is disabled by default due to upstream 500 errors
  const defaultOrder = ['lrclib', 'netease', 'kugou'];
  const providerOrder = (Array.isArray(customOrder) && customOrder.length > 0)
    ? customOrder.filter(p => {
        if (p === 'qq') return enabledProviders && enabledProviders.qq === true;
        return !enabledProviders || enabledProviders[p] !== false;
      })
    : defaultOrder;

  const searchQueries = buildSearchQueries(trackInfo);
  let plainFallback = null;

  // Strict Provider Waterfall:
  // Respect the user's priority order. Fully check the top-priority provider across search query variations
  // before advancing to subsequent providers in the waterfall.
  for (const provider of providerOrder) {
    for (const qObj of searchQueries) {
      const q = qObj.query;
      if (!q || q.length < 2) continue;

      const targetTitle = qObj.title || trackInfo.cleanTitle || trackInfo.title;
      const targetArtist = qObj.artist || trackInfo.cleanArtist || trackInfo.artist;
      const targetDuration = trackInfo.duration;

      let res = null;
      try {
        if (provider === 'lrclib') {
          res = await fetchFromLrclib(targetTitle, targetArtist, targetDuration, qObj.isCover);
        } else if (provider === 'netease') {
          res = await fetchFromNetease(q, targetTitle, targetArtist, targetDuration, qObj.isCover);
        } else if (provider === 'kugou') {
          res = await fetchFromKugou(q, targetTitle, targetArtist, targetDuration, qObj.isCover);
        } else if (provider === 'qq') {
          res = await fetchFromQQ(q, targetTitle, targetArtist, targetDuration, qObj.isCover);
        }
      } catch (e) {
        res = null;
      }

      // If synchronized lyrics found on this provider, immediately return!
      if (res && res.synced) {
        if (qObj.isCover && qObj.note) res.source = `${res.source} (${qObj.note})`;
        lyricsCache.set(cacheKey, res);
        return res;
      }

      // Stash highest-priority plain lyrics fallback
      if (res && res.lyrics && !plainFallback) {
        plainFallback = res;
      }
    }
  }

  if (plainFallback) {
    lyricsCache.set(cacheKey, plainFallback);
    return plainFallback;
  }

  return { success: false, synced: false, source: 'none' };
}

// --- Video Fluff Cleaning & Artist / Title Disambiguation ---

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

function getPrimaryArtist(artist) {
  const cleaned = cleanArtistName(artist);
  if (!cleaned) return '';
  const primary = cleaned.split(/[,、&]|(?:\s+feat\.?|\s+ft\.?|\s+with\s+)/i)[0].trim();
  return (primary && primary.length >= 2) ? primary : cleaned;
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
 * Intelligently separates Title and Artist from YouTube titles and handles inverted / bilingual formats
 */
function extractTitleAndArtist(rawTitle, rawArtist) {
  let title = (rawTitle || '').trim();
  let artist = cleanArtistName(rawArtist || '') || (rawArtist || '').trim();

  // Check CJK quotation marks pattern: e.g. Artist「Title」, 「Title」 - Artist
  const cjkQuoteMatch = title.match(/^(.*?)[「『](.+?)[」』](.*?)$/);
  if (cjkQuoteMatch) {
    const inside = cjkQuoteMatch[2].trim();
    const outside = cleanVideoFluff((cjkQuoteMatch[1] + ' ' + cjkQuoteMatch[3]).trim()).replace(/\s*[-–—|/]\s*$/g, '').trim();
    if (inside) {
      const detectedArtist = outside || artist;
      return {
        primaryTitle: cleanVideoFluff(inside),
        partA: cleanVideoFluff(inside),
        partB: null,
        artist: cleanArtistName(detectedArtist) || artist,
        isBilingual: false,
        inverted: false
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

  // 3. Handle delimiters: " - ", " / ", " | "
  const delimiterRegex = /\s+[-–—/|]\s+/;
  if (delimiterRegex.test(title)) {
    const parts = title.split(delimiterRegex).map(p => cleanVideoFluff(p.trim())).filter(Boolean);
    if (parts.length >= 2) {
      const left = parts[0];
      const right = parts.slice(1).join(' - ');

      const leftLower = left.toLowerCase();
      const rightLower = right.toLowerCase();
      const artistLower = artist.toLowerCase();

      // If Left matches the known artist -> Left is Artist, Right is Title (Standard YouTube)
      if (artist && (leftLower.includes(artistLower) || artistLower.includes(leftLower))) {
        return { primaryTitle: cleanVideoFluff(right), partA: cleanVideoFluff(right), partB: null, artist: left, isBilingual: false, inverted: false };
      }
      // If Right matches the known artist -> Right is Artist, Left is Title (Inverted)
      if (artist && (rightLower.includes(artistLower) || artistLower.includes(rightLower))) {
        return { primaryTitle: cleanVideoFluff(left), partA: cleanVideoFluff(left), partB: null, artist: right, isBilingual: false, inverted: true };
      }

      // If an artist is ALREADY known from player metadata and neither part matches artist:
      // Both Left and Right are parts of the title (Bilingual / Dual title e.g. "星降る海 - Starry Sea")!
      if (artist) {
        return {
          primaryTitle: title,
          partA: cleanVideoFluff(left),
          partB: cleanVideoFluff(right),
          artist,
          isBilingual: true,
          inverted: false
        };
      }

      // Default YouTube upload convention when NO artist was known: Artist - Title
      return { primaryTitle: cleanVideoFluff(right), partA: cleanVideoFluff(right), partB: null, artist: left, isBilingual: false, inverted: false };
    }
  }

  return { primaryTitle: title, partA: title, partB: null, artist, isBilingual: false, inverted: false };
}

// --- Cover Song Analyzer & Query Builder ---

function decomposeTrackInfo(rawTitle, rawArtist) {
  let title = (rawTitle || '').trim();
  let artist = (rawArtist || '').trim();

  // Normalize fullwidth punctuation & brackets
  let normalized = title
    .replace(/[「『【［]/g, ' [')
    .replace(/[」』】］]/g, '] ')
    .replace(/／/g, '/')
    .replace(/｜/g, '|')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[–—]/g, '-');

  // Strip common YouTube fluff
  normalized = cleanVideoFluff(normalized);

  // Check if cover indicator is present (exclude remix/acoustic/slowed/reverb to avoid false positives)
  const isCover = /[\(\[]?\b(?:covered\s*by|cover(?:\s*ver(?:sion|\.)?)?|歌ってみた|うたってみた)\b[\)\]]?/i.test(normalized);

  // Remove cover tags like (Cover), [Cover], 【covered by Kotoha】, covered by ..., cover ver., etc.
  let cleanedForSplit = normalized
    .replace(/[\(\[](?:covered\s*by|cover(?:\s*ver(?:sion|\.)?)?|歌ってみた|うたってみた).*?[\)\]]/gi, '')
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
        const subParts = parts[0].split(' - ').map(p => p.trim());
        primaryTitle = subParts[0];
        originalArtist = subParts[1];
        coverArtist = parts[1];
      } else {
        primaryTitle = parts[0];
        originalArtist = parts[1];
      }
    } else if (parts.length === 1) {
      primaryTitle = parts[0];
    }
  } else if (cleanedForSplit.includes(' - ')) {
    const extracted = extractTitleAndArtist(cleanedForSplit, artist);
    primaryTitle = extracted.primaryTitle;
    originalArtist = extracted.artist;
  } else {
    primaryTitle = cleanedForSplit;
  }

  primaryTitle = cleanVideoFluff(primaryTitle);

  if (!primaryTitle || primaryTitle.length < 1) {
    primaryTitle = title.split(/[/|\-(]/)[0].trim() || title;
  }

  return {
    rawTitle: title,
    rawArtist: artist,
    primaryTitle,
    originalArtist: cleanArtistName(originalArtist),
    coverArtist: cleanArtistName(coverArtist),
    isCover
  };
}

function buildSearchQueries(titleOrTrackInfo, artistParam, rawQueryParam) {
  let rawTitle = '';
  let rawArtist = '';
  let rawQuery = '';

  if (titleOrTrackInfo && typeof titleOrTrackInfo === 'object') {
    rawTitle = titleOrTrackInfo.title || titleOrTrackInfo.cleanTitle || '';
    rawArtist = titleOrTrackInfo.artist || titleOrTrackInfo.cleanArtist || '';
    rawQuery = titleOrTrackInfo.rawQuery || titleOrTrackInfo.title || '';
  } else {
    rawTitle = titleOrTrackInfo || '';
    rawArtist = artistParam || '';
    rawQuery = rawQueryParam || rawTitle;
  }

  const queries = [];
  const added = new Set();

  function add(query, titleVal, artistVal, isCover = false, note = '') {
    if (!query) return;
    const trimmed = query.replace(/\s+/g, ' ').trim();
    if (trimmed && trimmed.length >= 2 && !added.has(trimmed.toLowerCase())) {
      added.add(trimmed.toLowerCase());
      queries.push({
        query: trimmed,
        title: titleVal || '',
        artist: artistVal || '',
        isCover,
        note
      });
    }
  }

  // Check if cover indicator is present (excluding remix/acoustic/etc. to avoid false positives)
  const isCover = /[\(\[【（]?\b(?:covered\s*by|cover(?:\s*ver(?:sion|\.)?)?|歌ってみた|うたってみた)\b[\)\]】）]?/i.test(rawTitle + ' ' + rawQuery);

  if (isCover) {
    const decomp = decomposeTrackInfo(rawTitle, rawArtist);
    if (decomp.primaryTitle && decomp.originalArtist) {
      add(`${decomp.primaryTitle} ${decomp.originalArtist}`, decomp.primaryTitle, decomp.originalArtist, true, 'Original Track');
    }
    if (decomp.primaryTitle) {
      add(decomp.primaryTitle, decomp.primaryTitle, decomp.originalArtist || '', true, 'Original Song Title');
    }
    if (decomp.primaryTitle && decomp.coverArtist) {
      add(`${decomp.primaryTitle} ${decomp.coverArtist}`, decomp.primaryTitle, decomp.coverArtist, true, 'Cover Artist');
    }
    return queries.slice(0, 4);
  }

  // Normal track disambiguation
  const disambiguationSource = (rawQuery && /[-–—/|]/.test(rawQuery)) ? rawQuery : rawTitle;
  const extracted = extractTitleAndArtist(disambiguationSource, rawArtist);
  const primaryTitle = cleanVideoFluff(extracted.primaryTitle || rawTitle);
  const cleanArtist = cleanArtistName(extracted.artist || rawArtist) || (extracted.artist || rawArtist).trim();
  const primaryArtist = getPrimaryArtist(cleanArtist);

  // If track is bilingual / dual-titled (e.g. "星降る海 - Starry Sea")
  if (extracted.isBilingual && extracted.partA && extracted.partB) {
    if (primaryArtist) {
      add(`${extracted.partA} ${primaryArtist}`, extracted.partA, primaryArtist, false, 'Part A & Artist');
      add(`${extracted.partB} ${primaryArtist}`, extracted.partB, primaryArtist, false, 'Part B & Artist');
      add(`${primaryTitle} ${primaryArtist}`, primaryTitle, primaryArtist, false, 'Full Title & Artist');
    }
    if (cleanArtist && cleanArtist !== primaryArtist) {
      add(`${extracted.partA} ${cleanArtist}`, extracted.partA, cleanArtist, false, 'Part A & Clean Artist');
    }
    add(extracted.partA, extracted.partA, cleanArtist, false, 'Part A Title');
    add(extracted.partB, extracted.partB, cleanArtist, false, 'Part B Title');
    return queries.slice(0, 5);
  }

  // Query 1: Clean Title + Primary Artist
  if (primaryTitle && primaryArtist) {
    add(`${primaryTitle} ${primaryArtist}`, primaryTitle, primaryArtist, false, 'Title & Primary Artist');
  }

  // Query 2: Clean Title + Full Clean Artist (if distinct from primary)
  if (primaryTitle && cleanArtist && cleanArtist !== primaryArtist) {
    add(`${primaryTitle} ${cleanArtist}`, primaryTitle, cleanArtist, false, 'Title & Clean Artist');
  }

  // Query 3: Handling for inverted titles if the source title had delimiters
  if (disambiguationSource && /[-–—/|]/.test(disambiguationSource)) {
    const parts = disambiguationSource.split(/\s*[-–—/|]\s*/).map(p => cleanVideoFluff(p.trim())).filter(Boolean);
    if (parts.length >= 2) {
      const part0 = parts[0];
      const part1 = parts.slice(1).join(' - ');
      // Alternate / Inverted: if primaryTitle is part1, try part0 as title; if primaryTitle is part0, try part1
      const altTitle = (primaryTitle.toLowerCase() === part1.toLowerCase()) ? part0 : part1;
      const altArtist = (cleanArtist.toLowerCase() === part0.toLowerCase()) ? part1 : part0;
      if (altTitle && altArtist) {
        add(`${altTitle} ${altArtist}`, altTitle, altArtist, false, 'Inverted Title & Artist');
      }
    }
  }

  // Query 4: Cleaned raw title if distinct
  const cleanedRaw = cleanVideoFluff(rawTitle);
  if (cleanedRaw && cleanArtist && !cleanedRaw.toLowerCase().includes(cleanArtist.toLowerCase())) {
    add(`${cleanedRaw} ${cleanArtist}`, cleanedRaw, cleanArtist, false, 'Raw Title & Artist');
  } else if (cleanedRaw && cleanedRaw.toLowerCase() !== primaryTitle.toLowerCase()) {
    add(cleanedRaw, cleanedRaw, cleanArtist, false, 'Raw Title');
  }

  // Query 5: Clean Title only (fallback if artist-specific search yields nothing)
  if (primaryTitle) {
    add(primaryTitle, primaryTitle, cleanArtist, false, 'Title');
  }

  return queries.slice(0, 5);
}

// --- Text Similarity Validation & Selection ---

function tokenize(str) {
  if (!str) return [];
  const tokens = [];
  const rawWords = str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(Boolean);
  for (const word of rawWords) {
    tokens.push(word);
    // Include individual CJK characters to support Japanese/Chinese words without spaces
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(word)) {
      for (const ch of word) {
        if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(ch)) {
          tokens.push(ch);
        }
      }
    }
  }
  return tokens;
}

/**
 * Compute similarity combining Jaccard similarity (tokensA ∩ tokensB / tokensA ∪ tokensB)
 * with word token overlap.
 */
function computeTokenSimilarity(strA, strB) {
  if (!strA || !strB) return 0;
  const sA = strA.trim().toLowerCase();
  const sB = strB.trim().toLowerCase();
  if (sA === sB) return 1.0;

  const arrA = tokenize(strA);
  const arrB = tokenize(strB);
  if (arrA.length === 0 || arrB.length === 0) return 0;

  const setA = new Set(arrA);
  const setB = new Set(arrB);

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const unionSize = new Set([...setA, ...setB]).size;
  if (unionSize === 0) return 0;

  // Jaccard similarity: tokensA ∩ tokensB / tokensA ∪ tokensB
  const jaccard = intersection / unionSize;

  // Word token overlap against the larger set (avoids single-word false 100% matches)
  const tokenOverlap = intersection / Math.max(setA.size, setB.size);

  return (jaccard + tokenOverlap) / 2;
}

/**
 * Select best candidate from search results using Jaccard & token similarity,
 * duration weighting, and quality threshold.
 */
function selectBestCandidate(candidates, targetTitle, targetArtist, targetDuration, isCoverSong = false) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const cleanTargetTitle = cleanVideoFluff(targetTitle || '');
  const cleanTargetArtist = cleanArtistName(targetArtist || '');
  const primaryTargetArtist = getPrimaryArtist(cleanTargetArtist);

  let targetPartA = '';
  let targetPartB = '';
  if (cleanTargetTitle.includes(' - ')) {
    const parts = cleanTargetTitle.split(' - ').map(p => cleanVideoFluff(p.trim())).filter(Boolean);
    if (parts.length >= 2) {
      targetPartA = parts[0];
      targetPartB = parts.slice(1).join(' - ');
    }
  }

  const scoreCandidate = (item) => {
    if (!item) return { score: -1, item: null };

    const candidateTitle = item.trackName || item.name || '';
    const candidateArtist = item.artistName || '';
    const candidateAlbum = item.albumName || item.album || '';

    const cleanCandidateTitle = cleanVideoFluff(candidateTitle);
    const cleanCandidateArtist = cleanArtistName(candidateArtist);
    const cleanCandidateAlbum = cleanVideoFluff(candidateAlbum);

    // If album name matches target title (common for singles or bilingual Japanese releases where LRCLIB has English trackName and original Japanese albumName)
    const albumMatchesTarget = cleanCandidateAlbum ? computeTokenSimilarity(cleanTargetTitle, cleanCandidateAlbum) : 0;
    const albumAsTitleValid = albumMatchesTarget >= 0.7 && (!targetDuration || !item.duration || Math.abs(item.duration - targetDuration) <= 15);

    const titleSim = Math.max(
      computeTokenSimilarity(cleanTargetTitle, cleanCandidateTitle),
      computeTokenSimilarity(cleanTargetTitle, candidateTitle),
      computeTokenSimilarity(targetTitle, candidateTitle),
      albumAsTitleValid ? albumMatchesTarget : 0,
      targetPartA ? computeTokenSimilarity(targetPartA, cleanCandidateTitle) : 0,
      targetPartB ? computeTokenSimilarity(targetPartB, cleanCandidateTitle) : 0
    );

    // CRITICAL: Reject candidates that do not match the title! Never allow album/artist
    // overlap to match a completely different track from the same album!
    if (titleSim < 0.35) return { score: -1, item: null };

    const primaryCandidateArtist = getPrimaryArtist(cleanCandidateArtist);

    const artistSim = Math.max(
      computeTokenSimilarity(cleanTargetArtist, cleanCandidateArtist),
      computeTokenSimilarity(cleanTargetArtist, candidateArtist),
      computeTokenSimilarity(targetArtist, candidateArtist),
      primaryTargetArtist ? computeTokenSimilarity(primaryTargetArtist, cleanCandidateArtist) : 0,
      primaryTargetArtist ? computeTokenSimilarity(primaryTargetArtist, candidateArtist) : 0,
      primaryCandidateArtist ? computeTokenSimilarity(cleanTargetArtist, primaryCandidateArtist) : 0,
      (primaryTargetArtist && primaryCandidateArtist) ? computeTokenSimilarity(primaryTargetArtist, primaryCandidateArtist) : 0
    );

    // Matching artist tokens check
    const targetArtistTokens = new Set([
      ...tokenize(cleanTargetArtist),
      ...tokenize(targetArtist),
      ...tokenize(primaryTargetArtist)
    ]);
    const candidateArtistTokens = new Set([
      ...tokenize(cleanCandidateArtist),
      ...tokenize(candidateArtist),
      ...tokenize(primaryCandidateArtist)
    ]);
    let hasMatchingArtistToken = false;
    for (const token of targetArtistTokens) {
      if (candidateArtistTokens.has(token)) {
        hasMatchingArtistToken = true;
        break;
      }
    }

    // Cover Song Support: If this is a cover song or target artist is empty, and the candidate title
    // is an exact/near-exact match (titleSim >= 0.8) and duration aligns (<= 15s), accept candidate
    // even if performed by a different original artist.
    const durationDiff = (targetDuration && targetDuration > 0 && item.duration)
      ? Math.abs(item.duration - targetDuration)
      : 0;
    const isCoverAccepted = isCoverSong && titleSim >= 0.80 && (!targetDuration || !item.duration || durationDiff <= 15);

    // HARD REJECTION: When target artist is non-empty and candidate artist is non-empty.
    // Do NOT accept candidates from completely unrelated artists unless valid cover song match!
    if ((cleanTargetArtist || targetArtist) && (cleanCandidateArtist || candidateArtist)) {
      if (!hasMatchingArtistToken && artistSim < 0.25 && !isCoverAccepted) {
        return { score: -1, item: null };
      }
    }

    // Title similarity weight 0.6, artist similarity weight 0.4 (or 0.8 title if cover match)
    let score = isCoverAccepted
      ? titleSim * 0.8
      : ((cleanTargetArtist || targetArtist)
          ? (titleSim * 0.6) + (artistSim * 0.4)
          : titleSim);

    // Soft duration weighting (+0.2 for <=5s, +0.1 for <=15s, -0.3 for >45s)
    if (targetDuration && targetDuration > 0 && item.duration) {
      if (durationDiff <= 5) {
        score += 0.2;
      } else if (durationDiff <= 15) {
        score += 0.1;
      } else if (durationDiff > 45) {
        score -= 0.3;
      }
    }

    // If cleanTargetArtist is present, require at least artistSim >= 0.30 or score >= 0.65 with matching artist tokens (unless cover match)
    if ((cleanTargetArtist || targetArtist) && !isCoverAccepted) {
      const isArtistConfident = artistSim >= 0.30 || (score >= 0.65 && hasMatchingArtistToken);
      if (!isArtistConfident) {
        return { score: -1, item: null };
      }
    }

    return { score, item };
  };

  const evaluatePool = (pool) => {
    let bestMatch = null;
    let bestScore = -1;

    for (const item of pool) {
      const { score, item: validItem } = scoreCandidate(item);
      if (validItem && score > bestScore) {
        bestScore = score;
        bestMatch = validItem;
      }
    }

    // Threshold score >= 0.45
    if (bestMatch && bestScore >= 0.45) {
      return {
        success: true,
        synced: !!bestMatch.syncedLyrics,
        lyrics: bestMatch.syncedLyrics || bestMatch.plainLyrics,
        source: 'LRCLIB'
      };
    }
    return null;
  };

  // Prioritize synced candidates first
  const syncedCandidates = candidates.filter(c => c && c.syncedLyrics);
  const syncedMatch = evaluatePool(syncedCandidates);
  if (syncedMatch) return syncedMatch;

  // Fallback to plain lyrics candidates
  const plainCandidates = candidates.filter(c => c && c.plainLyrics);
  return evaluatePool(plainCandidates);
}

// --- Providers ---

async function fetchFromLrclib(title, artist, duration, isCoverSong = false) {
  if (typeof artist === 'number' && duration === undefined) {
    duration = artist;
    artist = '';
  }

  const cleanT = cleanVideoFluff(title || '');
  const cleanA = cleanArtistName(artist || '');
  const primaryA = getPrimaryArtist(cleanA);

  const userAgent = 'LycrisLyrics/1.0.0 (https://github.com/Kwan-desu/lycris)';
  const headers = { 'User-Agent': userAgent };

  let plainFallback = null;

  // 1. Concurrent queries for ultra-low latency (<1.5s): Exact GET + Search
  const promises = [];

  // Exact GET promise
  if (cleanT && (primaryA || cleanA)) {
    const artistToUse = primaryA || cleanA;
    let getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanT)}&artist_name=${encodeURIComponent(artistToUse)}`;
    if (duration && duration > 0) {
      getUrl += `&duration=${Math.round(duration)}`;
    }
    promises.push(
      fetchWithTimeout(getUrl, { headers }, 1500)
        .then(async resp => {
          if (!resp.ok) return null;
          const data = await resp.json();
          if (data && data.syncedLyrics) {
            return { type: 'exact_synced', match: { success: true, synced: true, lyrics: data.syncedLyrics, source: 'LRCLIB (Exact)' } };
          }
          if (data && data.plainLyrics) {
            return { type: 'exact_plain', match: { success: true, synced: false, lyrics: data.plainLyrics, source: 'LRCLIB (Exact)' } };
          }
          return null;
        })
        .catch(() => null)
    );
  }

  // Primary Query search promise
  const queryStr = `${cleanT} ${primaryA || cleanA}`.trim();
  const qUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(queryStr)}`;
  promises.push(
    fetchWithTimeout(qUrl, { headers }, 1500)
      .then(async resp => {
        if (!resp.ok) return null;
        const results = await resp.json();
        return Array.isArray(results) ? { type: 'search', results } : null;
      })
      .catch(() => null)
  );

  // If artist was provided, also search title alone concurrently to discover original tracks for covers or multi-artist releases
  if (primaryA || cleanA) {
    const titleOnlyUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanT)}`;
    promises.push(
      fetchWithTimeout(titleOnlyUrl, { headers }, 1500)
        .then(async resp => {
          if (!resp.ok) return null;
          const results = await resp.json();
          return Array.isArray(results) ? { type: 'search', results } : null;
        })
        .catch(() => null)
    );
  }

  // If title has a bilingual hyphen (e.g. "星降る海 - Starry Sea"), also query Part A concurrently
  if (cleanT.includes(' - ')) {
    const partA = cleanVideoFluff(cleanT.split(' - ')[0]);
    if (partA && partA.length >= 2) {
      const partAUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${partA} ${primaryA || cleanA}`.trim())}`;
      promises.push(
        fetchWithTimeout(partAUrl, { headers }, 1500)
          .then(async resp => {
            if (!resp.ok) return null;
            const results = await resp.json();
            return Array.isArray(results) ? { type: 'search', results } : null;
          })
          .catch(() => null)
      );
    }
  }

  const responses = await Promise.all(promises);

  // Check exact synced match first
  for (const r of responses) {
    if (r && r.type === 'exact_synced') {
      return r.match;
    }
    if (r && r.type === 'exact_plain' && !plainFallback) {
      plainFallback = r.match;
    }
  }

  // Pool all search candidates together
  const pool = [];
  const seenIds = new Set();
  for (const r of responses) {
    if (r && r.type === 'search' && Array.isArray(r.results)) {
      for (const item of r.results) {
        if (item && item.id && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          pool.push(item);
        }
      }
    }
  }

  if (pool.length > 0) {
    const candidateMatch = selectBestCandidate(pool, cleanT, cleanA, duration, isCoverSong);
    if (candidateMatch && candidateMatch.synced) {
      return candidateMatch;
    }
    if (candidateMatch && !plainFallback) {
      plainFallback = candidateMatch;
    }
  }

  if (plainFallback) {
    return plainFallback;
  }

  return null;
}

async function fetchFromNetease(query, targetTitle, targetArtist, targetDuration, isCoverSong = false) {
  try {
    const searchUrl = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(query)}&type=1&offset=0&limit=5`;
    const searchResp = await fetchWithTimeout(searchUrl, { headers: { 'Referer': 'https://music.163.com' } }, 1500);
    if (!searchResp.ok) return null;
    const searchData = await searchResp.json();
    const songs = searchData?.result?.songs;
    if (!Array.isArray(songs) || songs.length === 0) return null;

    const cleanTgtTitle = cleanVideoFluff(targetTitle || '');
    const cleanTgtArtist = cleanArtistName(targetArtist || '');
    const primaryTgtArtist = getPrimaryArtist(cleanTgtArtist);

    let tgtPartA = '';
    let tgtPartB = '';
    if (cleanTgtTitle.includes(' - ')) {
      const parts = cleanTgtTitle.split(' - ').map(p => cleanVideoFluff(p.trim())).filter(Boolean);
      tgtPartA = parts[0] || '';
      tgtPartB = parts.slice(1).join(' - ') || '';
    }

    for (const song of songs.slice(0, 3)) {
      if (!song.id) continue;

      // 1. Mandatory Title Similarity Check (>= 0.35)
      const songTitle = song.name || '';
      const cleanSongTitle = cleanVideoFluff(songTitle);
      const titleSim = Math.max(
        computeTokenSimilarity(cleanTgtTitle, cleanSongTitle),
        computeTokenSimilarity(cleanTgtTitle, songTitle),
        computeTokenSimilarity(targetTitle, songTitle),
        tgtPartA ? computeTokenSimilarity(tgtPartA, cleanSongTitle) : 0,
        tgtPartB ? computeTokenSimilarity(tgtPartB, cleanSongTitle) : 0
      );
      if (titleSim < 0.35) continue;

      const durDiff = (targetDuration && targetDuration > 0 && song.dt)
        ? Math.abs((song.dt / 1000) - targetDuration)
        : 0;
      const isCoverAccepted = isCoverSong && titleSim >= 0.80 && (!targetDuration || !song.dt || durDiff <= 15);

      // 2. Artist Similarity Check (>= 0.25) unless cover song match
      if (cleanTgtArtist && !isCoverAccepted) {
        const songArtists = (song.ar || song.artists || []).map(a => a.name).filter(Boolean).join(' ');
        if (songArtists) {
          const sim = Math.max(
            computeTokenSimilarity(cleanTgtArtist, cleanArtistName(songArtists)),
            computeTokenSimilarity(cleanTgtArtist, songArtists),
            computeTokenSimilarity(targetArtist, songArtists),
            primaryTgtArtist ? computeTokenSimilarity(primaryTgtArtist, songArtists) : 0
          );
          if (sim < 0.25) continue;
        }
      }

      const lyricUrl = `https://music.163.com/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`;
      const lyricResp = await fetchWithTimeout(lyricUrl, { headers: { 'Referer': 'https://music.163.com' } }, 1500);
      if (!lyricResp.ok) continue;
      const lyricData = await lyricResp.json();
      const lrc = lyricData?.lrc?.lyric;
      if (lrc && lrc.includes('[0')) {
        return { success: true, synced: true, lyrics: lrc, source: 'Netease' };
      }
    }
  } catch (e) {}
  return null;
}

async function fetchFromKugou(query, targetTitle, targetArtist, targetDuration, isCoverSong = false) {
  try {
    const searchUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(query)}&page=1&pagesize=5&clientver=&platform=WebFilter`;
    const searchResp = await fetchWithTimeout(searchUrl, {}, 1500);
    if (!searchResp.ok) return null;

    const searchData = await searchResp.json();
    const songs = searchData?.data?.lists;
    if (!Array.isArray(songs) || songs.length === 0) return null;

    const cleanTgtTitle = cleanVideoFluff(targetTitle || '');
    const cleanTgtArtist = cleanArtistName(targetArtist || '');
    const primaryTgtArtist = getPrimaryArtist(cleanTgtArtist);

    let tgtPartA = '';
    let tgtPartB = '';
    if (cleanTgtTitle.includes(' - ')) {
      const parts = cleanTgtTitle.split(' - ').map(p => cleanVideoFluff(p.trim())).filter(Boolean);
      tgtPartA = parts[0] || '';
      tgtPartB = parts.slice(1).join(' - ') || '';
    }

    for (const song of songs.slice(0, 3)) {
      // 1. Mandatory Title Similarity Check (>= 0.35)
      const songTitle = song.SongName || song.FileName || '';
      const cleanSongTitle = cleanVideoFluff(songTitle);
      const titleSim = Math.max(
        computeTokenSimilarity(cleanTgtTitle, cleanSongTitle),
        computeTokenSimilarity(cleanTgtTitle, songTitle),
        computeTokenSimilarity(targetTitle, songTitle),
        tgtPartA ? computeTokenSimilarity(tgtPartA, cleanSongTitle) : 0,
        tgtPartB ? computeTokenSimilarity(tgtPartB, cleanSongTitle) : 0
      );
      if (titleSim < 0.35) continue;

      const durDiff = (targetDuration && targetDuration > 0 && song.Duration)
        ? Math.abs(song.Duration - targetDuration)
        : 0;
      const isCoverAccepted = isCoverSong && titleSim >= 0.80 && (!targetDuration || !song.Duration || durDiff <= 15);

      // 2. Artist Similarity Check (>= 0.25) unless cover song match
      if (cleanTgtArtist && song.SingerName && !isCoverAccepted) {
        const sim = Math.max(
          computeTokenSimilarity(cleanTgtArtist, cleanArtistName(song.SingerName)),
          computeTokenSimilarity(cleanTgtArtist, song.SingerName),
          computeTokenSimilarity(targetArtist, song.SingerName),
          primaryTgtArtist ? computeTokenSimilarity(primaryTgtArtist, song.SingerName) : 0
        );
        if (sim < 0.25) continue;
      }

      const hash = song.FileHash || song.HQFileHash || song.SQFileHash;
      if (!hash) continue;

      const lrcUrl = `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=${song.Duration || ''}&hash=${hash}`;
      const lrcResp = await fetchWithTimeout(lrcUrl, {}, 1500);
      if (!lrcResp.ok) continue;

      const lrcData = await lrcResp.json();
      const candidate = lrcData?.candidates?.[0];
      if (!candidate?.id || !candidate?.accesskey) continue;

      const downUrl = `https://krcs.kugou.com/download?ver=1&client=mobi&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=lrc`;
      const downResp = await fetchWithTimeout(downUrl, {}, 1500);
      if (!downResp.ok) continue;

      const downData = await downResp.json();
      if (!downData?.content) continue;

      const binaryStr = atob(downData.content);
      const bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
      const decodedLrc = new TextDecoder('utf-8').decode(bytes);

      if (decodedLrc && decodedLrc.includes('[0')) {
        return { success: true, synced: true, lyrics: decodedLrc, source: 'Kugou' };
      }
    }
  } catch (e) {}
  return null;
}

async function fetchFromQQ(query, targetTitle, targetArtist, targetDuration, isCoverSong = false) {
  // QQ Music legacy endpoint (c.y.qq.com) frequently returns HTTP 500 without authenticated sessions.
  // Isolated with a fast timeout (1500ms) and error catch to prevent delaying overall lyrics fetch.
  try {
    const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w=${encodeURIComponent(query)}&format=json`;
    const searchResp = await fetchWithTimeout(searchUrl, { headers: { 'Referer': 'https://y.qq.com/' } }, 1500);
    if (!searchResp.ok) return null;
    const searchData = await searchResp.json();
    const songs = searchData?.data?.song?.list;
    if (!Array.isArray(songs) || songs.length === 0) return null;

    const cleanTgtTitle = cleanVideoFluff(targetTitle || '');
    const cleanTgtArtist = cleanArtistName(targetArtist || '');
    const primaryTgtArtist = getPrimaryArtist(cleanTgtArtist);

    let tgtPartA = '';
    let tgtPartB = '';
    if (cleanTgtTitle.includes(' - ')) {
      const parts = cleanTgtTitle.split(' - ').map(p => cleanVideoFluff(p.trim())).filter(Boolean);
      tgtPartA = parts[0] || '';
      tgtPartB = parts.slice(1).join(' - ') || '';
    }

    for (const song of songs.slice(0, 2)) {
      if (!song.songmid) continue;

      // 1. Mandatory Title Similarity Check (>= 0.35)
      const songTitle = song.songname || song.name || '';
      const cleanSongTitle = cleanVideoFluff(songTitle);
      const titleSim = Math.max(
        computeTokenSimilarity(cleanTgtTitle, cleanSongTitle),
        computeTokenSimilarity(cleanTgtTitle, songTitle),
        computeTokenSimilarity(targetTitle, songTitle),
        tgtPartA ? computeTokenSimilarity(tgtPartA, cleanSongTitle) : 0,
        tgtPartB ? computeTokenSimilarity(tgtPartB, cleanSongTitle) : 0
      );
      if (titleSim < 0.35) continue;

      const durDiff = (targetDuration && targetDuration > 0 && song.interval)
        ? Math.abs(song.interval - targetDuration)
        : 0;
      const isCoverAccepted = isCoverSong && titleSim >= 0.80 && (!targetDuration || !song.interval || durDiff <= 15);

      // 2. Artist Similarity Check (>= 0.25) unless cover song match
      if (cleanTgtArtist && song.singer && !isCoverAccepted) {
        const singerNames = Array.isArray(song.singer) ? song.singer.map(s => s.name).join(' ') : String(song.singer || '');
        if (singerNames) {
          const sim = Math.max(
            computeTokenSimilarity(cleanTgtArtist, cleanArtistName(singerNames)),
            computeTokenSimilarity(cleanTgtArtist, singerNames),
            computeTokenSimilarity(targetArtist, singerNames),
            primaryTgtArtist ? computeTokenSimilarity(primaryTgtArtist, singerNames) : 0
          );
          if (sim < 0.25) continue;
        }
      }

      const lyricUrl = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${song.songmid}&format=json&nobase64=1`;
      const lyricResp = await fetchWithTimeout(lyricUrl, { headers: { 'Referer': 'https://y.qq.com/' } }, 1500);
      if (!lyricResp.ok) continue;
      const lyricData = await lyricResp.json();
      let lrc = lyricData?.lyric;
      if (lrc) {
        if (!lrc.includes('[0') && /^[A-Za-z0-9+/=]+$/.test(lrc.trim())) {
          try {
            lrc = atob(lrc);
          } catch (e) {}
        }
        if (lrc && lrc.includes('[0')) {
          return { success: true, synced: true, lyrics: lrc, source: 'QQ Music' };
        }
      }
    }
  } catch (e) {}
  return null;
}

async function handleTranslateLyrics(lines, cacheKey) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { success: false, translations: [] };
  }

  if (cacheKey && translationCache.has(cacheKey)) {
    return { success: true, translations: translationCache.get(cacheKey) };
  }

  try {
    const fullText = lines.map(l => (typeof l === 'string' ? l.trim() : '')).join('\n');
    if (!fullText.trim()) {
      return { success: false, translations: [] };
    }

    const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=ja&tl=en&q=' + encodeURIComponent(fullText);
    const resp = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, 6000);

    if (!resp.ok) {
      throw new Error(`Translation HTTP ${resp.status}`);
    }

    const data = await resp.json();
    let translatedLines = [];
    if (Array.isArray(data) && typeof data[0] === 'string') {
      translatedLines = data[0].split('\n').map(s => s.trim());
    } else if (typeof data === 'string') {
      translatedLines = data.split('\n').map(s => s.trim());
    }

    const finalTranslations = lines.map((_, idx) => translatedLines[idx] || '');

    if (cacheKey) {
      translationCache.set(cacheKey, finalTranslations);
    }

    return { success: true, translations: finalTranslations };
  } catch (err) {
    console.error('[Background] Failed to translate lyrics:', err);
    return { success: false, translations: [] };
  }
}

async function handleSearchCandidates(query) {
  if (!query || !query.trim()) return { success: true, candidates: [] };
  const q = query.trim();
  const candidates = [];

  const userAgent = 'LyrisLyrics/1.0.0 (https://github.com/Kwan-desu/lycris)';
  const headers = { 'User-Agent': userAgent };

  // 1. Search LRCLIB
  try {
    const lrclibUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
    const resp = await fetchWithTimeout(lrclibUrl, { headers }, 2500);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data)) {
        for (const item of data.slice(0, 15)) {
          if (item && item.id) {
            candidates.push({
              id: String(item.id),
              provider: 'lrclib',
              title: item.trackName || '',
              artist: item.artistName || '',
              album: item.albumName || '',
              duration: item.duration || 0,
              synced: Boolean(item.syncedLyrics),
              lyrics: item.syncedLyrics || item.plainLyrics || '',
              source: 'LRCLIB'
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Background] LRCLIB candidate search error:', e);
  }

  // 2. Search NetEase
  try {
    const neteaseUrl = `https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=${encodeURIComponent(q)}&type=1&offset=0&total=true&limit=10`;
    const resp = await fetchWithTimeout(neteaseUrl, {}, 2500);
    if (resp.ok) {
      const data = await resp.json();
      const songs = data?.result?.songs;
      if (Array.isArray(songs)) {
        for (const song of songs.slice(0, 10)) {
          if (song && song.id) {
            const artists = (song.artists || []).map(a => a.name).join(', ');
            candidates.push({
              id: String(song.id),
              provider: 'netease',
              title: song.name || '',
              artist: artists,
              album: song.album?.name || '',
              duration: Math.round((song.duration || 0) / 1000),
              synced: true,
              lyrics: '',
              source: 'NetEase'
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Background] NetEase candidate search error:', e);
  }

  return { success: true, candidates };
}

async function handleFetchCandidateLyrics(candidate) {
  if (!candidate) return { success: false, lyrics: '', synced: false };

  // If candidate already has lyrics embedded (e.g. from LRCLIB search)
  if (candidate.lyrics) {
    return {
      success: true,
      lyrics: candidate.lyrics,
      synced: candidate.synced,
      source: candidate.source || 'LRCLIB'
    };
  }

  if (candidate.provider === 'lrclib' && candidate.id) {
    try {
      const resp = await fetchWithTimeout(`https://lrclib.net/api/get/${candidate.id}`, {}, 2500);
      if (resp.ok) {
        const data = await resp.json();
        const lrc = data.syncedLyrics || data.plainLyrics;
        return {
          success: Boolean(lrc),
          lyrics: lrc || '',
          synced: Boolean(data.syncedLyrics),
          source: 'LRCLIB'
        };
      }
    } catch (e) {
      console.warn('[Background] LRCLIB candidate fetch error:', e);
    }
  }

  if (candidate.provider === 'netease' && candidate.id) {
    try {
      const resp = await fetchWithTimeout(`https://music.163.com/api/song/lyric?os=pc&id=${candidate.id}&lv=-1&kv=-1&tv=-1`, {}, 2500);
      if (resp.ok) {
        const data = await resp.json();
        const lrc = data?.lrc?.lyric;
        return {
          success: Boolean(lrc),
          lyrics: lrc || '',
          synced: Boolean(lrc && /\[\d{2}:\d{2}/.test(lrc)),
          source: 'NetEase'
        };
      }
    } catch (e) {
      console.warn('[Background] NetEase candidate fetch error:', e);
    }
  }

  return { success: false, lyrics: '', synced: false };
}

