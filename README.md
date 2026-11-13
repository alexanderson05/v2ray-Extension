# V2 Client (Chrome Extension)

کلاینت V2Ray/Xray برای کروم، با رابط کاربری ساده و پشتیبانی از اشتراک (Subscription).
فقط ترافیک خود کروم از تونل عبور می‌کند؛ بقیه برنامه‌های سیستم تحت تأثیر نیستند.

## ویژگی‌ها

- پشتیبانی از VMess، VLESS و Trojan
- افزودن چند کانفیگ با چسباندن لینک‌ها (هر خط یک لینک)
- پشتیبانی از اشتراک (Subscription) با لینک HTTP/HTTPS، هم متن ساده و هم Base64
- انتخاب سرور و اتصال/قطع با یک دکمه
- پشتیبانی از REALITY، TLS، WS و gRPC

## معماری

```
[Chrome Extension] --chrome.proxy--> [127.0.0.1:10808 SOCKS5] <--stdio-- [Native Host (Python)] --> [xray-core]
```

- **extension/**: رابط کاربری، parser لینک‌ها و اشتراک
- **native-host/**: اسکریپت Python که xray-core را با کانفیگ تولیدشده اجرا می‌کند

## پیش‌نیازها

- Google Chrome یا Chromium
- Python 3.8+
- [xray-core](https://github.com/XTLS/Xray-core/releases)

## نصب

### ۱. xray-core
باینری xray را دانلود کن و مسیرش را در متغیر محیطی `XRAY_PATH` بگذار، یا آن را در `PATH` قرار بده.

### ۲. اکستنشن
1. به `chrome://extensions` برو و **Developer mode** را روشن کن.
2. روی **Load unpacked** بزن و پوشه `extension/` را انتخاب کن.
3. ID اکستنشن را کپی کن.

### ۳. Native Host
1. در `native-host/com.v2ray.chrome.host.json` مقدار `path` را به مسیر مطلق `host.py` و `allowed_origins` را به `chrome-extension://<ID>/` تغییر بده.
2. فایل JSON را در پوشه مربوط به سیستم قرار بده:
   - **Linux**: `~/.config/google-chrome/NativeMessagingHosts/`
   - **macOS**: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
   - **Windows**: کلید `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.v2ray.chrome.host` را بساز که مقدارش مسیر فایل JSON باشد. برای Windows به جای `host.py` باید یک فایل `.bat` بسازی که `python host.py` را اجرا کند و مسیر `path` را به آن بدهی.
3. روی Linux/macOS: `chmod +x native-host/host.py`

## استفاده

1. روی آیکون اکستنشن کلیک کن.
2. لینک‌های `vless://`، `vmess://` یا `trojan://` را در کادر بگذار و **افزودن** را بزن.
3. برای اشتراک، آدرس را وارد کن و **افزودن اشتراک** را بزن. با **بروزرسانی** لیست را تازه کن.
4. یک سرور را انتخاب کن و دکمه ⏻ را بزن.

## محدودیت‌ها

- فقط ترافیک مرورگر کروم پراکسی می‌شود. برای کل سیستم از کلاینت دسکتاپ یا TUN استفاده کن.
- Shadowsocks هنوز پشتیبانی نمی‌شود.
- این پروژه در مرحله اولیه است و هنوز به‌طور کامل تست نشده است.

## مجوز

MIT
