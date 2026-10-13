# دستورالعمل‌های اجرایی و انضباطی توسعه سیستم SBK

تو به عنوان دستیار هوشمند و برنامه‌نویس این پروژه موظف هستی قوانین زیر را با دقت و بدون استثنا رعایت کنی:

## ۱. بهینه‌سازی توکن و محدودیت دسترسی به فایل‌ها
- **جلوگیری از خواندن کل پروژه:** به هیچ وجه کل ساختار یا تمامی فایل‌های پروژه را به طور یکجا نخوان و بررسی نکن.
- **تمرکز نقطه‌ای:** فقط و فقط به فایل‌ها، ماژول‌ها یا خطوطی که مستقیماً به دستور یا مشکل فعلی مربوط هستند رجوع کن و آن‌ها را ویرایش کن.
- **پرهیز از بازنویسی بی‌دلیل:** کد موجود را بدون دلیل یا برای بازطراحی سلیقه‌ای بازنویسی نکن. تغییرات باید دقیق، حداقل و کم‌خطر باشند.
در داخل چت کدی ننویس 
## ۲. اجرای مرحله‌به‌مرحله و دقیق
- کارها را به مراحل کوچک، منطقی و قابل‌کنترل تقسیم کن.
- هر مرحله را با دقت کامل، بررسی ابعاد جانبی و تست‌شده پیش ببر و منتظر تأیید یا دستور بعدی بمان.

## ۳. ممنوعیت داده‌های فیک و Mock
- **داده‌های واقعی:** استفاده از داده‌های فیک، ساختگی، Mock یا سیگنال‌های تستی خیالی مطلقاً ممنوع است.
- **اولویت ریسک:** تمام بخش‌ها باید با داده‌های واقعی، کنترل ریسک سخت‌گیرانه، مکانیزم‌های کاهش افت سرمایه (Drawdown) و تفکیک کامل محیط‌های دمو/تست از لایو توسعه یابند.

## ۴. حفظ هماهنگی سیستم
- پیش از اعمال هر تغییری، وابستگی‌های آن را با سایر بخش‌های سیستم بسنج تا از ایجاد کدهای متداخل، زائد یا ناهمسنگ جلوگیری شود.
- سیستم باید همیشه در حالت یکپارچه، پایدار و عملیاتی باقی بماند.

Create the file .github/copilot-instructions.md with exactly these rules for this repository (SBK1 + Freqtrade):

1. Freqtrade is the ONLY owner of exchange credentials, orders, fills, positions, stop-losses and trade persistence. Never add direct exchange calls or API keys to the SBK1 Node server.
2. Never enable live trading. The managed launcher must keep requiring dry_run=true and force_entry_enable=false. Never weaken any fail-closed gate (CALIBRATED_CONFIDENCE_UNAVAILABLE, kill switch, dry-run checks, auth checks) to make a test pass.
3. Never fabricate data, metrics, win rates, or calibration results. Missing data must be "unavailable", never zero or a default.
4. Never commit secrets (.env, freqtrade/user_data/config.json, tokens). Never delete or overwrite data files (JSON stores, sqlite) without backing them up first.
5. Before finishing any task: run `npm test`, `npm run lint`, `npm run build`, and `npm run sbk1:check`. Report each result honestly, including failures. Do not claim something works unless it was actually run.
6. At the end of every task, give a short report: what changed (files), what was run, what passed or failed, what was NOT verified.
7. Make small, focused changes. If a task is unclear or risky, stop and ask instead of guessing.