# نقشه‌راه ادغام SBK1 و Freqtrade

## هدف و وضعیت فعلی

این سند مسیر تکمیل ادغام را تعریف می‌کند؛ به معنی آماده‌بودن سامانه برای سرمایهٔ واقعی نیست. معماری هدف چنین است:

- **SBK1** مالک تحلیل/پیش‌بینی، ادغام featureها و provenance، تولید تصمیم ورود/خروج عادی، داشبورد و کنترل‌های سطح محصول است؛ دادهٔ خام صرافی را خودش دریافت نمی‌کند.
- **Freqtrade** مرجع یگانهٔ دریافت دادهٔ خام صرافی، کلیدهای صرافی، سفارش‌ها، fillها، موقعیت‌ها، stop/exit اضطراری و پایگاه دادهٔ معاملات باقی می‌ماند.
- **لایهٔ ادغام** قرارداد نسخه‌دار و محدود برای انتقال سیگنال و بازگرداندن رخدادهای چرخهٔ معامله فراهم می‌کند. مرورگر مستقیماً به API مدیریت Freqtrade متصل نمی‌شود.
- **مرز اتصال صرافی**: Freqtrade تنها جزء مجاز برای ارتباط مستقیم با API صرافی است؛ SBK1 دادهٔ بازار و وضعیت/اجرای صرافی را از Freqtrade یا adapter محدود و احراز هویت‌شدهٔ آن دریافت می‌کند، نه از connector موازی در React/Node.
- **مرز تصمیم و اجرا**: SBK1 تصمیم جهت‌دار ورود و خروج عادی را می‌سازد؛ Freqtrade سفارش را اجرا می‌کند. Freqtrade می‌تواند سیگنال ناسازگار را رد کند و hard stop یا حفاظت اضطراری مستقل اعمال کند، اما استراتژی جهت‌دار/پیش‌بینی موازی نمی‌سازد.

سورس فعلی قرارداد سیگنال `sbk1.freqtrade.signal.v3` را میان Node و strategy پایتون به‌کار می‌برد. مسیر خودکار ابتدا ماژول‌های پشتیبان را برای همان اسنپ‌شات ارزیابی و شواهدشان را در مخزن عضو مالک ثبت می‌کند؛ سپس هشت عضو هرکدام یک رأی حوزه‌ای می‌دهند. خروجی پشتیبان رأی اضافه نیست و تا وقتی قرارداد/کالیبراسیون رأی‌ساز جداگانه نداشته باشد به‌عنوان شاهد گزارش می‌شود، نه رأی مستقل. فقط پس از حدنصاب، کنترل واحد پس از شورا اجرا می‌شود؛ جهت شورا مرجع است و پایپ‌لاین جهت دیگری را دوباره انتخاب نمی‌کند. پژوهش افق اجرایی فقط از کندل‌های تکمیل‌شدهٔ Freqtrade DataProvider همان صرافی، بازار، نماد و تایم‌فریم استفاده می‌کند؛ کنترل مرکزی تطبیق دقیق این مشخصات و تازگی را الزامی کرده و کمبود تاریخچه/هزینهٔ معتبر را fail-closed می‌کند. حداکثر ۱۵۰۰ کندل از DataProvider درخواست می‌شود. تصمیم افق و دلایل هر افق در audit ثبت و با احراز هویت مدیر از `/api/freqtrade/execution-audit` قابل مشاهده است. خروج زمان‌محور هنگام چرخهٔ ارزیابی راهبرد Freqtrade بررسی می‌شود و اجرای دقیق در همان ثانیه یا fill تضمین‌شده نیست. پروب Binance عمومی صرفاً advisory است و نمی‌تواند برای venue دیگر مجوز ایجاد کند. کنترل اجرایی همچنان دادهٔ تازه، شروط ورود و سقف ریسک را بررسی می‌کند. adapter/strategy بدون مجوز نسخه‌دار، سقف ریسک، و دست‌کم دو مدل هم‌جهت با کالیبراسیون و استقلال اعتبارسنجی‌شده ورود را نمی‌پذیرند. در وضعیت فعلی استقلال خطای مدل‌ها اندازه‌گیری نشده، وزن مؤثر مدل‌ها صفر است و ensemble ورود را veto می‌کند؛ بنابراین ورود خودکار fail-closed است. `dry_run=true` در RPC Freqtrade شرط اجباری runner، endpoint صف و strategy است؛ پرچم legacy به‌تنهایی مسیر LIVE را فعال نمی‌کند. `/api/hunter/execute` غیرفعال است و fixture آزمایشی مسیر جداگانهٔ `DRY_RUN_TEST_ONLY` دارد. در این تغییر فقط تست‌های محلی/ایزولهٔ mock و fixture اجرا می‌شوند؛ هیچ اتصال RPC/صرافی یا سفارش واقعی اثبات نشده است. این شواهد **آمادگی تولید یا LIVE را اثبات نمی‌کنند**: کالیبراسیون واقعی و OOS، استقلال خطای مدل‌ها، اندازه‌گیری تأخیر خروج و آشتی وضعیت پس از restart در deployment واقعی همچنان نیازمند آزمون مستقل‌اند. جزئیات قرارداد و مالکیت وضعیت در [README](./README.md) آمده است.

## شورا و کنترل واحد پس از رأی

در مسیر سیگنال سرور، ابتدا تحلیل‌های مغزها، SBها و منابع متن‌باز موجود برای همان اسنپ‌شات جمع‌آوری و به مخزن عضو مالک متصل می‌شوند؛ این مرحله حتی در نبود حدنصاب اجرا می‌شود تا گزارش اعضا وضعیت واقعی داده و ماژول‌های حاضر/غایب را نشان دهد. سپس هر عضو دقیقاً یک رأی بر مبنای ورودی‌های تخصصی خودش می‌دهد. رأی اعضا دوباره محاسبه نمی‌شود و خروجی‌های پشتیبان به‌عنوان رأی‌های اضافی یا رأی‌ساز تأییدنشده شمرده نمی‌شوند. بدون حدنصاب ۵ رأی هم‌جهت، کنترل معامله اجرا نمی‌شود. پس از حدنصاب، تنها `runPostCouncilTradeControl` اجرا می‌شود؛ کنترل جهت منتخب شورا را مرجع می‌گیرد و رأی‌گیری/رتبه‌بندی جهت موازی انجام نمی‌دهد. همین کنترل، پایپ‌لاین واحد تصمیم را یک بار اجرا می‌کند تا شرایط فنی، ورود/ابطال/اهداف، ریسک، مارجین، اهرم و فاصلهٔ مجاز قیمت ورود را تعیین کند. گیت قدیمی ۱۱قانونی در مسیر اجرای سرور نیست و widget داشبورد آن از مسیر فعال برداشته شده است؛ قانون‌های هم‌پوشان به‌عنوان گیت موازی اجرا نمی‌شوند.

Freqtrade همچنان مرجع اجرای سفارش و دارای محدودیت‌های دفاعی مستقل است: اعتبار قرارداد، TTL/قیمت، موجودی واقعی، سقف stake و risk budget و جلوگیری از سفارش تکراری. strategy می‌تواند stake نهایی را به دلیل ریسک stop یا حداقل مقدار صرافی کمتر کند؛ این کاهش sizing دومِ تحلیلی نیست، محدودیت اجرایی برای رعایت سقف ریسک است.

این شمارش‌ها مفاهیم جدا هستند و نباید با هم ادغام شوند:

| مجموعه | تعداد | کارکرد |
|---|---:|---|
| اعضای شورا | ۸ | رأی مستقل حوزه‌ای؛ حدنصاب جهت ۵ از ۸ |
| شناسه‌های تخصیص‌یافته به مخزن اعضا | ۵۰ | ۲۱ مغز، ۴ مدل تخصصی SB، ۶ تحلیلگر متن‌باز، یک news firewall، ۸ رکن وزنی + یک veto و ۹ خروجی منبع مستقیم؛ هر شناسه فقط یک مالک عضو دارد |
| پایپ‌لاین تصمیم | ۱۴ مرحله | ارزیابی و کنترل بعد از رأی شورا؛ «۱۴ رکن شورا» نیست |
| Quantum Trade Law | ۱۱ قانون قدیمی | سابقهٔ گیت UI؛ از مسیر فعال اجرا برداشته شده تا گیت موازی/تکراری نباشد |
| ارکان رأی‌ساز `signalToExecution` | ۸ رکن وزنی + ۱ veto | امتیازهای نمایشی/پشتیبان؛ جزو رأی‌های شورا یا گیت اجرایی جداگانه نیست |

