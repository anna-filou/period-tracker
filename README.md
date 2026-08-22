# Hema Period Tracker

A lightweight, privacy-first period tracker that runs entirely in the browser (and as an installable PWA). Log period days on a scrolling calendar, see predictions and (optional) fertility markers, and review cycle stats in a log view. All data stays on your device.

## Features

- **Calendar** — infinite scroll (loads months as you go), capped at 10 years back and your predict-months-ahead setting forward (3 / 6 / 12). Tap a day to log or unlog a period day (or, with flow tracking on, cycle light → medium → heavy → unlog). Logged, predicted, and fertile days each show as a separate bar per cell (rounded only on the outside ends of each run). With flow tracking, logged period bars use fill height for heaviness; where a day is taller than its neighbour in the same run, the top edge rounds on that side (predictions count as full height). Tap the Calendar tab again to jump back to today.
- **Predictions** — next periods are derived from your logged history (rolling average of the last 6 cycles / period lengths), not stored separately. How far ahead they go (3 / 6 / 12 months) is set in Settings.
- **Fertility overlay** — optional ovulation day and fertile window (luteal-phase based). Past cycles use the bright markers; windows ahead of a predicted period use a muted tone, like predicted period days. Toggle in Settings.
- **Exclude periods** — long-press (or right-click) a logged period day to exclude that whole period from averages and predictions (shown with a hatch on the calendar).
- **Log** — periods grouped by year (newest first), with a color legend, cycle bars, and summary stats from the last 6 cycles (avg cycle, avg period, variation). Each row header shows period span with a blood-drop icon, date range, and cycle length (or **Current** for the in-progress cycle). Cycle bars use one shared scale: the longest cycle in view is 100% width. That keeps recent cycles readable — a single unusually long cycle from years ago would otherwise squash every bar since. By default only the most recent 12 cycles are shown (12 / 24 / all in Settings); tap **Show all cycles** at the bottom to load full history and rescale to include those older rows. The current cycle shows logged bleed so far, predicted remaining period days, and predicted ovulation through cycle end. With flow tracking on, period segments in each bar use the same fill heights and step rounding as the calendar.
- **Backup & restore** — export/import JSON (v2: each logged day is `{ "date": "YYYY-MM-DD", "flow": "light"|"heavy" }`; omit `flow` for medium).
- **Installable PWA** — add to your home screen; works offline after the first visit (service worker caches the app shell).
- **Local-only** — state is saved in `localStorage` under `cycle.v1`. Nothing is sent to a server.



## How to run

Serve the folder over HTTP (required for the service worker / install prompt). For example:

```bash
npx serve .
```

Then open the URL in your browser. On mobile, use **Add to Home Screen** / **Install app**. Opening `index.html` via `file://` still works for browsing, but PWA install and offline caching need a local or hosted server.

## Project structure


| File / folder | Role                                           |
| ------------- | ---------------------------------------------- |
| `index.html`  | Markup: calendar, log, settings, and tab bar   |
| `styles.css`  | Design tokens and all UI styles                |
| `app.js`      | State, predictions, rendering, and persistence |
| `manifest.webmanifest` | PWA manifest (name, icons, theme)       |
| `sw.js`       | Service worker — caches the app shell offline  |
| `icons/`      | PWA / branding (`favicon.svg`, install PNGs) |
| `ui/`         | Tab-bar source SVGs (calendar, log, settings — inlined in `index.html`) |




## How it works

1. **Source of truth** — logged period days as `{ date, flow? }` entries (`flow` omitted = medium), excluded days, and settings are persisted. Backups use format version 2 (`"v": 2`).
2. **Periods** — logged bleed days are grouped into period runs. Days separated by at most 3 non-bleeding days still count as one period (e.g. bleed on day 1 and day 3 → one period). Period length is end − start (gap days included). In the log, the cycle bar shows those dry days as muted segments inside the period.
3. **Averages** — cycle length is the mean gap between consecutive *included* period starts; period length is the mean start→end span of recent included periods (dry gap days inside a period count toward length). Excluded periods drop the gaps on either side rather than bridging them.
4. **Forecast** — from the latest period start, cycles are projected forward up to the chosen months-ahead setting (3 / 6 / 12, max 12). Logged days always win over predictions.
5. **Fertility** — ovulation is estimated as period start − 14 days. If that would fall during or before the previous period (e.g. a ~10-day cycle), no fertile window is shown for that cycle — short gaps are often anovulatory, and inventing an ovulation would be misleading. Otherwise the fertile window is ovulation − 5 through ovulation + 1. Markers for logged cycles stay bright; markers for predicted future periods are muted.
6. **Log bar scale** — each row’s cycle bar is drawn against the longest cycle *currently shown*, not your whole history. Limiting the default window (12 or 24 cycles) avoids one old outlier setting the scale for everything; **Show all cycles** deliberately widens the scale to fit the full timeline when you want the complete picture.



## Settings

- **Show ovulation & fertile window** — calendar and log overlays
- **Track flow heaviness** — tap cycles light → medium → heavy → unlog on the calendar; bar height shows heaviness on the calendar and in log period segments (predictions stay full height)
- **First day of week** — Monday or Sunday
- **Predict months ahead** — 3, 6, or 12 months of forecast markers on the calendar; also limits how far forward you can scroll
- **Log cycles shown** — 12, 24, or all cycles in the log by default. Bars share one width scale; this keeps the scale based on recent cycles so old outliers don’t compress them. Use **Show all cycles** at the bottom of the log when you want full history (bars rescale to include older long cycles).
- **Export / Restore JSON** — backup or replace all local data
- **Tips** — short notes on exclude (long-press), jump-to-today, gap days, muted vs bright markers, and local-only data



## Privacy

No accounts, analytics, or tracking. Your data never leaves your device (`localStorage`). The service worker only caches the app files so it works offline. Clear site data or restore a backup to reset. Keep exported JSON files somewhere safe if you care about continuity across devices or browsers.