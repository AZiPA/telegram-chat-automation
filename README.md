**English** | [فارسی](./README.fa.md)

# Telegram Business Assistant — Deleted, Edited & View-Once Tracker

[![Live Docs](https://img.shields.io/badge/Docs-Live%20Guide-0A7EA4)](https://azipa.github.io/projects/chat-automation/)
[![Platform: Telegram Serverless](https://img.shields.io/badge/Platform-Telegram%20Serverless-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org)
[![CLI: @tgcloud/cli ^0.2.0](https://img.shields.io/badge/%40tgcloud%2Fcli-%5E0.2.0-26A5E4)](https://www.npmjs.com/package/@tgcloud/cli)
[![Node.js: 26 (CI)](https://img.shields.io/badge/Node.js-26%20%28CI%29-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](./LICENSE)

A personal **Telegram Business bot** (also known as **Telegram Secretary**) running natively on **Telegram Serverless** (`@tgcloud/cli`) with **built-in SQLite** and **zero VPS** or external hosting. Once connected, this bot-only assistant (no Mini App required) privately archives 1-on-1 Business chats to **recover deleted Telegram messages**, **track edited messages** silently, and **save View-Once media**.

> [!NOTE]
> **Scope:** The bot only archives and recovers messages received **after** it is connected to your Telegram Business account; retroactive recovery of older pre-connection messages is not possible.

## Quick Start — Deploy in 2 Minutes (GitHub Actions)

1. **Prepare your bot in `@BotFather`:** Enable **Serverless** and **Business Mode** (disable **Allow Groups**; optionally enable **Threaded Mode** for per-contact topics), then copy your **CLI Access Token** (`app<id>:<secret>` from `Serverless → CLI Access` — NOT the standard Bot API HTTP token). In the [`@BotFather`](https://t.me/BotFather) Mini App (`Bot Settings → Access`), enable **Restrict bot usage** and verify your `OWNER_ID` account is in **Allowed users** (required explicitly if created on a different account).
2. **Fork the repository:** Click **Fork** on [AZiPA/telegram-chat-automation](https://github.com/AZiPA/telegram-chat-automation) to create your own copy.
3. **Add Repository Secrets:** Go to **Settings → Secrets and variables → Actions** and add `TGCLOUD_TOKEN` (`app<id>:<secret>`) and `OWNER_ID` (your positive numeric Telegram user ID).
4. **Deploy & Activate:** Run **Actions → ✈️ Deploy to Telegram → Run workflow** (or push a commit), send `/start` to your bot in private chat **first**, then connect the bot under **Telegram Settings → Telegram Business → Chatbots** with read and delete permissions.

**See the [Setup & Deployment Guide](https://azipa.github.io/projects/chat-automation/setup/) for full `@BotFather` steps, GitHub Actions `migration_mode` options (`safe`, `dry-run`, `skip`, `yes`), local `@tgcloud/cli` deployment (Bash & Windows CMD), and required `BusinessBotRights`.**

## Key Features

- **Deleted Message Recovery & Media Albums:** Recovers deleted 1-on-1 messages with neutral headers, batch digests, preserved text formatting, `forward_origin` metadata, and reconstructed media albums.
- **Silent Edit Tracking:** Captures edits silently using compact expandable diffs or entity-preserving before/after snapshots while filtering out no-op updates like automatic link previews.
- **View-Once Media Saver & Smart Auto-Delete Trigger:** Saves incoming View-Once media (photo, video, voice, and video note) when you reply before opening, with optional automatic cleanup for exact trigger matches (`/trigger`, `/autodelete`).
- **Per-Contact Private Chat Topics:** Automatically creates and maintains a dedicated Forum Topic per contact when **Threaded Mode** topics are enabled, with graceful fallback to your main private bot chat.
- **Fail-Closed Single-Owner Security:** Stores zero hardcoded credentials, locks every command and update strictly to `OWNER_ID`, and rotates ownership cleanly without losing archived messages.
- **Zero-VPS Telegram Serverless + Built-In SQLite:** Bot-only runtime executing on Telegram's V8 isolate with built-in SQLite storage and automatic retention pruning (`30` days by default).

## Full Documentation Hub

| Documentation Section | What It Covers |
|---|---|
| [Overview & Features](https://azipa.github.io/projects/chat-automation/) | Deleted recovery, silent edits, View-Once capture, topics, and scope |
| [Setup, GitHub Actions & Local CLI Deployment](https://azipa.github.io/projects/chat-automation/setup/) | Full `@BotFather` guide, CI `migration_mode`, local `@tgcloud/cli`, and `BusinessBotRights` |
| [Owner Commands & Runtime Configuration](https://azipa.github.io/projects/chat-automation/commands-config/) | `/start`, `/trigger`, `/autodelete`, and `tgcloud/lib/config.js` constants |
| [Architecture, SQLite Schema & Database Migrations](https://azipa.github.io/projects/chat-automation/architecture/) | V8 isolate layout, 5 handlers, SQLite tables, and `tgcloud migrate` rules |

## Privacy & License

This bot is intended strictly for personal, single-owner automation on your own Telegram Business account. Operators are responsible for complying with applicable local privacy/consent laws and Telegram's Terms of Service.

Licensed under the [Mozilla Public License 2.0 (MPL-2.0)](./LICENSE).