SB5 هماهنگ‌کنندهٔ سطح شورا است، به‌عنوان ماژول مستقل عضو ثبت نمی‌شود و در رأی‌ها شمرده نمی‌شود؛ خروجی آن در گزارش شورا ثبت می‌شود. خروجی مغزها و SBها شواهد/پشتیبان هستند، نه رأی‌های اضافی. دادهٔ خامی که در `sourceData` نگهداری می‌شود، در payload ماژول تکرار نمی‌شود؛ شواهد آن ماژول فقط وضعیت و provenance را ثبت می‌کنند. عضو اقتصاد کلان در runner از دست‌کم دو شاخص مستقیم و تازه در خروجی `fetchFreeMacroData` رأی می‌سازد؛ سری‌های روزانهٔ FRED از endpoint عمومی CSV بدون API key خوانده می‌شوند و دلار گستردهٔ فدرال رزرو صریحاً proxy است، نه DXY. نبود یا کهنگی provider به‌عنوان `UNAVAILABLE`/`STALE` ثبت می‌شود و عضو مربوطه می‌تواند `ABSTAIN` کند؛ جریان آن‌چین منتسب به صرافی به منبعی با انتساب معتبر نیاز دارد و بدون آن نباید با active-address یا مقدار ساختگی جبران شود.

هدف پوشش مهندسی **تمام قابلیت‌های مرتبط Freqtrade و تمام صرافی‌های پشتیبانی‌شده در نسخهٔ نصب‌شده** است؛ نه روشن‌کردن بی‌تمایز همهٔ تنظیمات، و نه ادعای سازگاری یک صرافی بدون آزمون. شروع روی محیط محلی است؛ استقرار خصوصی مرحلهٔ جداگانه خواهد بود. معاملات واقعی فقط پس از عبور از دروازه‌های مستقل و تأیید صریح می‌توانند بررسی شوند.

پوشش آزمون upstream Freqtrade دلیل خوبی برای ترجیح connector، strategy و data provider بومی آن بر پیاده‌سازی موازی است؛ اما قبولی تست‌های Freqtrade به‌تنهایی صحت API زندهٔ هر صرافی/حساب/نوع بازار، دسترسی داده در نسخهٔ نصب‌شده یا اتصال انتها‌به‌انتهای SBK1 را اثبات نمی‌کند. برای نمونه، [تست Bybit](./freqtrade/tests/exchange/test_bybit.py) از `MagicMock` و API mock استفاده می‌کند. بنابراین نسخه و قابلیت هر پروفایل باید بررسی شود و اتصال واقعی read-only و Testnet جداگانه آزموده شود.

## مسیر سریع و استاندارد برای تکمیل اتصال

راه سریع‌تر، استفاده از قابلیت‌های موجود Freqtrade از طریق پل فعلی است؛ نه انتقال دوبارهٔ موتور معامله یا مدل‌های SBK1:

| مسئولیت | مالک یگانه | مسیر اتصال |
|---|---|---|
| امتیازدهی ورود/«شکار موج»، مدل‌ها و تصمیم عادی جهت‌دار | SBK1 | تصمیم versioned و منقضی‌شونده از bridge موجود به `SbkSignalStrategy`؛ استراتژی فقط آن را اعتبارسنجی و به سیگنال native تبدیل کند. محاسبات TypeScript داخل Python دوباره‌نویسی نشوند. |
| تصمیم عادی خروج | SBK1 | سیگنال خروج SBK1 از همان قرارداد/lifecycle برسد؛ Freqtrade تصمیم را به سفارش/خروج اجرایی تبدیل کند. |
| اتصال exchange، entry/exit orders، timeout/cancel، fills و موقعیت | Freqtrade | exchange adapter بومی، `unfilledtimeout`، order types/pricing و پایگاه دادهٔ Freqtrade. هیچ API صرافی مستقیمی در React/Node اضافه نشود. |
| hard stop اضطراری، trailing حفاظتی و veto ریسک | Freqtrade | `stoploss`/`custom_stoploss`, و `stoploss_on_exchange` فقط برای profile آزموده‌شده؛ trailing native و `Protections` پس از تعیین و آزمون سیاست ریسک فعال شوند. |
| stake و محدودیت سرمایه | Freqtrade | `stake_amount`, `tradable_balance_ratio`, `max_open_trades` و `custom_stake_amount`; `adjust_trade_position` فقط در صورت نیاز و با سقف مشخص. |
| ثبت معامله/آمار/کنترل اجرایی | Freqtrade | DB و RPC خصوصی؛ UI فارسی SBK1 باقی بماند و از backend مجاز، lifecycle authoritative را نمایش دهد. |
| بک‌تست و بهینه‌سازی | Freqtrade | backtesting/Hyperopt فقط با strategy/replay قابل‌بازتولید از تصمیم‌های SBK1؛ تحلیل‌گرهای متن‌باز فعلی بیرون از مجوز تصمیم اجرا می‌شوند. |

**قاعدهٔ عدم تداخل:** یک معامله فقط یک hard-stop owner دارد. خروج حفاظتی متعلق به Freqtrade است؛ تصمیم عادی خروج متعلق به SBK1 است. `minimal_roi`, `custom_exit`, exit signal و trailing نباید همزمان منطق‌های متناقض اعمال کنند؛ پیش از فعال‌سازی هر ترکیب، ترتیب و precedence در config/strategy و تست‌ها باید روشن باشد. فعال‌بودن قابلیت در Freqtrade به معنی نیاز به روشن‌کردن همهٔ قابلیت‌ها نیست.

**ترتیب حداقل‌کارِ قابل‌اتکا**

1. از پشتهٔ Dry-run و bridge موجود استفاده کن؛ ابتدا strategy/config فعلی را به‌عنوان baseline ثبت کن و تصمیم‌های واقعی را از fixtureهای آزمون جدا نگه دار.
2. شکاف اصلی را ببند: `SbkSignalStrategy` در حال حاضر مسیر entry را فقط برای dry-run fixture می‌پذیرد و `populate_exit_trend` خالی است؛ تصمیم‌های واقعی SBK1 تا زمان تکمیل آرشیو و کالیبراسیون همچنان باید رد شوند. قرارداد production باید تصمیم واقعی، provenance، expiry، قیمت/حدود ریسک و وضعیت‌های idempotent داشته باشد.
3. lifecycle موجود Freqtrade را برای order/fill/cancel/recovery مصرف کن؛ تصمیم‌گیری یا state موقعیت موازی در SBK1 نساز. DB خود Freqtrade مرجع trade/order است و archive SBK1 فقط تصمیم/ویژگی‌ها را به شناسهٔ Freqtrade پیوند می‌دهد.
4. بعد از تعیین اعداد واقعی سیاست ریسک، قابلیت‌های native لازم را به‌ترتیب اضافه و جداگانه آزمون کن: sizing و سقف معامله → hard stop/protection → timeout/cancel → trailing یا target/ROI انتخابی. اعداد نمونه/فرضی یا `stake_amount: unlimited` به‌عنوان سیاست نهایی پذیرفته نیستند؛ stop روی exchange باید برای همان venue/market تأیید شود.
5. strategy و دادهٔ تاریخی واقعی را با backtest/replay و کنترل lookahead بررسی کن؛ پس از آن سناریوهای Dry-run و Testnet را برای fill، partial fill، timeout، لغو، stop، restart و reconciliation اجرا کن.
6. ابتدا Bybit profile فعلی را certify کن؛ venue بعدی، از جمله Nobitex، فقط پس از تأیید دسترسی واقعی Freqtrade/CCXT همان نسخه و عبور مستقل از همان سناریوها فعال شود. «پشتیبانی CCXT» به تنهایی گواهی Freqtrade/SBK1 نیست.

