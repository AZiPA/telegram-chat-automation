**English** | [فارسی](./README.fa.md)

# Telegram Business Assistant

[![Platform: Telegram Serverless](https://img.shields.io/badge/Platform-Telegram%20Serverless-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org)
[![CLI: @tgcloud/cli ^0.2.0](https://img.shields.io/badge/%40tgcloud%2Fcli-%5E0.2.0-26A5E4)](https://www.npmjs.com/package/@tgcloud/cli)
[![JavaScript: ESM](https://img.shields.io/badge/JavaScript-ESM%20%28V8%20Isolate%29-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Node.js: 26 (CI)](https://img.shields.io/badge/Node.js-26%20%28CI%29-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](./LICENSE)

A personal **Telegram Business** chat automation assistant built for **Telegram Serverless (`@tgcloud/cli`)**. It runs directly on Telegram's serverless V8 runtime with a built-in SQLite database—requiring **no VPS, no containers, and no external hosting**—to archive private Business chats and notify you of deleted messages, message edits, and View-Once media.

> **Bot-Only Project:** This template deploys backend Bot API update handlers only (`tgcloud.jsonc` configures no `"static"` front-end, and there are no Mini App `endpoints/`).

---

## Overview & Key Features

Once connected under **Telegram Business → Chatbots**, the assistant privately archives your 1-on-1 Business conversations and delivers structured reports directly to your private chat with the bot:

- **Deleted Message Recovery & Batch Digests:**
  - Atomically claims incoming deleted messages (`deleted_business_messages`), preventing duplicate notifications on retried webhooks, and uses neutral headers (`🗑 Message Deleted` / `🗑 Messages Deleted`) without speculating who deleted the message.
  - Preserves original formatting (`entities` / `caption_entities`), structured content summaries (`contact`, `location`, `venue`, `poll`, `dice`, etc.), and `forward_origin` metadata.
  - Groups simultaneous multi-message deletions into a single batch header: text/structured items are combined into 4,000-character-safe digests, while media albums (`media_group_id`) are reconstructed in batches of 2–10 items via `sendMediaGroup`.
  - Processes up to `25` archived incoming messages per update (`MAX_DELETE_BATCH = 25`) with an explicit overflow notice, and sends a summary notice when pre-connection unarchived messages are deleted (`NOTIFY_UNARCHIVED_DELETES = true`). Deleting your own outgoing messages (`is_incoming = false`) never produces noise alerts.
- **Silent Edit Tracking (Compact & Entity-Preserving Modes):**
  - Captures edit snapshots in `messages.edit_history` (`edited_business_message`) with optimistic `edit_date` concurrency checks and delivers reports silently (`disable_notification: true`).
  - Filters out false-positive webhook updates (such as Telegram auto-generating a link preview without changing text, entities, media, or metadata) via `isMeaningfulEdit`.
  - Uses **Compact 1-Message Mode** (expandable `<blockquote expandable>` diff) for unformatted text up to 3,000 combined characters, and **3-Message Entity-Preserving Mode** (`🔴 Before:` / `🟢 After:` with shifted UTF-16 entity offsets, plus before/after media copies when `fileUniqueId` changes) for formatted text, long messages, captions, and media replacements.
- **View-Once Media Capture & Hybrid Smart Trigger:**
  - Saves incoming View-Once `photo`, `video`, `voice`, and `video_note` messages when you reply to them **before opening** (even when Telegram initially delivers them as a `view_once_placeholder` without a `file_id`).
  - Automatically falls back to downloading (`<= 20 MB` Bot API limit) and re-uploading via `InputFile` when direct `file_id` forwarding fails, rolling back the DB capture claim on delivery failure so you can retry.
  - **Hybrid Smart Trigger:** *Any* reply captures uncaptured View-Once media; replies that exactly match your configured trigger text (default `.`, case-insensitive) are automatically deleted via `deleteBusinessMessages` when `/autodelete` is `on` and `can_delete_all_messages` is enabled.
- **Per-Contact Private Chat Topics (Threaded Mode) & Fallback:**
  - When **Threaded Mode** is enabled in `@BotFather`, automatically creates and maintains one Forum Topic per contact (`👤 Name (@username)` or `👤 Name [id]`) using atomic DB lease locking (`contact_topics`) to avoid duplicate topics, syncing contact renames and self-healing if a thread is closed or deleted.
  - Automatically falls back to the main private bot chat (with a 10-minute cooldown) when Threaded Mode is unavailable; sending `/start` clears the cooldown immediately.
- **Fail-Closed Single-Owner Security & Clean Rotation:**
  - Ownership is resolved exclusively from `owner_id` in the `settings` table—if unseeded or invalid, `getOwnerId()` returns `null` and every command, connection, and update handler refuses access.
  - Neither `TGCLOUD_TOKEN` nor `OWNER_ID` is hardcoded in source files. Updating `OWNER_ID` automatically cleans up stale `contact_topics`, `connections`, and topic cooldown state for the previous owner while keeping archived `messages` intact.
- **Opportunistic Retention & Opt-In Raw Debug Logging:**
  - Opportunistically prunes archived `messages` older than `30` days (`RETENTION_DAYS`) and `raw_updates` older than `3` days (`RAW_UPDATES_RETENTION_DAYS`) on ~2% of `business_message` updates.
  - `DEBUG_RAW_UPDATES` is `false` by default, so raw update payloads are not stored unless explicitly enabled for troubleshooting.

---

## Architecture & Project Structure

### Runtime Model

- Modules inside `tgcloud/` run inside Telegram Serverless V8 isolates with **zero runtime `node_modules`**, no local filesystem, and no external server process.
- Code imports only the built-in platform `sdk` (`db`, `api`, `fetch`, `InputFile`, `BotApiError`) / `sdk/db` and relative `.js` files inside `tgcloud/`.
- `tgcloud/handlers/` is strictly flat (one level deep). Telegram routes each Bot API update type to the matching handler filename and manages the bot webhook `allowed_updates` automatically on `tgcloud push` / `tgcloud webhook sync`.

### Repository Layout

```text
.
├── .github/
│   └── workflows/
│       └── deploy.yml                  # CI/CD: validate secrets, push, migrate, seed OWNER_ID, sync webhook
├── tgcloud/
│   ├── handlers/                       # Flat official Bot API update handlers
│   │   ├── business_connection.js      # Registers Business connection state & granted rights
│   │   ├── business_message.js         # Archives Business messages & triggers View-Once capture
│   │   ├── deleted_business_messages.js# Delivers single & batch deletion reports + albums
│   │   ├── edited_business_message.js  # Tracks edit history & sends silent diff reports
│   │   └── message.js                  # Handles owner commands (/start, /trigger, /autodelete) & CI bootstrap
│   ├── lib/
│   │   ├── config.js                   # Constants, fail-closed owner auth, labels, rights checklist
│   │   ├── db/                         # Database repositories & retention pruning
│   │   │   ├── connectionRepo.js
│   │   │   ├── maintenance.js
│   │   │   ├── messageRepo.js
│   │   │   ├── settings.js
│   │   │   ├── topicRepo.js
│   │   │   └── viewOnceRepo.js
│   │   ├── delivery/                   # Bot API wrappers, topics, albums, digests, re-upload
│   │   │   ├── albumCopy.js
│   │   │   ├── archiveCopy.js
│   │   │   ├── batchDigest.js
│   │   │   ├── client.js
│   │   │   ├── editReport.js
│   │   │   ├── topics.js
│   │   │   └── viewOnceUpload.js
│   │   ├── media/                      # Content normalization, structured extras, edit diffs, UTF-16 utils
│   │   │   ├── editFormat.js
│   │   │   ├── extractor.js
│   │   │   ├── formatting.js
│   │   │   ├── structured.js
│   │   │   └── textEdit.js
│   │   └── services/                   # Core business logic per update type & command
│   │       ├── businessMessageService.js
│   │       ├── commandService.js
│   │       ├── connectionService.js
│   │       ├── deleteService.js
│   │       ├── editService.js
│   │       ├── startService.js
│   │       ├── viewOnceCommandService.js
│   │       └── viewOnceService.js
│   └── schema.js                       # SQLite tables & indexes (Drizzle-style sdk/db DSL)
├── .gitignore                          # Excludes node_modules/, .env, local CLI state, and logs
├── LICENSE                             # Mozilla Public License 2.0 (MPL-2.0)
├── package.json                        # @tgcloud/cli devDependency & npm scripts (deploy, status, run)
├── README.md                           # English documentation
├── README.fa.md                        # Persian documentation
└── tgcloud.jsonc                       # Bot-only config (no static Mini App hosted)
```

### Update Handlers (`tgcloud/handlers/`)

| Handler File | Telegram Update Type | Responsibility |
|---|---|---|
| [`tgcloud/handlers/message.js`](./tgcloud/handlers/message.js) | `message` | Handles owner private commands (`/start`, `/trigger`, `/autodelete`) and explicit `ci_bootstrap` owner seeding (`ctx.ci_bootstrap === true`). |
| [`tgcloud/handlers/business_connection.js`](./tgcloud/handlers/business_connection.js) | `business_connection` | Verifies the owner, stores connection state and granted `BusinessBotRights` in `connections`, and notifies the owner of connection/permission status. |
| [`tgcloud/handlers/business_message.js`](./tgcloud/handlers/business_message.js) | `business_message` | Archives incoming and outgoing private Business messages, runs opportunistic retention pruning (~2% chance), and triggers View-Once capture on owner replies. |
| [`tgcloud/handlers/edited_business_message.js`](./tgcloud/handlers/edited_business_message.js) | `edited_business_message` | Tracks incoming message edits, ignores no-op updates (e.g., auto link previews), appends snapshots to `edit_history`, and sends silent diff reports. |
| [`tgcloud/handlers/deleted_business_messages.js`](./tgcloud/handlers/deleted_business_messages.js) | `deleted_business_messages` | Claims up to `25` deleted incoming archived messages per update, sends single copies or batch digests/albums, and reports overflow or unarchived deletions. |

### Database Schema (`tgcloud/schema.js`)

| Export / SQL Table | Purpose |
|---|---|
| `connections` (`connections`) | Tracks Telegram Business `connection_id`, owner IDs, `rights` JSON, and `is_enabled` status. |
| `settings` (`settings`) | Stores key-value runtime state: `owner_id`, `view_once_trigger`, `view_once_autodelete`, and `topics_disabled_until`. |
| `messages` (`messages`) | Archives private Business messages (`text`, `caption`, `entities`, `file_id`, `extra` metadata, `edit_history`, `notified_delete_at`, `view_once_captured_at`) indexed uniquely by `(business_connection_id, chat_id, message_id)`. |
| `rawUpdates` (`raw_updates`) | Optional debug store for raw update payloads (written only when `DEBUG_RAW_UPDATES` is `true`; pruned after 3 days). |
| `contactTopics` (`contact_topics`) | Maps each contact `peer_id` to its Private Chat Forum `thread_id` with atomic lease locking (`status`: `'creating' \| 'ready'`). |

---

## Quick Start & Deployment

### Prerequisites (`@BotFather` Setup)

1. **Telegram Business Access:** Connecting chatbots under **Telegram Business** requires a Telegram account with Telegram Business / Premium features enabled.
2. **Create a Bot & Enable Serverless:**
   - Open [@BotFather](https://t.me/BotFather) and create a new bot (or open an existing bot you own).
   - Navigate to **Your Bot → Serverless** and turn **Serverless** on.
3. **Copy Your Serverless CLI Access Token:**
   - Go to **@BotFather → Your Bot → Serverless → CLI Access → Access token**.
   - Copy the token, which has the format `app<id>:<secret>`.
   > **Warning:** Use the **Serverless CLI Access Token** (`app<id>:<secret>`), **NOT** your standard Bot API HTTP token (`123456789:AAH...`). Standard HTTP tokens will fail authentication and secret validation.
4. **Configure Bot Mode & Privacy in `@BotFather`:**
   - **Bot Settings → Business Mode:** Turn **Business Mode** **ON** so Telegram allows linking the bot as a Business Chatbot.
   - **Bot Settings → Allow Groups:** Turn **Allow Groups** **OFF** to keep the bot restricted to private chats.
   - **Bot Settings → Threads Settings → Threaded Mode** *(Optional, Recommended)*: Turn **Threaded Mode** **ON** so the bot can create a dedicated topic per contact inside your private bot chat.
5. **Get Your Numeric Telegram User ID (`OWNER_ID`):**
   - Look up your positive integer Telegram user ID (for example, via `@userinfobot`). It must be digits only (e.g., `123456789`, without `@` or spaces).

---

### Option 1: Deploy via GitHub Actions (Recommended — Zero Local Setup)

The included workflow ([`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)) automates code deployment, schema migration, owner bootstrapping, and webhook synchronization on every `push` or manual `workflow_dispatch`.

#### Step 1: Fork or Use This Template

Create your own copy of this repository on GitHub using **Use this template** or **Fork**.

#### Step 2: Configure GitHub Repository Secrets

In your GitHub repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add both required secrets:

| Secret Name | Format / Rule | Description |
|---|---|---|
| `TGCLOUD_TOKEN` | `^app[0-9]+:[^[:space:]]+$` | Serverless CLI Access token from `@BotFather → Serverless → CLI Access`. |
| `OWNER_ID` | `^[1-9][0-9]*$` | Your numeric Telegram user ID (positive integer, digits only). |

> **Fail-Fast Validation:** The workflow validates both `TGCLOUD_TOKEN` and `OWNER_ID` in its first step and refuses to deploy if either secret is missing or malformed.

#### Step 3: Run the Workflow

The workflow runs automatically on every `push`, or manually under **Actions → ✈️ Deploy to Telegram → Run workflow**.

On manual `workflow_dispatch`, you can choose `migration_mode`:

| `migration_mode` | CLI Flag | Behavior |
|---|---|---|
| `safe` *(default, and used on `push`)* | `--safe` | Applies additive, non-destructive schema changes (new tables, columns, indexes); skips warning-level drops. |
| `dry-run` | `--dry-run` | Prints pending schema differences without modifying the live database. |
| `skip` | *(step skipped)* | Skips `npx tgcloud migrate` completely. |
| `yes` | `--yes` | Automatically applies both safe changes and warning-level drops (use with caution). |

Workflow execution sequence (Node.js `26`):
1. Validates `TGCLOUD_TOKEN` and `OWNER_ID`.
2. Installs `@tgcloud/cli` via `npm install --no-audit --no-fund`.
3. Pushes modules via `npx tgcloud push --force`.
4. Runs `npx tgcloud migrate --<migration_mode>` (unless `skip`).
5. Seeds `OWNER_ID` into `settings` via `npx tgcloud run handlers/message "{owner_id: ${OWNER_ID}}" --ctx '{ci_bootstrap: true}'`.
6. Synchronizes and prints webhook status via `npx tgcloud webhook sync` and `npx tgcloud webhook`.

> **Owner Rotation:** If you change `OWNER_ID` in GitHub Secrets and re-run the workflow, `setOwnerId()` automatically updates ownership and cleans up stale `contact_topics`, `connections`, and `topics_disabled_until` rows from the previous owner while preserving archived `messages`.

---

### Option 2: Local Deployment via `@tgcloud/cli`

Requires **Node.js 18+** locally (CI uses Node.js `26`).

#### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/AZiPA/telegram-chat-automation.git
cd telegram-chat-automation
npm install
```

#### Step 2: Link Your Bot (`tgcloud login`)

```bash
npx tgcloud login
```

Paste your `app<id>:<secret>` CLI Access token when prompted. Credentials are stored locally in the gitignored CLI state folder.

#### Step 3: Push Code & Apply Database Migrations

```bash
npx tgcloud push       # Or: npm run deploy
npx tgcloud migrate
```

> **Important:** `npx tgcloud push` (and `npm run deploy`, which is a shorthand for `tgcloud push`) deploys JavaScript modules only and **never modifies the database**. Always run `npx tgcloud migrate` to create or update the SQLite tables.

#### Step 4: Bootstrap `OWNER_ID` (Mandatory)

Because access control is **fail-closed**, the bot ignores all Telegram updates and commands until `owner_id` is seeded into `settings`. Replace `123456789` with your numeric Telegram user ID:

**Bash / macOS / Linux:**

```bash
npx tgcloud run handlers/message '{owner_id: 123456789}' --ctx '{ci_bootstrap: true}'
```

**Windows CMD:**

```cmd
npx tgcloud run handlers/message "{owner_id: 123456789}" --ctx "{ci_bootstrap: true}"
```

Expected output includes `{ ok: true }`.

#### Step 5: Verify Webhook Synchronization

```bash
npx tgcloud webhook
```

If the webhook is out of sync with your 5 deployed handlers, run `npx tgcloud webhook sync`.

---

## Post-Deploy Activation in Telegram (Critical Order)

Follow these steps **in exact order** after deploying:

1. **Send `/start` to your bot in private chat first:**
   - Telegram does not allow a bot to initiate private messages to you until you message it first.
   - Sending `/start` verifies that `OWNER_ID` was seeded properly and displays the **🤖 Telegram Business Assistant Status** dashboard.
2. **Connect the bot under Telegram Business:**
   - Open **Telegram Settings → Telegram Business → Chatbots**.
   - Add your bot and grant the required `BusinessBotRights`:
     - `can_read_messages` — **Read messages** *(required to archive incoming/outgoing messages, edits, and deletions)*
     - `can_reply` — **Send and reply to messages** *(allows the bot to operate inside Business chats)*
     - `can_delete_sent_messages` — **Delete messages sent by the bot**
     - `can_delete_all_messages` — **Delete all messages** *(required to auto-delete exact View-Once trigger replies; shown as **Delete Received Messages** in Telegram's Chat Automation UI)*
3. **Confirm connection status:**
   - Your bot immediately sends a **🔗 Telegram Business Connected** notice indicating whether `can_read_messages` and `can_delete_all_messages` are active. You can re-check permissions anytime with `/start`.

### Per-Chat Pause & Resume

Inside any individual Business conversation, you can temporarily pause or resume the bot directly from Telegram Business's native top-bar **Stop / Start** toggle without removing the bot globally. Disabling the bot in **Telegram Business → Chatbots** sets `is_enabled = false` in `connections`, causing all Business handlers to ignore updates immediately.

---

## Bot Commands & Configuration

### Owner Commands (Private Chat Only)

All commands are restricted strictly to the configured `OWNER_ID` in private chat; non-owners and group chats are silently ignored.

| Command | Description |
|---|---|
| `/start` | Clears any active 10-minute topic cooldown and displays the status dashboard (registered connections, granted permissions, active contact topics count, View-Once trigger settings). When opened via a `bizChat<chatId>` Business deep link, also shows a **Contact Archive Summary** with archived message count and topic status for that contact. |
| `/trigger` | Displays the current View-Once trigger text (`default: .`), auto-delete state, and usage instructions. |
| `/trigger <text>` | Sets a custom single-line trigger text (1–32 characters, case-insensitive match). Any reply to uncaptured View-Once media still saves it; exact trigger matches are eligible for auto-deletion. |
| `/trigger reset` | Resets the View-Once trigger text back to `.`. |
| `/autodelete` | Shows whether auto-deletion of exact trigger replies is enabled (`default: enabled`) and warns if `can_delete_all_messages` is missing. |
| `/autodelete on` | Enables auto-deletion of exact trigger replies after successful View-Once media capture. |
| `/autodelete off` | Disables auto-deletion so trigger replies stay in the chat while View-Once capture remains active on any reply. |

### Runtime Configuration (`tgcloud/lib/config.js`)

| Constant | Default | Purpose |
|---|---|---|
| `RETENTION_DAYS` | `30` | Days before archived `messages` are opportunistically pruned (~2% of `business_message` updates). |
| `RAW_UPDATES_RETENTION_DAYS` | `3` | Days before `raw_updates` debug records are pruned. |
| `DEFAULT_VIEW_ONCE_TRIGGER` | `'.'` | Fallback trigger text when not overridden by `/trigger`. |
| `MAX_TRIGGER_LENGTH` | `32` | Maximum character length for custom View-Once triggers. |
| `DELETE_TRIGGER_REPLY` | `true` | Fallback auto-delete behavior when not overridden by `/autodelete`. |
| `CAPTURE_UNARCHIVED_REPLIES` | `true` | Allows capturing View-Once media from `reply_to_message` even if the original message wasn't archived first. |
| `NOTIFY_UNARCHIVED_DELETES` | `true` | Sends a summary notice when pre-connection unarchived messages are deleted. |
| `MAX_DELETE_BATCH` | `25` | Maximum incoming archived messages claimed and delivered per `deleted_business_messages` update. |
| `MAX_GETFILE_BYTES` | `20971520` (20 MB) | Telegram Bot API download cap enforced before View-Once re-upload fallback. |
| `DEBUG_RAW_UPDATES` | `false` | Disabled by default. Enable only temporarily if debugging raw update payloads in `raw_updates`. |

---

## Database Migrations, Maintenance & Privacy Notice

### Routine Maintenance Commands

```bash
npx tgcloud status         # Or: npm run status (compare local modules vs. cloud)
npx tgcloud push           # Or: npm run deploy (deploy code only; never alters DB)
npx tgcloud migrate        # Interactively review & apply schema.js changes (--dry-run, --safe, --yes)
npx tgcloud webhook        # Check platform-managed webhook & allowed_updates sync
npx tgcloud webhook sync   # Repair webhook if handlers changed or webhook drifted
```

### Telegram Serverless Schema Rules

If you customize [`tgcloud/schema.js`](./tgcloud/schema.js):
- **No foreign keys:** The Serverless SQLite runtime runs with `PRAGMA foreign_keys` off, so `.references()` and `foreignKey()` throw at declaration. Enforce relationships in application code.
- **Drop via `.deprecated('reason')`:** Deleting a column or table from `schema.js` does not drop it automatically. Mark it `.deprecated('reason')` first, deploy, and confirm the drop during `npx tgcloud migrate`.
- **Manual type changes:** Changing an existing column's SQLite type is not automatic and must be performed manually with `db.run(...)`.

### Privacy & Policy Notice

This bot is intended for **personal, single-owner automation** on your own Telegram Business account. Archived message texts, captions, metadata, and file references are persisted in your bot's Telegram Serverless database according to `RETENTION_DAYS` (`30` days). You are responsible for ensuring your deployment and usage comply with Telegram's Terms of Service, Bot Developer Terms, and applicable privacy or consent laws in your jurisdiction.

---

## Contributing & License

Contributions, bug fixes, and pull requests are welcome! When modifying files under `tgcloud/`:
- Keep all imports relative with explicit `.js` extensions (or from `'sdk'` / `'sdk/db'`).
- Do not introduce runtime `npm` dependencies inside `tgcloud/`.
- Keep `tgcloud/handlers/` strictly flat (one level deep, matching official Telegram Bot API update names).

**License:** This project is licensed under the [Mozilla Public License 2.0 (MPL-2.0)](./LICENSE). Note that [`package.json`](./package.json) remains marked `"private": true` as a bot deployment project rather than an npm-published package.
