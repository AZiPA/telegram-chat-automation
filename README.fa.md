<div dir="rtl">

[English](./README.md) | **فارسی**

# دستیار هوشمند تلگرام بیزینس — ردیابی پیام‌های حذف‌شده، ویرایش‌شده و یک‌بارمصرف

[![مستندات زنده](https://img.shields.io/badge/Docs-Live%20Guide-0A7EA4)](https://azipa.github.io/fa/projects/chat-automation/)
[![Platform: Telegram Serverless](https://img.shields.io/badge/Platform-Telegram%20Serverless-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org)
[![CLI: @tgcloud/cli ^0.2.0](https://img.shields.io/badge/%40tgcloud%2Fcli-%5E0.2.0-26A5E4)](https://www.npmjs.com/package/@tgcloud/cli)
[![Node.js: 26 (CI)](https://img.shields.io/badge/Node.js-26%20%28CI%29-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](./LICENSE)

یک **ربات تلگرام بیزینس** شخصی که به‌صورت بومی روی **تلگرام سرورلس** (`@tgcloud/cli`) همراه با **دیتابیس داخلی SQLite** و **بدون نیاز به VPS یا سرور خارجی** اجرا می‌شود. این دستیار تماماً سمت ربات (بدون نیاز به Mini App)، گفتگوهای خصوصی دونفره را آرشیو می‌کند تا امکان **بازیابی پیام‌های حذف‌شده تلگرام**، **ردیابی پیام‌های ویرایش‌شده** به‌صورت بی‌صدا و **ذخیره عکس و ویدیو یک‌بارمصرف** (`View-Once`) را فراهم کند.

> [!NOTE]
> **محدوده عملکرد:** ربات تنها پیام‌هایی را آرشیو و بازیابی می‌کند که **پس از اتصال** به حساب تلگرام بیزینس شما دریافت شده باشند؛ بازیابی گذشته‌نگر پیام‌های قدیمی‌تر پیش از اتصال امکان‌پذیر نیست.

## راه‌اندازی سریع — دیپلوی در ۲ دقیقه (GitHub Actions)

1. **آماده‌سازی ربات در `@BotFather`:** قابلیت‌های **Serverless** و **Business Mode** را فعال کنید (**Allow Groups** را خاموش کنید و در صورت تمایل **Threaded Mode** را برای ساخت تاپیک مجزا فعال نمایید)، سپس توکن **CLI Access** با فرمت `app<id>:<secret>` را از مسیر `Serverless → CLI Access` کپی کنید (این توکن با توکن معمولی HTTP Bot API متفاوت است).
2. **Fork مخزن:** در صفحه [AZiPA/telegram-chat-automation](https://github.com/AZiPA/telegram-chat-automation) روی **Fork** کلیک کنید تا نسخه شخصی خود را بسازید.
3. **افزودن Secrets در مخزن:** به مسیر **Settings → Secrets and variables → Actions** بروید و دو مقدار `TGCLOUD_TOKEN` (`app<id>:<secret>`) و `OWNER_ID` (شناسه عددی مثبت اکانت تلگرام خودتان) را اضافه کنید.
4. **دیپلوی و فعال‌سازی:** ورک‌فلو **Actions → ✈️ Deploy to Telegram → Run workflow** را اجرا کنید (یا یک کامیت push کنید)، **ابتدا** در چت خصوصی دستور `/start` را به ربات بفرستید و سپس ربات را از مسیر **Telegram Settings → Telegram Business → Chatbots** با دسترسی‌های خواندن و حذف پیام متصل نمایید.

**برای راهنمای کامل `@BotFather`، گزینه‌های `migration_mode` (`safe`، `dry-run`، `skip`، `yes`)، دیپلوی خودکار با GitHub Actions یا دیپلوی محلی با `@tgcloud/cli` (در Bash و Windows CMD) و دسترسی‌های `BusinessBotRights`، به [راهنمای راه‌اندازی و دیپلوی](https://azipa.github.io/fa/projects/chat-automation/setup/) مراجعه کنید.**

## قابلیت‌های کلیدی

- **بازیابی پیام‌های حذف‌شده و آلبوم‌های رسانه:** پیام‌های حذف‌شده چت خصوصی را با هدرهای خنثی، خلاصه دسته‌ای، حفظ قالب‌بندی متن، فراداده `forward_origin` و بازسازی آلبوم‌ها بازیابی می‌کند.
- **ردیابی بی‌صدای ویرایش‌ها:** تغییرات پیام‌های ورودی را به‌صورت بی‌صدا با گزارش فشرده بازشونده یا نسخه کامل پیش و پس از ویرایش (با حفظ فرمت متن) ثبت کرده و آپدیت‌های بی‌تغییر مانند پیش‌نمایش خودکار لینک را نادیده می‌گیرد.
- **ذخیره رسانه یک‌بارمصرف (`View-Once`) و محرک حذف خودکار:** عکس، ویدیو، ویس و پیام ویدیویی گرد (`video_note`) یک‌بارمصرف را با ریپلای پیش از بازکردن ذخیره می‌کند و در صورت تطابق با متن محرک، پیام ریپلای را به‌طور خودکار پاک می‌نماید (`/trigger`، `/autodelete`).
- **تاپیک اختصاصی برای هر مخاطب:** در صورت فعال‌بودن **Threaded Mode** به‌ازای هر مخاطب یک Forum Topic اختصاصی می‌سازد و همگام نگه می‌دارد، و در نبود آن به‌صورت خودکار به چت اصلی ربات برمی‌گردد.
- **امنیت Fail-Closed تک‌مالک:** هیچ توکن یا شناسه‌ای در کد هاردکد نشده است، تمام دستورات و آپدیت‌ها منحصراً به `OWNER_ID` محدود هستند و جابه‌جایی مالک بدون ازدست‌رفتن پیام‌های آرشیوشده انجام می‌شود.
- **تلگرام سرورلس بدون VPS + دیتابیس داخلی SQLite:** ساختار تماماً ربات (بدون Mini App) که مستقیم روی رانتایم ایزوله V8 تلگرام با دیتابیس داخلی SQLite و پاک‌سازی خودکار دوره‌ای (پیش‌فرض `30` روز) اجرا می‌شود.

## مرکز مستندات کامل

| بخش مستندات | شرح محتوا |
|---|---|
| [معرفی و قابلیت‌ها](https://azipa.github.io/fa/projects/chat-automation/) | بازیابی پیام‌های حذف‌شده، ردیابی ویرایش‌ها، ذخیره `View-Once`، تاپیک‌ها و محدوده عملکرد |
| [راه‌اندازی، GitHub Actions و دیپلوی محلی با CLI](https://azipa.github.io/fa/projects/chat-automation/setup/) | تنظیمات کامل `@BotFather`، گزینه‌های `migration_mode`، `@tgcloud/cli` و دسترسی‌های `BusinessBotRights` |
| [دستورات مالک و پیکربندی زمان اجرا](https://azipa.github.io/fa/projects/chat-automation/commands-config/) | دستورات `/start`، `/trigger`، `/autodelete` و ثابت‌های `tgcloud/lib/config.js` |
| [معماری، اسکیمای SQLite و مایگریشن دیتابیس](https://azipa.github.io/fa/projects/chat-automation/architecture/) | ساختار ایزوله V8، ۵ هندلر، جدول‌های SQLite و قوانین مایگریشن |

## حریم خصوصی و مجوز

این ربات منحصراً برای استفاده شخصی تک‌مالک روی حساب تلگرام بیزینس خودتان طراحی شده است؛ رعایت قوانین محلی حریم خصوصی، رضایت طرفین و قوانین استفاده از تلگرام (Terms of Service) بر عهده بهره‌بردار است.

منتشرشده تحت مجوز [Mozilla Public License 2.0 (MPL-2.0)](./LICENSE).

</div>