**شرط توقف:** اگر داده/bridge/calibration ناکافی باشد، سیستم در NO TRADE می‌ماند. این کار با بازکردن gate، پایین‌آوردن threshold، ساختن fixture به‌جای سیگنال واقعی یا فعال‌کردن همزمان مدیرهای ریسک حل نمی‌شود.

## اصول لازم‌الاجرا

- **مرز یگانهٔ صرافی:** تمام ارتباط مستقیم runtime با exchange API، هم برای دادهٔ بازار و هم برای اجرا، فقط از Freqtrade می‌گذرد. SBK1 نباید در React/Node connector صرافی موازی داشته باشد.
- API مدیریت Freqtrade لزوماً برای بیرون‌دادن همهٔ داده‌های بازار یا تمام فیلدهای strategy/DataProvider طراحی نشده است. دادهٔ موردنیاز SBK1 باید از مسیر بومی Freqtrade تأمین و در صورت نیاز از adapter محدود، versioned و احراز هویت‌شده منتشر شود. capability هر فیلد/بازار روشن باشد؛ نبود داده UNKNOWN/UNAVAILABLE است و fallback پنهان به اتصال مستقیم ممنوع.
- داده‌های غیرصرافی، مانند خبر، احساسات و آن‌چین، می‌توانند از provider جدا بیایند؛ provenance، زمان رویداد/دریافت و کیفیت ثبت شود و این ورودی‌ها به‌تنهایی اختیار سفارش نداشته باشند.

1. در همهٔ مسیرها Freqtrade مرجع authoritative معامله است. صف‌شدن یا نمایش سیگنال به معنی سفارش، fill یا موقعیت نیست.
2. دادهٔ ساختگی/مصنوعی یا شبیه‌سازی‌شده وارد آموزش، کالیبراسیون، تصمیم اجرایی یا ادعای عملکرد نمی‌شود. شواهد عملکرد از دادهٔ تاریخی واقعی، قابل‌ردیابی و بدون نشت اطلاعات می‌آیند؛ چرخهٔ سفارش از Dry-run/Testnet واقعی. تست قرارداد صرفاً قرارداد نرم‌افزار را می‌سنجد و شاهد عملکرد بازار نیست.
3. داده/مدل/پاسخ صرافی ناموجود، کهنه، ناقص یا ناسازگار باید صریحاً UNKNOWN/UNAVAILABLE باشد و به NO TRADE منجر شود؛ مقدار خنثی یا موفقیت ساختگی مجاز نیست.
4. API مدیریت Freqtrade عمومی نمی‌شود؛ اعتبارنامه‌ها در مرورگر یا log ظاهر نمی‌شوند؛ سطح دسترسی کلیدهای صرافی حداقلی و بدون برداشت است.
5. Kill switch فقط اثر تأییدشده را گزارش می‌کند. توقف ارسال سیگنال SBK1 به‌خودی‌خود سفارش فعال Freqtrade را لغو یا موقعیت را نمی‌بندد.
6. هیچ مرحله‌ای با فرض موفقیت مرحلهٔ قبلی باز نمی‌شود؛ Gateها باید مدرک آزمون داشته باشند و در نبود مدرک، وضعیت NO-GO است.
7. تغییرات محلی/قبلی کاربر حفظ می‌شوند. هر پیاده‌سازی باید پس از بررسی diff فعلی، محدود، قابل‌بازگشت و همراه با تست مربوط باشد.
8. مجوز و noticeهای GPLv3 سورس Freqtrade حفظ شوند؛ پیش از توزیع محصول ترکیبی، بررسی حقوقی مستقل انجام شود.

## قابلیت‌های Freqtrade موردنیاز SBK1

این فهرست انتخاب اولیه برای معماری «SBK1 مغز، Freqtrade مجری» است؛ فعال‌سازی هر قابلیت به نیاز و پشتیبانی exchange/market مشخص وابسته است. تست‌های upstream دلیل ترجیح اجزای بومی هستند، اما اتصال زندهٔ یک حساب یا کل مسیر SBK1 را گواهی نمی‌کنند.

| اولویت | قابلیت Freqtrade | کاربرد در این سیستم و تصمیم |
|---|---|---|
| الزامی | Exchange adapter و market configuration بومی Freqtrade/CCXT | تنها مسیر دسترسی به exchange، credentials، بازار و نماد، precision/minimumها، rate limit و سفارش. venueها از registry نسخهٔ نصب‌شده می‌آیند؛ همه از ابتدا فعال نمی‌شوند. |
| الزامی | Strategy interface سفارشی SBK1 | دروازهٔ تصمیم‌های نسخه‌دار ورود و خروج عادی SBK1؛ اعتبارسنجی pair/side/market/timeframe، تازگی، expiry، idempotency، انحراف قیمت و حدود ریسک. اندیکاتور یا پیش‌بینی جهت‌دار دوم در Freqtrade ساخته نمی‌شود. مسیر فعلی strategy فقط fixture مجاز می‌کند؛ پذیرش تصمیم واقعی SBK1 نیازمند بازطراحی و review جداگانه است. |
| الزامی | DataProvider و OHLCV تکمیل‌شده | مسیر اصلی کندل/تاریخچه و دادهٔ exchange-derived که Freqtrade واقعاً برای strategy فراهم می‌کند؛ informative timeframeها نیز در صورت نیاز. candle باز/آینده، timestamp نامعتبر و lookahead رد شوند. |
| الزامی، با adapter محدود | رساندن دادهٔ بازار لازم به SBK1 | API مدیریت Freqtrade لزوماً تمام داده‌های DataProvider را بیرون نمی‌دهد. strategy یا adapter خصوصی باید فقط feature/input لازم را با exchange/pair/market/timeframe، زمان رویداد/دریافت، تازگی و provenance منتشر کند. اگر این مسیر موجود/امن نیست، ورودی unavailable است؛ connector موازی ساخته نمی‌شود. |
| الزامی | Signal ingress و order/trade lifecycle | پل احراز هویت‌شدهٔ SBK1↔Freqtrade، قرارداد نسخه‌دار، expiry، correlation، idempotency، status update و reconciliation. Freqtrade DB/Trade/Order مرجع fill و موقعیت است؛ `UNKNOWN_IN_FLIGHT` نباید کورکورانه دوباره ارسال شود. |
| الزامی | Pricing، order types و timeout | تنظیم `entry_pricing`, `exit_pricing`, `order_types`, `unfilledtimeout` و حداقل‌ها بر اساس قابلیت واقعی venue. قیمت مرجع/حد انحراف/expiry از SBK1 می‌آید؛ Freqtrade نرخ قابل‌اجرا و محدودیت سفارش را کنترل می‌کند. |
| الزامی | Callbackهای اجرای deterministic | برحسب نیاز `confirm_trade_entry`, `confirm_trade_exit`, `custom_stake_amount`, `custom_stoploss`, `custom_exit`, timeout و `order_filled` برای اعمال قرارداد و lifecycle؛ بدون پیش‌بینی مستقل، callback سنگین یا fallback موفقیت‌نمایانه. |
| الزامی | Hard stop، سقف موقعیت و Protections | stop-loss اضطراری، سقف stake/leverage/open trades و protections حساب، لایهٔ مستقل ایمنی‌اند و می‌توانند تصمیم عادی SBK1 را veto یا خروج اضطراری دهند. `StoplossGuard`/`MaxDrawdown` پس از تعیین سیاست ریسک پیکربندی شوند؛ stop-on-exchange فقط برای venue/market آزموده‌شده. علت override باید ثبت شود. |
| الزامی | Persistence و RPC خصوصی | DB بومی برای Trade/Order و API RPC احراز هویت‌شده برای health/config محدود، whitelist، trades/status و reconciliation. فقط backend در loopback/private network دسترسی داشته باشد؛ browser مستقیم وصل نشود. |
| الزامی برای پژوهش | Historical data، backtesting و lookahead-analysis | replay تصمیم‌های واقعی/آرشیوشدهٔ SBK1 بر دادهٔ واقعی و قابل‌بازتولید. صف زنده به‌تنهایی strategy قابل‌بک‌تست نمی‌سازد؛ خروجی صفر معامله یا دادهٔ ساختگی، مدرک عملکرد نیست. |
| مشروط به نیاز و venue | Order book، ticker، funding، open interest، mark/index | فقط اگر DataProvider نسخهٔ نصب‌شده در exchange/market موردنظر فیلد را واقعاً پشتیبانی کند و مغز SBK1 نیاز داشته باشد. semantics، تازگی و provenance هر فیلد آزموده شود؛ فقدان آن fail-closed است. |
| مشروط | Hyperopt | فقط برای پارامترهای strategy تاریخی پس از جداسازی train/validation و حفاظت از out-of-sample؛ جایگزین مدل/تصمیم SBK1 و مجوز live نیست. |
| پیاده‌سازی‌شده؛ advisory و ورودی شورا | تحلیل‌گرهای متن‌باز SBK1 | worker محلی OHLCV و تیترهای RSS را به شش تحلیلگر TA-Lib، Markov regime، Isolation Forest، LightGBM، XGBoost/SHAP و مدل sentiment می‌دهد؛ هر خروجی فقط در مخزن عضو مالک ثبت می‌شود. فقط سنتیمنت تازه و معتبر می‌تواند در رأی عضو اخبار اثر بگذارد؛ هیچ ماژولی رأی مستقل یا مجوز سفارش ندارد. |
| مشروط | Dynamic pairlists، چند bot و Producer-Consumer | فقط برای universe پویا یا نیاز واقعی به چند worker/bot؛ شروع با پروفایل‌های محدود و processهای مجزا ساده‌تر و امن‌تر است. |
| اختیاری | Telegram، webhook، Freqtrade UI و plotting | اعلان و عملیات برحسب نیاز؛ مرجع تصمیم SBK1 یا راه دورزدن کنترل دسترسی/ریسک نشوند. |
| خاموش مگر تصویب و آزمون مستقل | `force_entry`, DCA/`position_adjustment` و entry signal جهت‌دار داخلی Freqtrade | ممکن است تصمیم یا سقف ریسک SBK1 را دور بزنند؛ پیش‌فرض خاموش، و مسیر force-entry محصول غیرفعال بماند. |

