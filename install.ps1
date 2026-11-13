# One-click installer for Windows: registers the native host with Chrome.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostPy = Join-Path $root "native-host\host.py"

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) {
    Write-Host "Python not found. Install it from python.org and run this again." -ForegroundColor Red
    exit 1
}

$bat = Join-Path $root "native-host\host.bat"
Set-Content -Path $bat -Value "@echo off`r`n`"$py`" `"$hostPy`" %*" -Encoding ASCII

$id = Read-Host "Paste the extension ID from chrome://extensions"
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
Write-Host "Installed. Fully close and reopen Chrome." -ForegroundColor Green
