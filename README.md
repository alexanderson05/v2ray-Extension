# V2 Client (Chrome Extension)

کلاینت V2Ray/Xray برای کروم با پشتیبانی از لینک اشتراک (Subscription).
فقط ترافیک Chrome از تونل عبور می‌کند.

## نصب (ویندوز، فقط یک بار)

1. فایل ZIP را از بخش **Releases** دانلود کن و Extract کن.
2. فایل `xray.exe` را داخل پوشه `native-host` بگذار. از [Xray-core releases](https://github.com/XTLS/Xray-core/releases) دانلودش کن.
3. Chrome را باز کن، به `chrome://extensions` برو، **Developer mode** را روشن کن، روی **Load unpacked** بزن و پوشه `extension` را انتخاب کن. ID کارت V2 Client را کپی کن.
4. روی `install.bat` دوبار کلیک کن و ID را وارد کن.
5. Chrome را کامل ببند و دوباره باز کن.

پیش‌نیاز: Python ۳.۸ یا بالاتر (از python.org).

## استفاده

1. لینک اشتراک یا کانفیگ‌های `vless://`، `vmess://` یا `trojan://` را وارد کن.
2. یک سرور را انتخاب کن و دکمه ⏻ را بزن.

## محدودیت‌ها

- فقط ترافیک Chrome پراکسی می‌شود.
- Shadowsocks پشتیبانی نمی‌شود.
- در حال توسعه و هنوز کامل تست نشده.

## مجوز

MIT