راهنمای مرجع در سورس vendored: [DataProvider و informative data](./freqtrade/docs/strategy-customization.md)، [strategy callbacks](./freqtrade/docs/strategy-callbacks.md)، [configuration](./freqtrade/docs/configuration.md)، [protections](./freqtrade/docs/includes/protections.md)، [REST/RPC](./freqtrade/docs/rest-api.md)، [backtesting](./freqtrade/docs/backtesting.md) و [Hyperopt](./freqtrade/docs/hyperopt.md). قابلیت دقیق باید با نسخهٔ Freqtrade نصب‌شده تطبیق داده شود.

### جریان مالکیت تصمیم و داده

1. Freqtrade از exchange adapter خود دادهٔ بازار را می‌گیرد؛ strategy/DataProvider دادهٔ مجاز را با provenance و timestamp به adapter خصوصی SBK1 می‌رساند.
2. SBK1 تحلیل و تصمیم‌های جهت‌دار ورود و خروج عادی را می‌سازد و به شکل فرمان نسخه‌دار و منقضی‌شونده تحویل می‌دهد.
3. Freqtrade فرمان را از نظر config، pair/side، تازگی، وضعیت حساب و حدود ریسک بررسی می‌کند؛ این مرحله فقط می‌تواند بپذیرد یا با دلیل ثبت‌شده رد کند و alpha تازه تولید نمی‌کند.
4. Freqtrade سفارش، partial/full fill، stop و موقعیت را مدیریت می‌کند. hard stop/protection اضطراری می‌تواند مستقل از تصمیم عادی SBK1 عمل کند؛ علت override باید ثبت و گزارش شود.
5. رخداد authoritative معامله از Freqtrade به SBK1 برمی‌گردد و با decision ID و trade/order ID به داشبورد، آرشیو و کالیبراسیون پیوند می‌خورد.

این dataflow هدف معماری است، نه وضعیت تکمیل‌شدهٔ کد فعلی. پل snapshot نسخهٔ v3 از Freqtrade DataProvider به Node با احراز هویت، اعتبارسنجی RPC و ذخیرهٔ in-memory پیاده شده و UI/تحلیل SBK1 از API snapshot استفاده می‌کنند. اجرای read-only واقعی مسیر snapshot را تا Node آزمود. قرارداد اکنون زمان دریافت محلی را از event timestamp صرافی جدا می‌کند: connector برای ticker مقدار `last` معتبر داد ولی timestamp صرافی را نداد؛ در نتیجه freshness دریافت اخیر ثبت می‌شود و فقدان timestamp رویداد همچنان صریح باقی می‌ماند. candles تکمیل‌شده، order book و funding در همان اجرا موجود بودند؛ open interest، recent trades/CVD و aggregation چندصرافی بیرون از قراردادند. strategy همچنان فقط fixture مخصوص dry-run را می‌پذیرد؛ پذیرش تصمیم واقعی SBK1 و خروج معمول مبتنی بر تصمیم SBK1 نیازمند شواهد کالیبراسیون، طراحی، پیاده‌سازی و آزمون مستقل‌اند. این roadmap یا پل داده به‌تنهایی هیچ gate ورود production را باز نمی‌کند.

### Inventory اجرایی اتصال‌های موجود (پیش از حذف هر مسیر)

