# Builds the four release zips from this repository:
#   NEXORA-Studio-win-x64.zip, NEXORA-Studio-mac-arm64.zip, NEXORA-Studio-mac-x64.zip, NEXORA-Studio-linux-x64.zip
# Electron's official builds are downloaded and checked against Electron's SHASUMS256.txt, then the app is added as
# resources/app. Linux and macOS zips are written entry by entry from Electron's own archives, so Unix permissions and
# the symlinks inside Electron Framework.framework are kept byte-for-byte (works on Windows, macOS and Linux).
# Run scripts/fetch-vendor.ps1 first (FFmpeg goes into the Windows zip only).
# Usage:  pwsh scripts/package.ps1 [-OutDir dist]
param([string]$OutDir = 'dist', [string]$Electron = '33.2.0')
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
$out = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $root $OutDir })); New-Item -ItemType Directory -Force $out | Out-Null
$work = Join-Path ([IO.Path]::GetTempPath()) ('nexora-pack-' + [guid]::NewGuid()); New-Item -ItemType Directory -Force $work | Out-Null

# ---- 1. the app files (what the Electron app loads) ----
$app = Join-Path $work 'app'; New-Item -ItemType Directory -Force $app | Out-Null
foreach ($f in 'index.html', 'styles.css', 'fx.js', 'engine.js', 'viewport.js', 'panels.js', 'timeline.js', 'features.js', 'main.js', 'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md') { Copy-Item (Join-Path $root $f) (Join-Path $app $f) }
foreach ($d in 'electron', 'nexora', 'vendor', 'tests', 'docs') { Copy-Item (Join-Path $root $d) (Join-Path $app $d) -Recurse }
Get-ChildItem $app -Recurse -Filter '*.example.json' | Remove-Item
$appFiles = Get-ChildItem $app -Recurse -File
"app: $($appFiles.Count) files" + $(if (Test-Path (Join-Path $app 'electron/gas.config.json')) { ' (with online sign-in)' } else { ' (local accounts only: no electron/gas.config.json)' })

# ---- 2. Electron, verified ----
$base = "https://github.com/electron/electron/releases/download/v$Electron"
Invoke-WebRequest "$base/SHASUMS256.txt" -OutFile (Join-Path $work 'SHASUMS256.txt') -UseBasicParsing
$sums = @{}; foreach ($l in Get-Content (Join-Path $work 'SHASUMS256.txt')) { if ($l -match '^([0-9a-f]{64}) \*?(\S+)$') { $sums[$Matches[2]] = $Matches[1] } }
function Get-Electron($plat) {
  $name = "electron-v$Electron-$plat.zip"; $f = Join-Path $work $name; Write-Host "fetch   $name"
  Invoke-WebRequest "$base/$name" -OutFile $f -UseBasicParsing
  $h = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower(); if ($h -ne $sums[$name]) { throw "Checksum mismatch for $name" }; return $f
}

