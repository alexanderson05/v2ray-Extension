@echo off
title V2 Client - Setup
set "SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:SELF); Invoke-Expression $t.Substring($t.IndexOf('#'+'PS-START'))"
echo.
pause
exit /b
#PS-START
# V2 Client - one-time helper setup (Windows). Designed by Alex Anderson.
# This script is plain text: you can open it in Notepad and read everything it does.
# It (1) writes the helper script, (2) makes sure Python is available,
# (3) tells Chrome where the helper is. Nothing is installed system-wide.
$ErrorActionPreference = 'Stop'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ExtId = '@@EXT_ID@@'
    $Dir = Join-Path $env:LOCALAPPDATA 'V2Client'
    Write-Host ''
    Write-Host '  V2 Client - helper setup' -ForegroundColor Cyan
    Write-Host '  Designed by Alex Anderson' -ForegroundColor DarkGray
    Write-Host ''
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null

    Write-Host '  [1/3] Writing helper...'
    $hostB64 = '@@HOST_B64@@'
    [IO.File]::WriteAllBytes((Join-Path $Dir 'host.py'), [Convert]::FromBase64String($hostB64))

    Write-Host '  [2/3] Checking Python...'
    function Test-Py($exe) {
        try {
            $v = & $exe -c "import sys;print(1 if sys.version_info[:2]>=(3,8) else 0)" 2>$null
            return ("$v".Trim() -eq '1')
        } catch { return $false }
    }
    $py = $null
    $embedded = Join-Path $Dir 'python\python.exe'
    if ((Test-Path $embedded) -and (Test-Py $embedded)) { $py = $embedded }
    if (-not $py) {
        foreach ($c in @('python', 'python3')) {
            $cmd = Get-Command $c -ErrorAction SilentlyContinue
            if ($cmd -and ($cmd.Source -notlike '*\WindowsApps\*') -and (Test-Py $cmd.Source)) { $py = $cmd.Source; break }
        }
    }
    if (-not $py) {
        Write-Host '        Python not found - downloading a private copy (about 10 MB)...'
        $urls = @(
            'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
            'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip'
        )
        $zip = Join-Path $Dir 'python-embed.zip'
        $got = $false
        foreach ($u in $urls) {
            try { Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $zip; $got = $true; break } catch { Write-Host ("        Could not download " + $u) -ForegroundColor Yellow }
        }
        if (-not $got) { throw 'Could not download Python. Install Python 3.8+ from python.org and run this file again.' }
        Expand-Archive -Path $zip -DestinationPath (Join-Path $Dir 'python') -Force
        Remove-Item $zip -Force
        $py = $embedded
        if (-not (Test-Py $py)) { throw 'The downloaded Python does not run on this PC.' }
    }
    Write-Host ('        Using: ' + $py)

    Write-Host '  [3/3] Registering with Chrome...'
    $bat = Join-Path $Dir 'host.bat'
    [IO.File]::WriteAllText($bat, ("@echo off`r`n`"" + $py + "`" `"" + (Join-Path $Dir 'host.py') + "`"`r`n"), [Text.Encoding]::ASCII)
    $batEsc = $bat.Replace('\', '\\')
    $json = @"
{
  "name": "com.v2client.host",
  "description": "V2 Client native host",
  "path": "$batEsc",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ExtId/"]
}
"@
    $manifest = Join-Path $Dir 'com.v2client.host.json'
    [IO.File]::WriteAllText($manifest, $json, (New-Object Text.UTF8Encoding($false)))
    foreach ($root in @(
        'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
        'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
        'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts',
        'HKCU:\Software\Chromium\NativeMessagingHosts')) {
        $k = Join-Path $root 'com.v2client.host'
        New-Item -Path $k -Force | Out-Null
        Set-ItemProperty -Path $k -Name '(default)' -Value $manifest
    }
    Write-Host ''
    Write-Host '  Done! Go back to the V2 Client extension and press "Check again".' -ForegroundColor Green
} catch {
    Write-Host ''
    Write-Host ('  Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '  Send a screenshot of this window so it can be fixed.' -ForegroundColor Red
}