| مسیر | وضعیت فعلی مشاهده‌شده | مالک/مصرف‌کننده | اقدام مهاجرتی لازم |
|---|---|---|---|
| [freqtradeMarketDataBridge.ts](./src/services/freqtradeMarketDataBridge.ts)، `/api/freqtrade/market-snapshot` و [SbkSignalStrategy.py](./freqtrade_integration/strategies/SbkSignalStrategy.py) | Push نسخه‌دار v3 حداکثر هر ۱۰ ثانیه در dry-run/live؛ کندل‌های تکمیل‌شده از DataProvider، ticker با event timestamp nullable و زمان دریافت محلی، order book و funding؛ Node توکن و پیکربندی RPC را بررسی می‌کند. snapshot قدیمی، config نامنطبق یا دادهٔ نامعتبر رد می‌شود. | cache حافظهٔ Node؛ UI و چند مصرف‌کنندهٔ browser/server به API snapshot متصل شده‌اند. اجرای واقعی ticker با last معتبر و بدون exchange timestamp را نشان داد؛ retrieval freshness و نبود event time جداگانه نگه داشته می‌شوند. | معنای زمان دریافت را برای هر feature و policy مصرف ثبت کن؛ event timestamp ناموجود نباید ساخته شود. آزمون تازگی/قطع/بازیابی و lifecycle read-only لازم است. OI/trades/CVD و چندصرافی بیرون از قرارداد و unavailable هستند. |
| [marketData.ts](./src/services/marketData.ts) | مصرف‌کنندگان اصلی candles، futures ticker، order book و funding از snapshot Freqtrade استفاده می‌کنند؛ نام legacy مانند `fetchBybit` صرفاً wrapper سازگاری است و داده را مستقیم از Bybit نمی‌گیرد. provider خبر/احساسات غیرصرافی جداست. | UI/server از snapshot تازه و provenanceدار استفاده می‌کنند؛ دادهٔ پشتیبانی‌نشده برای eligibility fail-closed می‌شود. | هر مسیر مصرف باقی‌مانده را inventory کن؛ helperهای legacy را پس از trace حذف/نام‌گذاری کن. OI/trades/spot cross-check فقط بعد از اثبات capability، وگرنه unavailable و خارج از eligibility. |
| [websocket.ts](./src/services/websocket.ts) و [App.tsx](./src/App.tsx) | مسیر پیشین WebSocket چندصرافی مرورگر با polling snapshot Freqtrade جایگزین شده؛ callback قیمت دیگر به feed موازی Bybit/Binance/OKX متصل نیست. | UI از SBK1 API و snapshot Freqtrade استفاده می‌کند؛ نام state قدیمی "WebSocket" ممکن است در UI هنوز مانده باشد. | به‌روزرسانی labelها و تکمیل آزمون freshness/reconnect از API؛ هر seed/برآورد قیمت باید از مسیرهای تصمیم/اجرا واقعی جدا بماند. |
| [crossExchangeCorrelationEngine.ts](./src/services/crossExchangeCorrelationEngine.ts) | feed مستقل عمومی چندصرافی غیرفعال شده و مقادیر میان‌صرافی ناموجود به‌صورت unavailable برمی‌گردند. | UI نباید خروجی correlation/liquidity چندصرافی را از مقدار ثابت یا fallback صرافی دیگر نمایش دهد. | برای حفظ این قابلیت، به instanceهای Freqtrade مجزا برای هر exchange/market و aggregator زمان‌هم‌تراز نیاز است؛ تا آن زمان ماژول و gate وابسته خاموش می‌ماند. |
| [server.ts](./server.ts) `/api/orderflow/snapshot` و dry-run fixture | هر دو به snapshot cache محدود و تازهٔ Freqtrade منتقل شده‌اند؛ route orderflow provenance/timestamps را نیز برمی‌گرداند و fixture ticker را از همان snapshot می‌گیرد. cache خالی/کهنه، RPC متوقف یا config نامنطبق خطای صریح می‌دهد. | مسیر انتشار واقعی تا Node آزموده شد، اما ticker در snapshot ناموجود بود؛ fixture اجرا نشد. fixture همچنان admin-only و dry-run-only است. | آزمون endpoint read-only با ticker معتبر و تازگی/قطع/بازیابی؛ تا آن زمان fixture به‌درستی fail-closed می‌ماند. orderbook فعلاً برای ساخت OBI/CVD ساختگی مصرف نمی‌شود. |
| [server.ts](./server.ts) اتصال WebSocket سمت backend | کد WebSocket صرافی و tickهای hedging حذف شده است؛ startup فقط منتظر push snapshot احراز هویت‌شدهٔ Freqtrade می‌ماند. | تنها مسیر فعال دادهٔ بازار در Node، bridge فریکترید است. | تغییرات بعدی نباید connector موازی اضافه کنند؛ قطع/تازگی snapshot باید fail-closed بماند. |
| [server.ts](./server.ts) legacy private Bybit handlers | routeهای خصوصی credentials/balance/order/position/stop، helperهای امضا/vault، و daemon/recovery/reconciliation حذف شده‌اند. default-deny middleware فقط `GET /api/exchange/status` و allowlist محدود `/api/live` را عبور می‌دهد. `scripts/verify_legacy_exchange_routes.ts` با سرور واقعی و fetch غیر-loopback مسدودشده مسیرهای قدیمی را آزموده است. فایل‌های JSON محلی قدیمی دست‌نخورده باقی مانده‌اند ولی runtime دیگر آن‌ها را نمی‌خواند/نمی‌نویسد. | هیچ route قدیمی نباید به API صرافی برسد؛ Freqtrade مرجع واحد state و اجرای سفارش است. | مرز runtime backend پاک‌سازی و آزموده شد؛ profileهای دیگر exchange/market و اجرای زنده خارج از دامنهٔ فعال و نیازمند گیت‌های مستقل‌اند. |
| [realistic_backtester.py](./scripts/realistic_backtester.py) | ابزار پژوهشی فقط فایل محلی Feather فریکترید یا ورودی JSON صریحاً unverified می‌خواند؛ درخواست مستقیم Bybit/Binance ندارد و هرگز مجوز اجرای زنده صادر نمی‌کند. Feather از نظر ستون‌ها، OHLC geometry، زمان آینده، cadence و کندل کامل بررسی می‌شود؛ منشأ صرافی و feature/تصمیم تاریخی SBK1 اثبات نمی‌شود. | محاسبهٔ پژوهشی جداگانه، نه مسیر اجرای production یا کالیبراسیون SBK1. | فقط برای تحقیق محدود؛ شواهد calibration باید از snapshotهای تصمیم واقعی SBK1 و outcomeهای authoritative Freqtrade ساخته شود. |

مرز backend صرافی و ابزار backtest پژوهشی اکنون از connectorهای مستقیم جدا شده‌اند. قابلیت‌هایی که DataProvider/bridge فریکترید در اختیار نمی‌گذارند همچنان unavailable هستند؛ ممنوعیت fallback مستقیم به معنی «رد/عدم دسترسی امن» است و نباید وانمود شود فریکترید feature گمشده‌ای را تأمین کرده است.

## مراحل و معیارهای پذیرش

### مرحلهٔ ۰ — تثبیت خط مبنا و ممیزی شکاف‌ها

**کارها**
- ثبت مسیرهای فعال، غیرفعال و legacy در UI، سرور، سرویس داده، پل، strategy و Freqtrade؛ مالکیت هر داده و هر فرمان روشن باشد.
- فهرست‌کردن همهٔ اتصال‌های مستقیم فعلی به صرافی در browser/server/serviceها—از جمله Bybit/KuCoin، کندل، ticker و Last/Mark/Index—و callerهایشان؛ تعیین اینکه هر مصرف‌کننده از کدام قابلیت واقعی Freqtrade تغذیه خواهد شد.
- برای هر دادهٔ موردنیاز، مشخص‌کردن اینکه در نسخهٔ نصب‌شده از طریق strategy/DataProvider، تاریخچه، RPC یا رخداد Freqtrade قابل‌دسترسی است یا نه. نبود یک فیلد پشتیبانی‌شده باید به‌عنوان شکاف/NO TRADE ثبت شود؛ منبع مستقیم دوم ساخته نشود.
- تکمیل ماتریس قابلیت با ستون‌های: قابلیت، مالک، ورودی/خروجی و provenance، بازارهای مرتبط، ریسک، وضعیت فعلی، آزمون و مدرک پذیرش.
- ثبت نسخهٔ دقیق سورس Freqtrade/CCXT، وابستگی‌ها، نصب تمیزپذیری و تغییرات کاربر موجود؛ بدون پاک‌سازی یا overwrite فایل‌های خصوصی/runtime.
- فهرست‌کردن تمام مسیرهای direct-exchange legacy و UIهایی که ممکن است به‌اشتباه کنترل اجرایی فعال نشان دهند.

**پذیرش**
- هر مسیر سفارش/موقعیت فقط یک مالک اجرایی مستند داشته باشد.
- هیچ مسیر legacy مستقیم به exchange در SBK1 فعال یا مبهم باقی نماند؛ حذف connectorهای موجود تنها پس از انتقال و آزمون مصرف‌کننده‌ها مجاز است.
- برای داده‌ای که Freqtrade/پروفایل صرافی فراهم نمی‌کند، fallback مستقیم یا downgrade خاموش وجود نداشته باشد؛ وضعیت unavailable باید آشکار و fail-closed باشد.
- برای هر قابلیت، وضعیت «فعال / پژوهشی / غیرفعال / نیازمند شواهد» و مدرک لازم ثبت شده باشد.

### مرحلهٔ ۱ — معماری اعتماد، قرارداد و پل پایدار

