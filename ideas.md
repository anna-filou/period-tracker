# Ideas & future work

Parking lot for features we might add later. Not committed — just so nothing gets lost.

## Tracking & log

- **Flow stats** — averages or patterns from light/medium/heavy history (log or stats panel).
- **Edit flow from the log** — tap a period segment to cycle heaviness without going back to the calendar.
- **Bleed count clarity** — log header uses period *span* (start→end, gaps included). Consider showing logged bleed days (`p.length`) instead or alongside, if that reads better.

## Import / export

- **Clue importer** — one-time or repeatable import from Clue export JSON (manual migration works for now).
- **Backup nudge on open** — if last export was more than 7 days ago (timestamp in `localStorage`), show a small **non-blocking** callout: floating, **sticky at the top** of the app, dismissible (× or “Not now”). Copy like “Export backup?” with one tap to run the existing export. Not a modal or `confirm()` — must not block the UI. Optional later: interval / off toggle in Settings. See [Scheduled backup (research)](#scheduled-backup-research) for why fully automatic export isn’t feasible.

## Maybe someday

- **Notes** — per-day or per-period notes; might be clutter, TBD.
- **Reminders** — e.g. “log your period”, “period expected soon”. Anna tried PWA reminders before and they were unreliable; worth revisiting with Notification API + service worker, or platform-specific constraints documented first.

## Explicitly out of scope (for now)

- **Symptoms** — too much clutter.
- **Accounts / sync** — stays local-only, independent app.

## Done / won’t do

- **Clear all data in Settings** — only useful while testing; browser “clear site data” or restore empty backup is enough.

---

## Scheduled backup (research)

**Goal:** export a JSON backup about once a week without remembering.

**Hard limit:** browsers almost always require a **user gesture** to start a download. A PWA cannot silently write `hema-backup-YYYY-MM-DD.json` to Downloads while the app is closed — that’s intentional security.

**Chosen direction (when built):** [Backup nudge on open](#import--export) — sticky top callout, dismissible, one tap to export.

**Other options (not planned for v1):**

| Approach | Reliable? | Notes |
| -------- | --------- | ----- |
| **Auto-export when app opens** | Partial | Download on launch without extra tap; still only when user opens the app. |
| **Notification reminder** | Mixed | “Time to back up” via Notification API + service worker. Same reliability issues as other PWA reminders (iOS especially weak). |
| **Periodic Background Sync** | No (broadly) | Chrome-only, installed PWA, not guaranteed timing; still can’t download without UX. |
| **File System Access API** | Partial | User picks a folder once; app could overwrite a file on open — non-trivial, Safari support limited. |

---

## Safety (shipped)

- **Restore confirmation** — confirm before restore overwrites all local data.
