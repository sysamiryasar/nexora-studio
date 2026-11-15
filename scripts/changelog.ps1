# One source for the version history: nexora/app/changelog.js (what the app's "What's new" shows).
# This script writes, from it:
#   CHANGELOG.md        the full history for GitHub
#   RELEASE_NOTES.md    the newest version + download table (used by CI as the GitHub release text)
#   site/changelog.js   the copy the website renders
# and fails if package.json's version is not the newest entry.  Usage: pwsh scripts/changelog.ps1 [-Check]
param([switch]$Check)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = [IO.File]::ReadAllText((Join-Path $root 'nexora/app/changelog.js')) -replace "`r`n", "`n"
$json = $src.Substring($src.IndexOf('[')); $json = $json.Substring(0, $json.LastIndexOf(']') + 1)
$log = $json | ConvertFrom-Json
$pkg = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($log[0].version -ne $pkg) { throw "package.json is $pkg but the newest changelog entry is $($log[0].version)" }
$nl = "`n"
$md = "# Changelog$nl${nl}All notable changes to NEXORA Studio. Downloads: https://nexora-editor.pages.dev$nl"
foreach ($r in $log) { $md += "$nl## $($r.version) - $($r.date)$nl$nl**$($r.title)**$nl$nl" + (($r.items | ForEach-Object { "- $_" }) -join $nl) + $nl }
$top = $log[0]
$notes = "## What's new in $($top.version)$nl$nl" + (($top.items | ForEach-Object { "- $_" }) -join $nl) + $nl + @'

## Download
| File | For |
|---|---|
| **NEXORA-Studio-Setup-win-x64.exe** | Windows 10 / 11, 64-bit **installer**: Start menu and desktop shortcuts, uninstall from Settings > Apps. Includes FFmpeg. |
| NEXORA-Studio-win-x64.zip | Windows portable: unzip anywhere and run `NEXORA Studio.exe`, nothing is installed. |
| NEXORA-Studio-mac-arm64.zip | macOS, Apple silicon |
| NEXORA-Studio-mac-x64.zip | macOS, Intel |
| NEXORA-Studio-linux-x64.zip | Linux x64 |

**Windows:** not code-signed yet, so SmartScreen may say "Windows protected your PC". Choose **More info -> Run anyway** (for the installer and the portable app).
**macOS:** unsigned; follow README-MAC.txt inside the zip once. macOS and Linux use an installed FFmpeg (`brew install ffmpeg`, `sudo apt install ffmpeg`) for ProRes / DNxHR / audio export.

Full history: CHANGELOG.md. MIT licensed. FFmpeg (in the Windows zip) is GPL v3; see THIRD_PARTY_NOTICES.md.
'@
$files = @{ 'CHANGELOG.md' = $md; 'RELEASE_NOTES.md' = $notes; 'site/changelog.js' = $src }
$stale = @()
foreach ($k in $files.Keys) {
  $p = Join-Path $root $k; $cur = if (Test-Path $p) { [IO.File]::ReadAllText($p) } else { '' }
  if (($cur -replace "`r`n", "`n") -ne ($files[$k] -replace "`r`n", "`n")) { if ($Check) { $stale += $k } else { [IO.File]::WriteAllText($p, $files[$k], (New-Object Text.UTF8Encoding $false)); "wrote $k" } } else { "ok    $k" }
}
if ($Check -and $stale) { throw "Out of date (run scripts/changelog.ps1): $($stale -join ', ')" }