**کارها**
- تعریف قراردادهای نسخه‌دار تصمیم، سیگنال، رخداد سفارش و نتیجهٔ معامله با شناسهٔ هم‌بستگی، انقضا، idempotency، قواعد تغییر وضعیت، خطای صریح و سازگاری نسخه.
- حفظ معماری سیگنال‌محور موجود: `SbkSignalStrategy` مصرف‌کننده/adapter تصمیم SBK1 است؛ `populate_entry_trend` فقط پس از دریافت تصمیم واقعی، معتبر و منطبق با pair/timeframe آن را به ورودی native Freqtrade تبدیل می‌کند. fixture فعلی صرفاً آزمون قرارداد Dry-run است و نباید به‌جای سیگنال production استفاده شود.
- تعیین معماری ingress دادهٔ صرافی: ترجیح محاسبه/دریافت در strategy/DataProvider بومی Freqtrade؛ در صورت نیاز بیرونی، adapter محدود از همان داده با schema، timestamp/provenance و احراز هویت. از افزودن CCXT/REST client موازی در SBK1 برای همان exchange پرهیز شود.
- تفکیک ingress دادهٔ صرافی از providerهای غیرصرافی و تعریف قواعد کیفیت/تازگی؛ ورودی اجباری exchange که از Freqtrade نرسد، NO TRADE ایجاد کند.
- تعریف دو قرارداد اجرایی روشن: تصمیم‌های عادی ورود/خروج از SBK1؛ veto فنی، سقف‌های ریسک و hard stop اضطراری از Freqtrade. Freqtrade نباید جهت معامله یا خروج عادی را مستقل از SBK1 پیش‌بینی کند.
- استفاده از callbackهای موجود Freqtrade به‌عنوان مرز adapter، نه موتور تحلیل موازی: signal validation در `confirm_trade_entry`, sizing در `custom_stake_amount`, stop اضطراری در `custom_stoploss` و exit عادی SBK1 از مسیر سیگنال/callback مشخص و lifecycle ثبت‌شده.
- جایگزینی تدریجی ذخیره‌ساز JSON تک‌نویسنده با persistence تراکنشی و durable؛ ثبت تغییر وضعیت به‌شکل append-only و حفظ Freqtrade DB به‌عنوان منبع واقعی معامله.
- مستندسازی احراز هویت، rotation اسرار، حداقل دسترسی، rate limit، audit trail، نگهداری و بازیابی؛ مسیر قطع ارتباط/پاسخ نامعلوم باید قرنطینه و reconcile شود و retry کور نداشته باشد.
- تفکیک health/readiness برای Node، RPC، پل، داده و strategy. تنها backend مجاز به فراخوانی API خصوصی Freqtrade باشد.

**پذیرش**
- تکرار درخواست، قطع ارتباط در لحظهٔ ارسال، پاسخ نامعلوم، انقضا، restart و بازیابی، بدون سفارش تکراری یا وضعیت موفقیت گمراه‌کننده مدیریت شوند.
- در صورت نبود آرشیو معتبر/کالیبراسیون، مسیر عادی production همچنان fail-closed باشد؛ بازشدن مسیر fixture یا تست به معنی مجوز معاملهٔ واقعی نیست.
- هیچ credential/token در bundle مرورگر، پاسخ عمومی یا log افشا نشود.
- تا زمان آماده‌شدن persistence چندنویسنده، تک‌نمونه‌بودن صریح و enforce شود.

### مرحلهٔ ۲ — آرشیو واقعی، data provenance و حلقهٔ نتیجه

**کارها**
- ساخت آرشیو سمت سرور از تصمیم timestampدار، snapshot ویژگی‌های موجود همان لحظه، نسخهٔ کد/مدل/قواعد، کیفیت و منبع داده، signal ID، Freqtrade trade ID، order/fill، fee و نتیجهٔ نهایی.
- جایگزینی `localStorage` به‌عنوان منبع شواهد آموزشی/کالیبراسیون با دادهٔ مشترک سمت سرور؛ نتیجهٔ نامتصل به trade معتبر برای آموزش/عملکرد واجد شرایط نیست.
- تعریف کیفیت و معنای داده برای candle کامل، زمان رویداد/دریافت، exchange/symbol/market/timeframe، و دادهٔ اختیاری مثل order book، funding و open interest که برای همان پروفایل واقعاً از مسیر بومی Freqtrade موجود باشد. Last/Mark/Index قابل‌جایگزینی با یکدیگر نیستند.
- فراهم‌کردن بازپخش تاریخی از دادهٔ واقعی و تصمیم‌های ثبت‌شده، با کنترل هم‌ترازی زمانی، missing interval، اطلاعات آینده، تغییر نماد/لیست جفت‌ها و بازنگری schema.

**پذیرش**
- هر metric و label تا ورودی خام و نسخهٔ سازنده قابل‌ردیابی باشد.
- فقط outcome تأییدشده از Freqtrade با شناسهٔ معتبر وارد کالیبراسیون شود؛ ناقص/نامعلوم کنار گذاشته شود و علت ثبت گردد.
- آرشیو بتواند completeness، پوشش زمانی و کیفیت داده را قبل از پژوهش گزارش کند.

### مرحلهٔ ۳ — پژوهش و استفادهٔ سنجیده از قابلیت‌های Freqtrade

**قابلیت‌هایی که باید در ماتریس ارزیابی شوند**
- استراتژی‌ها و callbackهای اجرا، stop/exit و position sizing.
- دانلود و نگهداری دادهٔ تاریخی و backtesting با fee/slippage/funding و زمان‌بندی واقعی بازار.
- Hyperopt، فقط برای جست‌وجوی پارامتر در دادهٔ آموزشی/اعتبارسنجی و نه به‌عنوان اثبات سودآوری.
- پایش drift و کیفیت خروجی تحلیل‌گرهای advisory، ثبت نسخهٔ وابستگی/مدل و قابلیت بازتولید نتایج.
- Pairlists و protections، informative timeframes و pluginهای مرتبط.
- REST/RPC و در صورت نیاز Telegram/webhook/Producer-Consumer؛ هر سطح دسترسی جدا و با مرز اعتماد روشن.

**کارها و پذیرش**
- strategy تاریخی SBK1 باید از تصمیم/featureهای آرشیوشده بازتولید شود؛ صف سیگنال زنده جای بک‌تست تاریخی نیست.
- تعریف پروتکل پژوهش پیش از اجرا: دادهٔ واقعی، بازه‌های train/validation/out-of-sample، walk-forward، هزینه‌های معاملاتی، معیارهای قبولی و عدم‌قطعیت.
- برای Hyperopt و تحلیل‌گرهای یادگیری ماشین، جلوگیری از leakage و انتخاب پسینی بهترین نتیجه بررسی شود؛ خروجی فعلی صرفاً evidence کمکی می‌ماند.
- هر plugin/قابلیت تنها در صورت نیاز روشن، ورودی قابل‌اعتماد، آزمون بازار هدف و runbook عملیاتی پذیرفته شود. وجود قابلیت در Freqtrade به‌تنهایی دلیل استفاده نیست.
- بک‌تست بدون تصمیم‌های تاریخی SBK1 یا بدون دادهٔ لازم صریحاً نامعتبر/غیرقابل‌اجرا گزارش شود، نه با خروجی ساختگی جایگزین گردد.
- تحلیل‌گرهای متن‌باز SBK1 در `freqtrade_integration/advisory/open_source_advisory_worker.py` به‌صورت worker محلی JSON-lines اجرا می‌شوند؛ هر یک از شش خروجی به مالک یکتای خود در شورای هشت‌عضوی متصل است. برای جلوگیری از معطل‌ماندن مسیر تصمیم روی آموزش/استنتاج مدل‌ها، این تحلیل‌ها در پس‌زمینه اجرا و پس از تکمیل ثبت می‌شوند و تضمینی نیست که در رأی همان کندل حاضر باشند. گزارش هر snapshot در `data/council-members/member-XX.jsonl` و رأی در `council-votes.jsonl` ذخیره می‌شود؛ این دو آرشیو با TTL پنج‌ساعته پاک‌سازی می‌شوند. خروجی پشتیبان رأی جداگانه نمی‌سازد و فقط رأی عضو مالک شمرده می‌شود. پس از حدنصاب، کنترل واحد اجرایی جهت شورا را مرجع می‌گیرد و شروط ورود و ریسک را بررسی می‌کند.
- inference مدل sentiment در فرایند فرزند جداگانه و پیش از بارگذاری مدل‌های بازار اجرا می‌شود تا حافظهٔ Torch با مدل‌های آماری/درختی در یک فرایند جمع نشود؛ زمان آن به ۶۰ ثانیه محدود است و شکست یا timeout فقط همان ماژول را `UNAVAILABLE` می‌کند.
- وابستگی‌های این تحلیل‌ها جدا از Freqtrade در `freqtrade_integration/requirements-analysis.txt` تعریف شده‌اند. مدل خبر با revision ثابت و cache محلی بارگذاری می‌شود؛ نبود هر dependency یا وزن مدل باید همان ماژول را `UNAVAILABLE` کند.
- آماده‌سازی محلی: `npm run provision:open-source-analysis`. وابستگی‌ها در محیط جداگانهٔ `.cache/sbk1/open-source-analysis-venv` و وزن مدل خبر با revision ثابت در `.cache/sbk1/open-source-models` نصب می‌شوند؛ هر دو مسیر وارد Git نمی‌شوند.
- خروجی‌های متن‌باز `ADVISORY_ONLY` می‌مانند و به‌تنهایی سفارش یا سایز ریسک را مجاز نمی‌کنند. فقط رأی عضو مالک در شورا شمرده می‌شود؛ خروجی‌های پشتیبان رأی مستقل اضافه نمی‌کنند. شورا باید به حدنصاب ۵ از ۸ برسد؛ جهت شورا پس از آن مرجع تصمیم است و کنترل واحد شروط ورود و گیت‌های ریسک را بررسی می‌کند، نه اینکه یک رأی جهت‌گیری دوم بسازد. برخی کنترل‌های کیفیت عضو و شروط اجرایی ممکن است همان منبع داده را برای دو مسئولیت جدا بررسی کنند؛ این بررسی اجرایی جای رأی عضو را نمی‌گیرد. عضو اختیار معامله، جریان نهنگ‌ها، DXY دقیق و ETF فقط در صورت اتصال منبع معتبر رأی‌پذیرند؛ دادهٔ موجودِ proxy یا تعداد آدرس‌های فعال جایگزین آن‌ها نیست. FreqAI در یکپارچه‌سازی SBK1 استفاده نمی‌شود؛ قابلیت upstream آن در سورس vendored Freqtrade بخشی از پروژهٔ SBK1 نیست.

