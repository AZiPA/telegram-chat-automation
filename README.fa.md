<div dir="rtl">

[English](./README.md) | **فارسی**

# دستیار هوشمند تلگرام بیزینس (Telegram Business Assistant)

[![Platform: Telegram Serverless](https://img.shields.io/badge/Platform-Telegram%20Serverless-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org)
[![CLI: @tgcloud/cli ^0.2.0](https://img.shields.io/badge/%40tgcloud%2Fcli-%5E0.2.0-26A5E4)](https://www.npmjs.com/package/@tgcloud/cli)
[![JavaScript: ESM](https://img.shields.io/badge/JavaScript-ESM%20%28V8%20Isolate%29-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Node.js: 26 (CI)](https://img.shields.io/badge/Node.js-26%20%28CI%29-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](./LICENSE)

یک دستیار شخصی اتوماسیون چت برای **Telegram Business**، ساخته‌شده بر بستر **Telegram Serverless (`@tgcloud/cli`)**. این ربات به‌صورت مستقیم روی رانتایم ایزوله V8 تلگرام همراه با دیتابیس داخلی SQLite اجرا می‌شود — **بدون نیاز به VPS، کانتینر یا هاست خارجی** — تا گفتگوهای خصوصی بیزینس شما را آرشیو کند و در زمان حذف پیام، ویرایش پیام و ارسال رسانه‌های یک‌بارمصرف (`View-Once`) به شما اطلاع دهد.

> **پروژه صرفاً ربات (Bot-Only):** این قالب فقط هندلرهای سمت سرور Bot API را دیپلوی می‌کند (در `tgcloud.jsonc` هیچ فرانت‌اند `"static"` تعریف نشده و هیچ پوشه `endpoints/` برای Mini App وجود ندارد).

---

## معرفی و قابلیت‌های کلیدی

پس از اتصال ربات در بخش **Telegram Business → Chatbots**، این دستیار گفتگوهای خصوصی دونفره (1-on-1) حساب بیزینس شما را به‌صورت محرمانه آرشیو کرده و گزارش‌های ساختاریافته را مستقیماً به چت خصوصی خودتان با ربات ارسال می‌کند:

- **بازیابی پیام‌های حذف‌شده و خلاصه دسته‌ای (Batch Digest):**
  - پیام‌های ورودی حذف‌شده (`deleted_business_messages`) را به‌صورت اتمیک در دیتابیس ثبت می‌کند تا در صورت ارسال مجدد Webhook اعلان تکراری نفرستد، و با هدرهای خنثی (`🗑 Message Deleted` / `🗑 Messages Deleted`) بدون حدس‌زدن اینکه چه کسی پیام را پاک کرده گزارش می‌دهد.
  - فرمت‌بندی اصلی (`entities` / `caption_entities`)، خلاصه محتوای ساختاریافته (`contact`، `location`، `venue`، `poll`، `dice` و موارد مشابه) و اطلاعات پیام‌های فورواردی (`forward_origin`) را حفظ می‌کند.
  - پیام‌های حذف‌شده هم‌زمان را زیر یک هدر واحد گروه‌بندی می‌کند: پیام‌های متنی/سایر در قالب یک خلاصه متنی (با تقسیم ایمن ۴۰۰۰ کاراکتری) تجمیع می‌شوند و آلبوم‌های رسانه (`media_group_id`) در بسته‌های ۲ تا ۱۰ تایی با `sendMediaGroup` بازسازی می‌گردند.
  - در هر آپدیت حداکثر `25` پیام ورودی آرشیوشده را پردازش می‌کند (`MAX_DELETE_BATCH = 25`) و در صورت بیشتر بودن تعداد، هشدار سرریز می‌فرستد؛ همچنین حذف پیام‌های قدیمیِ پیش از اتصال ربات را در یک اعلان خلاصه گزارش می‌دهد (`NOTIFY_UNARCHIVED_DELETES = true`). حذف پیام‌های ارسالی خود شما (`is_incoming = false`) هرگز هشدار اضافه تولید نمی‌کند.
- **ردیابی بی‌صدای ویرایش‌ها (حالت فشرده و حالت حفظ Entities):**
  - تاریخچه تغییرات را در `messages.edit_history` (`edited_business_message`) با کنترل هم‌زمانی خوش‌بینانه روی `edit_date` ثبت می‌کند و گزارش‌ها را به‌صورت بی‌صدا (`disable_notification: true`) می‌فرستد.
  - آپدیت‌های کاذب تلگرام (مانند ساخت خودکار پیش‌نمایش لینک بدون تغییر متن، فرمت، رسانه یا فراداده) را از طریق `isMeaningfulEdit` فیلتر می‌کند.
  - برای متن‌های ساده بدون `entities` تا مجموع ۳۰۰۰ کاراکتر از **حالت فشرده تک‌پیامی** (`<blockquote expandable>`) استفاده می‌کند، و برای متن‌های فرمت‌دار، متن‌های طولانی، کپشن‌ها و جایگزینی رسانه از **حالت ۳ پیامی با حفظ Entities** (`🔴 Before:` / `🟢 After:` همراه با جابه‌جایی دقیق آفست‌های UTF-16، و ارسال فایل قبلی و جدید در صورت تغییر `fileUniqueId`) بهره می‌برد.
- **ذخیره رسانه‌های یک‌بارمصرف (`View-Once`) و محرک هوشمند ترکیبی:**
  - عکس (`photo`)، ویدیو (`video`)، ویس (`voice`) و پیام ویدیویی گرد (`video_note`) یک‌بارمصرف را هنگامی که **پیش از باز کردن** روی آن‌ها ریپلای کنید ذخیره می‌کند (حتی اگر تلگرام در لحظه ورود `file_id` را پنهان کرده و پیام را به‌صورت `view_once_placeholder` ثبت کرده باشد).
  - در صورت خطا در ارسال مستقیم با `file_id`، به‌طور خودکار فایل را (تا سقف `20 MB` محدودیت دانلود Bot API) دریافت کرده و با `InputFile` مجدداً آپلود می‌کند؛ و اگر تحویل ناموفق بود، وضعیت ثبت در دیتابیس را برمی‌گرداند (Rollback) تا امکان تلاش مجدد وجود داشته باشد.
  - **محرک هوشمند ترکیبی (Hybrid Smart Trigger):** *هر* ریپلایی روی رسانه یک‌بارمصرف آن را ذخیره می‌کند، اما ریپلای‌هایی که دقیقاً با متن محرک تنظیم‌شده مطابقت داشته باشند (پیش‌فرض `.`، بدون حساسیت به حروف بزرگ/کوچک) پس از ذخیره موفق، در صورت فعال بودن `/autodelete on` و دسترسی `can_delete_all_messages`، به‌صورت خودکار با `deleteBusinessMessages` پاک می‌شوند.
- **تاپیک اختصاصی برای هر مخاطب (`Threaded Mode`) با جایگزین خودکار:**
  - در صورت فعال بودن **Threaded Mode** در `@BotFather`، به‌ازای هر مخاطب یک Forum Topic اختصاصی (`👤 Name (@username)` یا `👤 Name [id]`) با قفل اتمیک دیتابیس (`contact_topics`) می‌سازد تا تاپیک تکراری ایجاد نشود، تغییر نام مخاطب را همگام می‌کند و اگر تاپیکی حذف یا بسته شود به‌صورت خودکار آن را بازسازی (Self-heal) می‌نماید.
  - اگر `Threaded Mode` غیرفعال باشد، یک وقفه ۱۰ دقیقه‌ای ثبت کرده و پیام‌ها را بی‌وقفه در چت اصلی ربات تحویل می‌دهد؛ ارسال `/start` این وقفه را بلافاصله پاک می‌کند.
- **امنیت Fail-Closed تک‌مالک و جابه‌جایی تمیز مالکیت:**
  - هویت مالک منحصراً از کلید `owner_id` در جدول `settings` خوانده می‌شود؛ اگر این مقدار تنظیم نشده یا نامعتبر باشد، `getOwnerId()` مقدار `null` برمی‌گرداند و تمامی دستورات، اتصال‌ها و هندلرها مسدود می‌مانند.
  - هیچ توکن یا شناسه‌ای (`TGCLOUD_TOKEN` یا `OWNER_ID`) در کد منبع هاردکد نشده است. تغییر `OWNER_ID` به‌طور خودکار داده‌های وابسته به مالک قبلی (`contact_topics`، `connections` و وقفه تاپیک‌ها) را پاک‌سازی می‌کند و در عین حال جدول آرشیو `messages` را دست‌نخورده نگه می‌دارد.
- **پاک‌سازی دوره‌ای و لاگ اختیاری آپدیت‌های خام:**
  - پیام‌های آرشیوشده قدیمی‌تر از `30` روز (`RETENTION_DAYS`) و لاگ‌های `raw_updates` قدیمی‌تر از `3` روز (`RAW_UPDATES_RETENTION_DAYS`) را به‌صورت تصادفی در ~۲٪ از رویدادهای `business_message` پاک‌سازی می‌کند.
  - گزینه `DEBUG_RAW_UPDATES` به‌صورت پیش‌فرض `false` است؛ بنابراین تا زمانی که برای خطایابی فعال نشود، آپدیت‌های خام ذخیره نمی‌شوند.

---

## معماری و ساختار پروژه

### مدل اجرایی Telegram Serverless

- کدهای داخل پوشه `tgcloud/` درون محیط ایزوله V8 پلتفرم Telegram Serverless اجرا می‌شوند و در زمان اجرا **هیچ `node_modules`، فایل‌سیستم محلی یا سرور مستقلی** وجود ندارد.
- ماژول‌ها فقط مجاز به ایمپورت `sdk` داخلی پلتفرم (`db`، `api`، `fetch`، `InputFile`، `BotApiError`) / `sdk/db` و فایل‌های نسبی با پسوند `.js` داخل `tgcloud/` هستند.
- ساختار `tgcloud/handlers/` باید کاملاً مسطح (یک سطح) باشد. تلگرام هر نوع آپدیت Bot API را به فایل همنام آن هدایت کرده و `allowed_updates` وب‌هوک را به‌صورت خودکار با دستور `tgcloud push` / `tgcloud webhook sync` تنظیم می‌کند.

### ساختار پوشه‌های مخزن

</div>

<div dir="ltr">

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

</div>

<div dir="rtl">

### هندلرهای آپدیت (`tgcloud/handlers/`)

| فایل Handler | نوع آپدیت تلگرام | وظیفه |
|---|---|---|
| [`tgcloud/handlers/message.js`](./tgcloud/handlers/message.js) | `message` | پردازش دستورات خصوصی مالک (`/start`، `/trigger`، `/autodelete`) و ثبت اولیه مالک از طریق `ci_bootstrap` (`ctx.ci_bootstrap === true`). |
| [`tgcloud/handlers/business_connection.js`](./tgcloud/handlers/business_connection.js) | `business_connection` | احراز هویت مالک، ذخیره وضعیت اتصال و دسترسی‌های `BusinessBotRights` در جدول `connections` و ارسال وضعیت اتصال به مالک. |
| [`tgcloud/handlers/business_message.js`](./tgcloud/handlers/business_message.js) | `business_message` | آرشیو پیام‌های ورودی و خروجی چت خصوصی بیزینس، پاک‌سازی دوره‌ای تصادفی (~۲٪) و فعال‌سازی ضبط `View-Once` هنگام ریپلای مالک. |
| [`tgcloud/handlers/edited_business_message.js`](./tgcloud/handlers/edited_business_message.js) | `edited_business_message` | ردیابی ویرایش پیام‌های ورودی، فیلترکردن آپدیت‌های بی‌تغییر (مثل پیش‌نمایش لینک)، ثبت در `edit_history` و ارسال گزارش بی‌صدا. |
| [`tgcloud/handlers/deleted_business_messages.js`](./tgcloud/handlers/deleted_business_messages.js) | `deleted_business_messages` | ثبت اتمیک تا `25` پیام ورودی حذف‌شده در هر آپدیت، ارسال کپی تکی یا خلاصه دسته‌ای/آلبوم و گزارش سرریز یا پیام‌های آرشیونشده. |

### ساختار دیتابیس (`tgcloud/schema.js`)

| Export / نام جدول SQL | کاربرد |
|---|---|
| `connections` (`connections`) | نگهداری `connection_id`، شناسه‌های مالک، JSON دسترسی‌ها (`rights`) و وضعیت فعال/غیرفعال (`is_enabled`). |
| `settings` (`settings`) | تنظیمات کلید-مقدار زمان اجرا: `owner_id`، `view_once_trigger`، `view_once_autodelete` و `topics_disabled_until`. |
| `messages` (`messages`) | آرشیو پیام‌های خصوصی بیزینس (`text`، `caption`، `entities`، `file_id`، فراداده `extra`، `edit_history`، `notified_delete_at`، `view_once_captured_at`) با ایندکس یکتای `(business_connection_id, chat_id, message_id)`. |
| `rawUpdates` (`raw_updates`) | مخزن اختیاری برای دیباگ آپدیت‌های خام (تنها در صورت `DEBUG_RAW_UPDATES = true` نوشته می‌شود و پس از ۳ روز حذف می‌گردد). |
| `contactTopics` (`contact_topics`) | نگاشت `peer_id` هر مخاطب به `thread_id` تاپیک چت خصوصی همراه با قفل اتمیک (`status`: `'creating' \| 'ready'`). |

---

## راه‌اندازی سریع و دیپلوی

### پیش‌نیازها (تنظیمات `@BotFather`)

1. **اشتراک Telegram Business:** اتصال ربات در بخش **Telegram Business** نیازمند اکانت تلگرام دارای قابلیت‌های Telegram Business / Premium است.
2. **ساخت ربات و فعال‌سازی Serverless:**
   - در تلگرام وارد [@BotFather](https://t.me/BotFather) شوید و یک ربات جدید بسازید (یا ربات فعلی خود را انتخاب کنید).
   - به بخش **Your Bot → Serverless** بروید و **Serverless** را روشن (On) کنید.
3. **دریافت توکن دسترسی CLI:**
   - به مسیر **@BotFather → Your Bot → Serverless → CLI Access → Access token** بروید.
   - توکن با فرمت `app<id>:<secret>` را کپی کنید.
   > **هشدار مهم:** این توکن، **Serverless CLI Access Token** (`app<id>:<secret>`) است و با توکن معمولی HTTP بات (`123456789:AAH...`) تفاوت دارد. استفاده از توکن معمولی Bot API باعث خطای احراز هویت می‌شود.
4. **تنظیمات ربات در `@BotFather`:**
   - **Bot Settings → Business Mode:** گزینه **Business Mode** را **روشن (ON)** کنید تا امکان اتصال ربات به حساب بیزینس فعال شود.
   - **Bot Settings → Allow Groups:** برای حفظ حریم خصوصی، گزینه **Allow Groups** را **خاموش (OFF)** کنید تا ربات فقط در چت خصوصی کار کند.
   - **Bot Settings → Threads Settings → Threaded Mode** *(اختیاری، پیشنهادی)*: گزینه **Threaded Mode** را **روشن (ON)** کنید تا برای هر مخاطب یک تاپیک مجزا درون چت ربات ساخته شود.
5. **دریافت شناسه عددی تلگرام خودتان (`OWNER_ID`):**
   - شناسه عددی مثبت اکانت تلگرام خود را به‌دست آورید (مثلاً از طریق ربات‌هایی مثل `@userinfobot`). این مقدار باید فقط شامل رقم باشد (مانند `123456789` و بدون `@` یا فاصله).

---

### روش اول: دیپلوی با GitHub Actions (پیشنهادی — بدون نیاز به ابزار محلی)

ورک‌فلو آماده ([`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)) کل فرایند دیپلوی ماژول‌ها، مایگریشن دیتابیس، ثبت شناسه مالک و همگام‌سازی وب‌هوک را با هر `push` یا اجرای دستی (`workflow_dispatch`) به‌صورت خودکار انجام می‌دهد.

#### گام ۱: Fork یا ساخت مخزن از Template

با استفاده از دکمه **Use this template** یا **Fork** یک نسخه شخصی از این مخزن در حساب گیت‌هاب خود ایجاد کنید.

#### گام ۲: تنظیم Secrets در مخزن گیت‌هاب

در مخزن خود به مسیر **Settings → Secrets and variables → Actions → New repository secret** بروید و دو Secret زیر را تعریف کنید:

| نام Secret | فرمت معتبر | توضیح |
|---|---|---|
| `TGCLOUD_TOKEN` | `^app[0-9]+:[^[:space:]]+$` | توکن `CLI Access` دریافت‌شده از `@BotFather → Serverless → CLI Access`. |
| `OWNER_ID` | `^[1-9][0-9]*$` | شناسه عددی اکانت تلگرام شما (عدد صحیح مثبت، فقط ارقام). |

> **اعتبارسنجی سریع (Fail-Fast):** ورک‌فلو در همان گام نخست هر دو Secret را بررسی می‌کند و در صورت نبود یا نامعتبر بودن هر یک، بلافاصله متوقف می‌شود.

#### گام ۳: اجرای ورک‌فلو

ورک‌فلو با هر `push` به‌صورت خودکار اجرا می‌شود، یا می‌توانید به‌صورت دستی از مسیر **Actions → ✈️ Deploy to Telegram → Run workflow** آن را اجرا کنید.

در اجرای دستی (`workflow_dispatch`) امکان انتخاب `migration_mode` وجود دارد:

| مقدار `migration_mode` | فلگ CLI | عملکرد |
|---|---|---|
| `safe` *(پیش‌فرض و حالت `push`)* | `--safe` | تغییرات ایمن و افزایشی (جدول، ستون یا ایندکس جدید) را اعمال می‌کند و از تغییرات دارای هشدار عبور می‌نماید. |
| `dry-run` | `--dry-run` | تغییرات در انتظار دیتابیس را بدون اعمال واقعی نمایش می‌دهد. |
| `skip` | *(رد شدن گام)* | مرحله `npx tgcloud migrate` را به‌کل نادیده می‌گیرد. |
| `yes` | `--yes` | هم تغییرات ایمن و هم تغییرات دارای هشدار (مانند حذف ستون/جدول) را خودکار اعمال می‌کند (با احتیاط استفاده شود). |

مراحل اجرای ورک‌فلو (روی Node.js نسخه `26`):
1. اعتبارسنجی `TGCLOUD_TOKEN` و `OWNER_ID`.
2. نصب `@tgcloud/cli` با دستور `npm install --no-audit --no-fund`.
3. دیپلوی ماژول‌ها با `npx tgcloud push --force`.
4. اجرای مایگریشن دیتابیس با `npx tgcloud migrate --<migration_mode>` (در صورت انتخاب‌نشدن `skip`).
5. ثبت `OWNER_ID` در جدول `settings` با دستور `npx tgcloud run handlers/message "{owner_id: ${OWNER_ID}}" --ctx '{ci_bootstrap: true}'`.
6. همگام‌سازی و نمایش وضعیت وب‌هوک با `npx tgcloud webhook sync` و `npx tgcloud webhook`.

> **جابه‌جایی مالکیت (Owner Rotation):** اگر مقدار `OWNER_ID` را در GitHub Secrets تغییر دهید و ورک‌فلو را دوباره اجرا کنید، تابع `setOwnerId()` به‌طور خودکار مالک جدید را ثبت کرده و ردیف‌های `contact_topics`، `connections` و وقفه تاپیک‌های مالک قبلی را پاک‌سازی می‌کند، بدون اینکه پیام‌های آرشیوشده در `messages` حذف شوند.

---

### روش دوم: دیپلوی محلی با `@tgcloud/cli`

نیازمند **Node.js نسخه 18 یا بالاتر** روی سیستم شما است (محیط CI از Node.js `26` استفاده می‌کند).

#### گام ۱: دریافت کد و نصب وابستگی‌ها

</div>

<div dir="ltr">

```bash
git clone https://github.com/AZiPA/telegram-chat-automation.git
cd telegram-chat-automation
npm install
```

</div>

<div dir="rtl">

#### گام ۲: اتصال پروژه به ربات (`tgcloud login`)

</div>

<div dir="ltr">

```bash
npx tgcloud login
```

</div>

<div dir="rtl">

هنگام درخواست، توکن `app<id>:<secret>` را وارد کنید. اطلاعات ورود به‌صورت محلی در پوشه gitignoreشده CLI ذخیره می‌شود.

#### گام ۳: دیپلوی کد و اعمال مایگریشن دیتابیس

</div>

<div dir="ltr">

```bash
npx tgcloud push       # Or: npm run deploy
npx tgcloud migrate
```

</div>

<div dir="rtl">

> **نکته بسیار مهم:** دستور `npx tgcloud push` (و همچنین `npm run deploy` که صرفاً میان‌بُر `tgcloud push` است) فقط ماژول‌های جاوااسکریپت را دیپلوی می‌کند و **هرگز تغییری در دیتابیس ایجاد نمی‌کند**. برای ساخت یا به‌روزرسانی جدول‌ها حتماً `npx tgcloud migrate` را اجرا نمایید.

#### گام ۴: ثبت اولیه `OWNER_ID` (الزامی)

به دلیل سیاست امنیتی **fail-closed**، تا زمانی که `owner_id` در جدول `settings` ثبت نشود، ربات تمام آپدیت‌ها و دستورات را نادیده می‌گیرد. عدد `123456789` را با شناسه عددی تلگرام خودتان جایگزین کنید:

**در Bash / macOS / Linux:**

</div>

<div dir="ltr">

```bash
npx tgcloud run handlers/message '{owner_id: 123456789}' --ctx '{ci_bootstrap: true}'
```

</div>

<div dir="rtl">

**در Windows CMD:**

</div>

<div dir="ltr">

```cmd
npx tgcloud run handlers/message "{owner_id: 123456789}" --ctx "{ci_bootstrap: true}"
```

</div>

<div dir="rtl">

خروجی موفق شامل `{ ok: true }` خواهد بود.

#### گام ۵: بررسی همگام‌سازی وب‌هوک

</div>

<div dir="ltr">

```bash
npx tgcloud webhook
```

</div>

<div dir="rtl">

در صورت عدم تطابق وب‌هوک با ۵ هندلر دیپلوی‌شده، دستور `npx tgcloud webhook sync` را اجرا کنید.

---

## فعال‌سازی در تلگرام پس از دیپلوی (ترتیب الزامی)

پس از پایان دیپلوی، مراحل زیر را **دقیقاً به این ترتیب** انجام دهید:

1. **ابتدا در چت خصوصی به ربات `/start` بفرستید:**
   - بر اساس قوانین تلگرام، ربات نمی‌تواند پیش از اینکه شما گفتگوی خصوصی را با آن شروع کنید به شما پیام بدهد.
   - ارسال `/start` همچنین صحت ثبت `OWNER_ID` را تایید کرده و داشبورد وضعیت **🤖 Telegram Business Assistant Status** را نمایش می‌دهد.
2. **ربات را در بخش Telegram Business متصل کنید:**
   - در تلگرام به مسیر **Settings → Telegram Business → Chatbots** بروید.
   - ربات خود را انتخاب کرده و دسترسی‌های زیر (`BusinessBotRights`) را فعال کنید:
     - `can_read_messages` — **Read messages** *(برای آرشیو پیام‌های ورودی/خروجی و تشخیص ویرایش/حذف الزامی است)*
     - `can_reply` — **Send and reply to messages** *(امکان فعالیت ربات در چت‌های بیزینس)*
     - `can_delete_sent_messages` — **Delete messages sent by the bot**
     - `can_delete_all_messages` — **Delete all messages** *(برای حذف خودکار ریپلای محرک View-Once الزامی است؛ در رابط تنظیمات تلگرام ممکن است با عنوان **Delete Received Messages** نمایش داده شود)*
3. **بررسی اعلان تایید اتصال:**
   - بلافاصله پس از اتصال، ربات پیام **🔗 Telegram Business Connected** را ارسال کرده و فعال‌بودن `can_read_messages` و `can_delete_all_messages` را گزارش می‌دهد. هر زمان با ارسال مجدد `/start` می‌توانید وضعیت دسترسی‌ها را بررسی کنید.

### توقف و ادامه موقت در هر چت (Pause / Resume)

در صفحه گفتگوی خصوصی هر مخاطب می‌توانید مستقیماً از دکمه **Stop / Start** در نوار بالای چت (قابلیت بومی Telegram Business) استفاده کنید تا ربات فقط در همان گفتگو متوقف یا مجدداً فعال شود. غیرفعال‌کردن ربات در **Telegram Business → Chatbots** نیز مقدار `is_enabled = false` را در جدول `connections` ثبت کرده و پردازش آپدیت‌های بیزینس را فوراً متوقف می‌کند.

---

## دستورات ربات و پیکربندی

### دستورات مالک (فقط در چت خصوصی)

تمامی دستورات منحصراً برای `OWNER_ID` در چت خصوصی فعال هستند؛ پیام‌های سایر کاربران یا گروه‌ها بدون هیچ پاسخی نادیده گرفته می‌شوند.

| دستور | عملکرد |
|---|---|
| `/start` | وقفه ۱۰ دقیقه‌ای ساخت تاپیک را پاک می‌کند و داشبورد وضعیت (اتصال‌های ثبت‌شده، دسترسی‌ها، تعداد تاپیک‌های فعال و تنظیمات محرک View-Once) را نمایش می‌دهد. در صورت باز شدن از طریق لینک عمیق `bizChat<chatId>`، بخش **Contact Archive Summary** شامل تعداد پیام‌های آرشیوشده و وضعیت تاپیک همان مخاطب را نیز نشان می‌دهد. |
| `/trigger` | متن محرک فعلی View-Once (پیش‌فرض `.`)، وضعیت حذف خودکار و راهنمای استفاده را نمایش می‌دهد. |
| `/trigger <text>` | یک متن محرک تک‌خطی دلخواه (۱ تا ۳۲ کاراکتر، بدون حساسیت به حروف بزرگ/کوچک) تنظیم می‌کند. هر ریپلای روی رسانه یک‌بارمصرف آن را ذخیره می‌کند و ریپلای‌های منطبق با محرک در صورت فعال‌بودن حذف خودکار پاک می‌شوند. |
| `/trigger reset` | متن محرک View-Once را به حالت پیش‌فرض `.` بازمی‌گرداند. |
| `/autodelete` | وضعیت حذف خودکار ریپلای‌های منطبق با محرک (پیش‌فرض فعال) را نشان می‌دهد و در صورت نبود `can_delete_all_messages` هشدار می‌دهد. |
| `/autodelete on` | حذف خودکار ریپلای محرک را پس از ذخیره موفق رسانه یک‌بارمصرف فعال می‌کند. |
| `/autodelete off` | حذف خودکار ریپلای را غیرفعال می‌کند تا پیام‌های ریپلای در چت باقی بمانند، در حالی که ضبط View-Once روی هر ریپلایی همچنان برقرار است. |

### ثابت‌های تنظیمات در زمان اجرا (`tgcloud/lib/config.js`)

| ثابت | مقدار پیش‌فرض | کاربرد |
|---|---|---|
| `RETENTION_DAYS` | `30` | مدت نگهداری پیام‌های آرشیوشده در `messages` پیش از پاک‌سازی تصادفی (~۲٪ آپدیت‌های `business_message`). |
| `RAW_UPDATES_RETENTION_DAYS` | `3` | مدت نگهداری لاگ‌های دیباگ در جدول `raw_updates`. |
| `DEFAULT_VIEW_ONCE_TRIGGER` | `'.'` | متن پیش‌فرض محرک در صورت تنظیم‌نشدن توسط `/trigger`. |
| `MAX_TRIGGER_LENGTH` | `32` | حداکثر طول مجاز متن محرک View-Once. |
| `DELETE_TRIGGER_REPLY` | `true` | رفتار پیش‌فرض حذف خودکار پیش از تغییر با `/autodelete`. |
| `CAPTURE_UNARCHIVED_REPLIES` | `true` | امکان ضبط رسانه یک‌بارمصرف از روی `reply_to_message` حتی اگر پیام اصلی قبلاً در دیتابیس ثبت نشده باشد. |
| `NOTIFY_UNARCHIVED_DELETES` | `true` | ارسال خلاصه اطلاع‌رسانی در صورت حذف پیام‌های آرشیونشده (پیش از اتصال ربات). |
| `MAX_DELETE_BATCH` | `25` | حداکثر تعداد پیام ورودی آرشیوشده در هر آپدیت `deleted_business_messages`. |
| `MAX_GETFILE_BYTES` | `20971520` (20 MB) | سقف دانلود Bot API تلگرام پیش از تلاش برای آپلود مجدد فایل View-Once. |
| `DEBUG_RAW_UPDATES` | `false` | به‌طور پیش‌فرض غیرفعال است. تنها در صورت نیاز موقت به دیباگ آپدیت‌های خام در `raw_updates` آن را `true` کنید. |

---

## مایگریشن دیتابیس، نگهداری و تذکر حریم خصوصی

### دستورات نگهداری روزمره

</div>

<div dir="ltr">

```bash
npx tgcloud status         # Or: npm run status (compare local modules vs. cloud)
npx tgcloud push           # Or: npm run deploy (deploy code only; never alters DB)
npx tgcloud migrate        # Interactively review & apply schema.js changes (--dry-run, --safe, --yes)
npx tgcloud webhook        # Check platform-managed webhook & allowed_updates sync
npx tgcloud webhook sync   # Repair webhook if handlers changed or webhook drifted
```

</div>

<div dir="rtl">

### قوانین اسکیمای Telegram Serverless

اگر فایل [`tgcloud/schema.js`](./tgcloud/schema.js) را تغییر می‌دهید به موارد زیر توجه کنید:
- **ممنوعیت Foreign Key:** در رانتایم Serverless گزینه `PRAGMA foreign_keys` خاموش است؛ بنابراین `.references()` و `foreignKey()` هنگام تعریف خطا می‌دهند. یکپارچگی داده‌ها باید در کد برنامه رعایت شود.
- **حذف با `.deprecated('reason')`:** پاک کردن ستون یا جدول از `schema.js` باعث حذف خودکار آن از دیتابیس نمی‌شود. ابتدا آن را با `.deprecated('reason')` علامت‌گذاری کرده، دیپلوی کنید و سپس هنگام اجرای `npx tgcloud migrate` حذف را تایید نمایید.
- **تغییر دستی نوع ستون:** تغییر نوع ستون (Column Type) به‌صورت خودکار انجام نمی‌شود و باید با کوئری مستقیم `db.run(...)` اجرا شود.

### تذکر حریم خصوصی و مسئولیت کاربر

این ربات منحصراً برای **استفاده شخصی تک‌مالک** روی حساب Telegram Business خودتان طراحی شده است. متن پیام‌ها، کپشن‌ها، فراداده‌ها و شناسه‌های فایل تا سقف دوره نگهداری `RETENTION_DAYS` (`30` روز) در دیتابیس Telegram Serverless ربات شما ذخیره می‌شوند. مسئولیت رعایت قوانین حریم خصوصی محلی، رضایت طرفین گفتگو و قوانین استفاده از تلگرام (Terms of Service / Bot Developer Terms) تماماً بر عهده بهره‌بردار است.

---

## مشارکت و مجوز (License)

مشارکت‌ها، رفع باگ‌ها و ارسال Pull Request استقبال می‌شود! هنگام ویرایش فایل‌های داخل `tgcloud/`:
- تمام ایمپورت‌های داخلی را به‌صورت نسبی و با پسوند `.js` بنویسید (و برای SDK از `'sdk'` یا `'sdk/db'` استفاده کنید).
- هیچ وابستگی `npm` زمان اجرا وارد `tgcloud/` نکنید.
- پوشه `tgcloud/handlers/` را کاملاً مسطح (یک سطح و منطبق با نام‌های رسمی Bot API) نگه دارید.

**مجوز (License):** این پروژه تحت مجوز [Mozilla Public License 2.0 (MPL-2.0)](./LICENSE) منتشر شده است. توجه داشته باشید که [`package.json`](./package.json) همچنان به‌عنوان یک پروژه دیپلوی ربات (و نه پکیج قابل انتشار در npm) با `"private": true` علامت‌گذاری شده است.

</div>
