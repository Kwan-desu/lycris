# Lyris Privacy Policy

_Last updated: 2026-10-14_

Lyris is a browser extension that shows synced lyrics and ambient lighting on YouTube Music (`music.youtube.com`). It has no account system, analytics, ads, or tracking, and it does not run its own servers.

## Data the extension handles

| Data | Where it goes | Why |
| --- | --- | --- |
| Title, artist, and duration of the track currently playing | LRCLIB (`lrclib.net`), NetEase Music (`music.163.com`), KuGou (`*.kugou.com`), and QQ Music (`*.qq.com`, only if you turn it on under **Sources**) | To look up lyrics for that track |
| Text you type into **Find Lyrics** | LRCLIB and NetEase Music | To list matching lyrics |
| Lyric lines of the current track | Google Translate (`clients5.google.com`), only if you turn on **Line translation** | To show English translations |
| Your settings and per-track sync offsets | `chrome.storage.sync` in your own browser profile | To remember your preferences |

Each lyrics service handles requests under its own privacy policy. Lyris sends them no identifiers, cookies, or YouTube account information.

## Data processed only on your device

- Japanese readings (furigana, romaji, kana) come from a dictionary bundled with the extension.
- Ambient light colors come from the video or album art, sampled in the page on your device. Images are not uploaded.
- Fetched lyrics are cached in memory and discarded when the browser tab or service worker closes.

## Permissions

- `storage`: saves your settings.
- Host access to `music.youtube.com`: runs the lyrics view and ambient light on that site.
- Host access to the lyrics and translation services listed above: lets the extension request lyrics from them.

## Contact

Questions about this policy: open an issue at https://github.com/Kwan-desu/lycris/issues.