### مرحلهٔ ۴ — سیاست ریسک واحد و چرخهٔ کامل معامله

**کارها**
- تعریف سیاست نسخه‌دار برای exposure، stake sizing، leverage، تعداد موقعیت، سقف زیان/drawdown، هم‌بستگی، partial fill و قواعد توقف؛ اعداد با مالک سیستم و شواهد تعیین می‌شوند، نه حدس.
- استفاده از تنظیمات/callbackهای native Freqtrade به‌ترتیب: `max_open_trades`, `stake_amount` و `tradable_balance_ratio`; `custom_stake_amount` برای سقف ریسک سیگنال؛ `unfilledtimeout` و order types برای سفارش باز؛ `stoploss`/`custom_stoploss` برای hard stop؛ `stoploss_on_exchange` فقط در venue/market گواهی‌شده؛ `Protections` شامل `StoplossGuard`, `MaxDrawdown`, `CooldownPeriod` و `LowProfitPairs` پس از مصوب‌شدن پارامترها.
- trailing و خروج سود را یک سیاست واحد مشخص کند. `minimal_roi`, `custom_exit`, سیگنال خروج SBK1 و trailing می‌توانند هم‌پوشانی داشته باشند؛ فقط ترکیب آزموده‌شده و با precedence مستند مجاز است. در مدل پایه، SBK1 مالک تصمیم عادی خروج و Freqtrade مالک hard stop/اجرای سفارش است.
- `adjust_trade_position` برای افزودن/کاهش stake تنها با نیاز محصول روشن، حد و cadence ایمن، و آزمون partial fill/restart فعال شود؛ در غیر این صورت خاموش بماند.
- تکمیل و آزمون مسیر signal ورود SBK1 → order → partial/full fill → تصمیم خروج عادی SBK1 → خروج اجرایی Freqtrade → closed outcome و reconciliation پس از restart؛ hard stop/protection اضطراری Freqtrade مسیر override جدا و قابل‌ممیزی داشته باشد.
- نمایش دقیق دامنهٔ اثر kill switch و ابزار عملیات دستی/اضطراری، با تأیید معتبر از Freqtrade.

**پذیرش**
- Testnet/Dry-run واقعی، با وضعیت قابل مشاهده در Freqtrade، سناریوهای fill/timeout/لغو/بازیابی و خطا را پوشش دهد.
- برای هر رفتار، یک مالک یگانه باشد؛ اعداد نمونه، `stake_amount: unlimited` به‌عنوان سیاست production، یا `stoploss_on_exchange` آزمون‌نشده پذیرفته نیستند.
- در mismatch، RPC/data failure یا UNKNOWN_IN_FLIGHT ورود جدید متوقف شود تا reconciliation تکمیل شود.
- هر رخداد سفارش در UI با مرجع Freqtrade و زمان دریافت گزارش شود؛ تخمین محلی fill به‌عنوان واقعیت عرضه نشود.

### مرحلهٔ ۵ — پوشش همهٔ صرافی‌های پشتیبانی‌شده

**کارها**
- منبع فهرست صرافی‌ها، نسخهٔ pinشدهٔ Freqtrade/CCXT باشد؛ registry سازگاری با تاریخ/نسخه و تغییرات API نگهداری شود.
- برای هر exchange/market، capability matrix تهیه شود: spot/margin/futures، perpetual/settlement، نماد و quote، leverage/position mode، reduce-only، انواع سفارش/stop، precision و minimum notional، fee/funding، rate limit، دادهٔ بازار، sandbox/Testnet و محدودیت‌های API.
- ماتریس داده جداگانه مشخص کند که آیا Freqtrade در آن پروفایل candles، ticker/pricing، Last/Mark/Index، order book/trades، funding و open interest را واقعاً پشتیبانی/در اختیار strategy می‌گذارد؛ قابلیت CCXT به‌تنهایی به معنی پوشش Freqtrade نیست.
- تنظیمات فعلی Bybit و یک جفت به پروفایل‌های صریح تبدیل شوند. تا اثبات خلاف، هر exchange/market profile در process، config، database و secrets مجزا اجرا شود.
- هر صرافی به‌ترتیب اولویت محصول از آزمون read-only و market data، به Testnet و سپس lifecycle/restart واقعی در محیط تست عبور کند. نبود Testnet یا قابلیت لازم باید blocker مستند باشد، نه موفقیت ضمنی.

**پذیرش**
- صرف قرارداشتن نام صرافی در تنظیمات یا فهرست CCXT برابر «پشتیبانی‌شده توسط SBK1» نیست.
- هر پروفایل فعال سند گواهی شامل نسخه، محدودیت‌ها، آزمون‌های گذرانده و runbook دارد؛ تغییر نسخه/API، گواهی مجدد لازم دارد.

### مرحلهٔ ۶ — داشبورد، امنیت عملیاتی و استقرار خصوصی

**کارها**
- داشبورد وضعیت تحلیل را از وضعیت اجرایی authoritative جدا کند؛ تازگی و منبع داده، وضعیت پل/RPC، علت رد، سیگنال، Freqtrade trade/order ID و fill را جداگانه نشان دهد.
- پس از انتقال و آزمون مصرف‌کننده‌ها، client/serviceهای مستقیم exchange در SBK1 حذف یا غیرفعال شوند؛ هنگام اختلال، downgrade خاموش به feed مستقیم دیگری انجام نشود.
- APIهای SBK1 برای status/history/alerts/operations تعریف شوند؛ browser هیچ دسترسی مستقیمی به API مدیریت Freqtrade نداشته باشد.
- هشدار برای RPC/bridge قطع، دادهٔ کهنه، صف/DB، mismatch در reconciliation، رد سفارش، drawdown و خطای مدل؛ health/readiness/liveness مجزا.
- backup/restore و آزمون بازیابی DB، outbox، مدل‌ها و تنظیمات؛ rollback و upgrade runbook؛ pin نسخهٔ Freqtrade/CCXT و lock وابستگی‌ها.
- پس از تثبیت اجرای محلی، طراحی استقرار خصوصی با TLS، private networking، secret manager، least privilege، محدودیت دسترسی admin، backup رمزگذاری‌شده و برنامهٔ incident response.

