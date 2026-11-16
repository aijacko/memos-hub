# Memos Hub

Sync your [Memos](https://github.com/usememos/memos) into Obsidian — and send notes from Obsidian back to Memos.

Multi-account support, **per-file** and **daily-note** storage, incremental sync, optional **AI cleanup**, tag/archive filtering, attachment download, plus safeguards for locally edited and locally deleted notes.

English | [简体中文](README.md)

---

## Features

### Memos → Obsidian

- **Two storage modes**
  - **Per-file**: one Markdown file per memo, optional year / year-month folders and custom file-name format
  - **Daily note**: memos appended into your Daily Note, updated in place with todo checkbox state preserved
- **Three sync actions**: Smart sync (incremental when a cursor exists, otherwise full), Incremental, Force (rewrite everything and archive memos deleted on the server)
- **Multiple accounts**, each with its own URL, token, sync-days limit and API mode; notes from several accounts in one folder are prefixed with the account name
- **Automatic API detection**: `/api` for Memos 26.10+, `/api/v1` for older servers; the working prefix is cached
- **Incremental filtering** by `updated_ts`, with graceful fallback (`created_ts` → no filter) and client-side re-validation
- **YAML properties**: `memo_id`, `account`, `created`, `updated`, `visibility`, `pinned`, `tags`; any extra keys you add (`status:`, `rating:`, …) are preserved on every rewrite
- **Filters**: include / exclude tags, skip archived memos
- **Attachments** downloaded to a local folder and embedded as `![[...]]`; failed downloads never produce broken links
- **Progress & cancel**: a persistent notice shows the current account and write progress, and the sync can be cancelled

### Obsidian → Memos

| Command | Description |
| --- | --- |
| Quick capture to Memos | Ribbon icon, modal input, private / protected / public |
| Send selection to Memos | Editor context menu; falls back to the current line |
| Send current note to Memos | Editor / file explorer context menu |

With several accounts you pick the target account first; with one account it sends directly.

### Optional AI cleanup

Works with LM Studio, DeepSeek, OpenAI and any OpenAI-compatible endpoint. A customizable prompt can distill memo content during sync, with optional auto-tagging and summaries.

### Data safety

- **Local edit protection**: if a note body was edited locally, the original is backed up to `_冲突/` before being overwritten, and the count is reported after sync
- **Local delete protection**: notes you deleted in your vault are not recreated by later syncs; the ignore list can be cleared in settings
- **Deleted memo archive**: memos removed on the server are moved to `_已删除/` instead of being deleted from your vault
- **Visible failures**: one offline account or invalid token no longer aborts the whole run; the settings page keeps showing which accounts failed and why

---

## Installation

### Community plugins

In Obsidian, open **Settings → Community plugins → Browse**, search for **Memos Hub**, install and enable it.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from [Releases](https://github.com/aijacko/memos-hub/releases)
2. Put them into `<your vault>/.obsidian/plugins/memos-hub/`
3. Restart Obsidian and enable **Memos Hub** under Community plugins

> Desktop only (Windows / macOS / Linux); requires Obsidian 1.8.7 or newer.

---

## Getting started

1. **Create an access token**: Memos → Settings → Access Tokens → Create, then copy the `memos_...` token
2. In Obsidian open **Settings → Memos Hub → Accounts** and fill in:
   - Account name
   - Server URL, e.g. `https://memos.example.com` (self-hosted default: `http://localhost:5230`)
   - API token
3. Click **Test connection** — a successful message also shows the API prefix in use
4. Go to the **Sync** tab, choose a storage mode and run **Smart sync**

---

## Settings overview

| Tab | Contents |
| --- | --- |
| Accounts | Add/remove accounts, server URL, token, API mode, sync-days limit, default sending account |
| Sync | Sync buttons, last-sync time and failures, storage mode, folder layout, file-name format, YAML properties, maintenance, auto sync |
| Filters & automation | Attachment folder, skip images, skip archived, include / exclude tags |
| AI | Provider, model, prompt, auto tags, smart summary |
| About | Intro, repository and issue links, version, restore defaults |

**Auto sync**: sync on startup (on by default, with configurable delay and a "skip if already synced today" option), plus an optional periodic interval in minutes (`0` disables it).

---

## FAQ

**Connection fails / 410 Gone?**
Check that the server URL is reachable. Memos 26.10+ serves `/api` while older versions serve `/api/v1`; leave **API version** on *Auto detect*, or set it manually to match your server.

**My notes were overwritten.**
Files whose body was edited locally are backed up to `_冲突/` (duplicates get a timestamp prefix) before being rewritten. Use **Sync → Maintenance** to open that folder or delete backups older than N days.

**A note I deleted came back.**
Deleted notes are never recreated by later syncs. To restore them, click **Clear ignore list** under Maintenance and the next sync will rebuild them.

**My custom properties disappeared.**
The plugin only rewrites the eight keys it owns and preserves everything else. If you still see issues, please open an issue and include the note's frontmatter.

**Attachments are not downloaded.**
Make sure the attachment folder is writable and **Skip images** is off. Failed downloads are logged as warnings and never create links to missing files.

**I changed the tag filter but old memos did not sync.**
Filters only affect later incremental pulls. Run a **Force sync** to backfill or rewrite everything under the new rules. In daily-note mode, blocks of filtered-out memos are never deleted.

**Privacy**
There is no telemetry. Data only travels between your vault, the Memos server you configure and the optional AI service. Tokens and API keys live in the local `data.json` and never appear in logs or notices.

---

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
```

Build output is `main.js`, `manifest.json`, `styles.css`. Copy them into a test vault's `.obsidian/plugins/memos-hub/` while developing.

---

## Changelog

### 1.0.0

First public release. See [CHANGELOG.md](CHANGELOG.md) for the full list.

- File and daily-note sync modes with smart / incremental / force runs, cancellable and resumable
- Per-account configuration with automatic account prefixes, tag filters, skip-archived and sync-day window
- Local edit and delete protection, `_冲突/` backups and `_已删除/` archive
- Reverse sync: send selection, send current note and quick capture
- AI cleanup with multiple providers, auto tags and summaries
- Bilingual settings UI; 47 automated test cases

---

## License

[MIT](LICENSE)