# ---- zip helpers ----
function Copy-Stream($from, $to) { $s = $from.Open(); $d = $to.Open(); try { $s.CopyTo($d) } finally { $s.Dispose(); $d.Dispose() } }
function Add-File($zip, $path, $name, $mode) { $e = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal); $e.ExternalAttributes = ($mode -shl 16); $d = $e.Open(); $s = [IO.File]::OpenRead($path); try { $s.CopyTo($d) } finally { $s.Dispose(); $d.Dispose() } }
function Add-Text($zip, $name, $text, $mode) { $e = $zip.CreateEntry($name); $e.ExternalAttributes = ($mode -shl 16); $w = New-Object IO.StreamWriter($e.Open(), (New-Object Text.UTF8Encoding($false))); $w.Write($text); $w.Dispose() }
function Build($src, $dest, $map, $appPrefix, $patch, $extra, $skipFfmpeg) {
  if (Test-Path $dest) { Remove-Item $dest -Force }
  $in = [IO.Compression.ZipFile]::OpenRead($src); $zip = [IO.Compression.ZipFile]::Open($dest, 'Create'); $n = 0
  try {
    foreach ($e in $in.Entries) {
      $name = & $map $e.FullName; if (-not $name) { continue }
      if ($patch -and $patch.ContainsKey($e.FullName)) { $r = New-Object IO.StreamReader($e.Open()); $txt = $r.ReadToEnd(); $r.Dispose(); $txt = & $patch[$e.FullName] $txt; Add-Text $zip $name $txt ($e.ExternalAttributes -shr 16); $n++; continue }
      $ne = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal); $ne.ExternalAttributes = $e.ExternalAttributes; $ne.LastWriteTime = $e.LastWriteTime
      if ($e.FullName.EndsWith('/')) { continue }; Copy-Stream $e $ne; $n++
    }
    foreach ($f in $appFiles) {
      $rel = $f.FullName.Substring($app.Length + 1).Replace('\', '/'); if ($skipFfmpeg -and $rel.StartsWith('vendor/ffmpeg/')) { continue }
      $mode = if ($rel -match '\.exe$') { 0x81ED } else { 0x81A4 }; Add-File $zip $f.FullName ($appPrefix + $rel) $mode; $n++
    }
    foreach ($k in $extra.Keys) { Add-Text $zip $k $extra[$k] 0x81A4; $n++ }
  } finally { $in.Dispose(); $zip.Dispose() }
  "{0}: {1} entries, {2:N1} MB" -f (Split-Path $dest -Leaf), $n, ((Get-Item $dest).Length / 1MB)
}
try {
  # ---- Windows x64: electron.exe → NEXORA Studio.exe, default app removed ----
  $W = 'NEXORA-Studio-win-x64/'
  Build (Get-Electron 'win32-x64') (Join-Path $out 'NEXORA-Studio-win-x64.zip') { param($p) if ($p -eq 'resources/default_app.asar') { $null } elseif ($p -eq 'electron.exe') { $W + 'NEXORA Studio.exe' } else { $W + $p } } ($W + 'resources/app/') $null @{} $false
  # ---- Linux x64 ----
  $L = 'NEXORA-Studio-linux-x64/'
  Build (Get-Electron 'linux-x64') (Join-Path $out 'NEXORA-Studio-linux-x64.zip') { param($p) if ($p -eq 'resources/default_app.asar') { $null } elseif ($p -eq 'electron') { $L + 'nexora-studio' } else { $L + $p } } ($L + 'resources/app/') $null @{
    ($L + 'README-LINUX.txt') = "NEXORA Studio for Linux (x64)`n`nunzip NEXORA-Studio-linux-x64.zip`ncd NEXORA-Studio-linux-x64 && ./nexora-studio`n`nIf it exits with a sandbox error (Ubuntu 23.10+ restricts unprivileged user namespaces), either run`n  sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`nonce, or start it with ./nexora-studio --no-sandbox.`nSystem-audio capture is not available on Linux (screen video + microphone work).`n" } $true
  # ---- macOS (Apple silicon + Intel) ----
  foreach ($arch in 'arm64', 'x64') {
    $M = 'NEXORA Studio.app/'
    $plist = @{ 'Electron.app/Contents/Info.plist' = { param($t) $t -replace '(<key>CFBundleDisplayName</key>\s*<string>)Electron(</string>)', '$1NEXORA Studio$2' -replace '(<key>CFBundleName</key>\s*<string>)Electron(</string>)', '$1NEXORA Studio$2' } }
    Build (Get-Electron "darwin-$arch") (Join-Path $out "NEXORA-Studio-mac-$arch.zip") { param($p) if ($p -eq 'Electron.app/Contents/Resources/default_app.asar') { $null } elseif ($p.StartsWith('Electron.app/')) { $M + $p.Substring(13) } else { $p } } ($M + 'Contents/Resources/app/') $plist @{
      'README-MAC.txt' = "NEXORA Studio for macOS ($arch)`n`nThis build is not signed with an Apple Developer ID. macOS will block it the first time:`n  1. Move 'NEXORA Studio.app' to Applications.`n  2. Run in Terminal:`n       xattr -cr '/Applications/NEXORA Studio.app'`n       codesign --force --deep --sign - '/Applications/NEXORA Studio.app'`n     (the second line re-signs it locally; adding NEXORA to Electron's bundle changes its contents)`n  3. Open it normally (or right-click > Open).`nSystem audio in screen recordings needs macOS 13 or later.`n" } $true
  }
} finally { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