**پذیرش**
- عملیات از طریق SBK1 و مسیرهای مجاز انجام شود و نیاز به بازکردن RPC عمومی نداشته باشد.
- backup restore و reconciliation پس از restore آزمایش و مستند شود.
- هشدار مهم دارای علت، اثر، اقدام بعدی و مرجع رخداد باشد؛ هیچ dashboard labelی سیگنال را به fill تبدیل نکند.

### مرحلهٔ ۷ — دروازه‌های rollout و احتمال معاملات واقعی

| Gate | شرط عبور |
|---|---|
| A — کد/امنیت | قراردادها، authorization، مدیریت اسرار، migration، lint/build و تست‌های مرتبط موفق؛ یافتهٔ بحرانی باز نماند. |
| B — داده/تاریخچه | منبع و کیفیت داده قابل‌ردیابی، آرشیو کامل، نتیجه‌های Freqtrade قابل‌پیوند و نبود leakage اثبات شود. |
| C — Dry-run/Testnet | اتصال، order lifecycle، recovery، stop/exit و runbook روی محیط واقعی غیرتولیدی اجرا و ثبت شود. |
| D — شواهد مدل/ریسک | ارزیابی out-of-sample و هزینه‌های واقعی، آستانه‌های ازپیش‌توافق‌شده، review مستقل و محدودیت‌های شناخته‌شده تأیید شوند. |
| E — بهره‌برداری محدود | فقط با تأیید صریح جداگانه، کلیدهای محدود بدون برداشت، سقف‌های مستقل، مانیتورینگ فعال، rollback و kill/reconciliation آزموده‌شده بررسی شود. |

آستانهٔ سودآوری/ریسک عددی در این سند تعیین نشده است؛ پیش از مشاهدهٔ نتایج، مالک سیستم باید آن را با توجه به سرمایه، بازار، هزینه و تحمل ریسک تعیین کند. عبور از gate به معنی تضمین سود یا حذف ریسک نیست. هر شکست، مدرک ناکافی یا تغییر مهم نسخه به NO-GO/بازگشت به gate مربوط منجر می‌شود.

## نگاشت شروع کار به فایل‌ها

فهرست زیر نقاط شروع بررسی است، نه دستور بازنویسی یک‌باره:

- معماری و رویهٔ اجرا: [server.ts](./server.ts)، [scripts/run_sbk1.ts](./scripts/run_sbk1.ts)، [README.md](./README.md)
- پل و قرارداد: [freqtradeBridge.ts](./src/services/freqtradeBridge.ts)، [freqtradeSignalAdapter.ts](./src/services/freqtradeSignalAdapter.ts)، [SbkSignalStrategy.py](./freqtrade_integration/strategies/SbkSignalStrategy.py)
- پیکربندی: [config.example.json](./freqtrade_integration/config.example.json)، [.env.example](./.env.example)
- تاریخچه/داشبورد: [App.tsx](./src/App.tsx)، [centralTradeDataset.ts](./src/services/centralTradeDataset.ts)
- شواهد فعلی و محدودیت‌های قبلی: [AUDIT.md](./AUDIT.md)

هر تغییر آینده باید فقط پس از بررسی diff همان فایل و تغییرات محلی موجود انجام شود. آزمون‌های نزدیک به تغییر اجرا شوند؛ تست سراسری Freqtrade فقط وقتی لازم است که تغییر core/نسخهٔ آن را دربر بگیرد.

## مرز کار و وضعیت سند

- این نقشه‌راه برنامهٔ اجرایی مرحله‌ای است، نه گواهی آمادگی برای معاملهٔ واقعی.
- «استفاده از همهٔ امکانات» به معنی ارزیابی کامل و استفاده از قابلیت‌های مرتبط پس از اثبات ارزش/ایمنی است، نه فعال‌سازی هم‌زمان همهٔ ماژول‌ها.
- «همهٔ صرافی‌ها» یعنی پوشش مرحله‌ای تمام venueهای پشتیبانی‌شده در نسخهٔ pinشده؛ رفتار API بیرونی و پشتیبانی آینده تضمین دائمی ندارد.
- دادهٔ market مصنوعی یا mock هرگز شاهد پژوهش، آموزش، backtest یا عملکرد تلقی نمی‌شود. fixture محدود پروتکل، اگر برای آزمون قرارداد لازم باشد، فقط صحت schema/رفتار نرم‌افزار را می‌سنجد و باید از مسیر تصمیم واقعی جدا بماند.
- اجرای این roadmap به‌صورت Gate-by-Gate انجام می‌شود؛ rollout به سرور خصوصی و هرگونه live execution به تأیید و بررسی جداگانه نیاز دارد.

## وضعیت اجرایی مهاجرت داده تا این بازبینی

- قرارداد snapshot خصوصی Freqtrade نسخهٔ v3 برای کندل‌های اصلی/تکمیلی، ticker با Last/Mark/Index و تفکیک event/retrieval time، order book و funding تعریف و اعتبارسنجی شده است؛ اجرای واقعی اخیر candles/order book/funding و ticker تازه‌خوانده‌شده را تأیید کرد اما exchange event timestamp را نه. ادعای feed timestampدار کامل برای ticker مجاز نیست.
- مصرف‌کننده‌های مرورگر در `marketData.ts`, `websocket.ts` و `App.tsx` برای دادهٔ بازار صرافی‌محور به endpoint داخلی snapshot منتقل شده‌اند؛ دیگر feed بازار مستقیم در UI فعال نیست. شاخص Fear & Greed همچنان provider غیرصرافی جدا دارد.
- اگر snapshot فیلدی را تأمین نکند، مقدار UNKNOWN/UNAVAILABLE می‌ماند: OI و تاریخچهٔ funding، trade flow/CVD و basis/spread چندبازاری موجود نیستند؛ امتیاز همبستگی/اسلیپیج بین‌صرافی عمداً غیرفعال است. هیچ‌یک با مقدار فرضی یا دادهٔ venue دیگر جایگزین نمی‌شوند و گیت‌های spread/دادهٔ حیاتی باید معامله را متوقف کنند.
- **پاک‌سازی مرز مستقیم صرافی در backend انجام شده است:** بدنه‌های مستقیم Bybit، vault/signing، routeهای private قدیمی، daemon، بازیابی/تطبیق محلی و WebSocket backend از `server.ts` حذف شدند. default-deny فقط `GET /api/exchange/status` (Freqtrade RPC) و allowlist مشخص `/api/live` را عبور می‌دهد. تست HTTP واقعی `verify_legacy_exchange_routes.ts` با مسدودسازی fetch غیر-loopback مسیرهای قدیمی را آزمون می‌کند. فایل‌های قدیمی JSON حذف یا بازنویسی نشده‌اند.
- **ادغام عملیاتی/تولیدی هنوز تکمیل نیست:** مسیر signal واقعی تا ارائهٔ آرشیو معتبر و برچسب‌خوردهٔ تصمیم‌ها/featureهای هم‌زمان و outcome قطعی Freqtrade به‌علت `CALIBRATED_CONFIDENCE_UNAVAILABLE` بسته می‌ماند. این مانع با حذف connectorهای legacy یا کاهش threshold حل نمی‌شود؛ تا تکمیل OOS calibration، نتیجه NO TRADE است. Dry-run fixture مسیر قرارداد را می‌آزماید، نه کیفیت استراتژی.
- آزمون قرارداد و مجموعهٔ فعلی پروژه صحت schema و گیت‌های نرم‌افزار را می‌سنجند؛ اجرای واقعی Freqtrade، نرخ درخواست‌های DataProvider، timestamp/provenance زنده، Testnet و end-to-end هنوز اثبات نشده‌اند. هیچ سفارش زنده‌ای در این مرحله اجرا نشده است.
