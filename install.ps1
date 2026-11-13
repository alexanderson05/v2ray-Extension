# نصب خودکار (ویندوز)

این فایل مسیر Python، فایل `host.bat` و ثبت رجیستری Chrome را خودکار انجام می‌دهد. کاربر فقط یک بار اجرایش می‌کند.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostPy = Join-Path $root "native-host\host.py"
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) {
    Write-Host "Python پیدا نشد. از python.org نصبش کن و دوباره اجرا کن." -ForegroundColor Red
    exit 1
}
$bat = Join-Path $root "native-host\host.bat"
Set-Content -Path $bat -Value "@echo off`r`n`"$py`" `"$hostPy`" %*" -Encoding ASCII

$id = Read-Host "ID اکستنشن را از chrome://extensions وارد کن"
$jsonPath = Join-Path $root "native-host\com.v2ray.chrome.host.json"
$cfg = @{
    name = "com.v2ray.chrome.host"
    description = "V2 Client native host"
    path = $bat
    type = "stdio"
    allowed_origins = @("chrome-extension://$id/")
}
$cfg | ConvertTo-Json | Set-Content -Path $jsonPath -Encoding UTF8

reg.exe add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.v2ray.chrome.host" /ve /t REG_SZ /d "$jsonPath" /f | Out-Null
Write-Host "نصب انجام شد. Chrome را کامل ببند و دوباره باز کن." -ForegroundColor Green
