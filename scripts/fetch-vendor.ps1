# Downloads the large third-party files that are not stored in git, and checks every one against a known SHA-256.
# Usage (PowerShell, from the repository root):  powershell -ExecutionPolicy Bypass -File scripts\fetch-vendor.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('nexora-vendor-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $tmp | Out-Null
function Get-Verified($url, $dest, $sha) {
  if ((Test-Path $dest) -and ((Get-FileHash $dest -Algorithm SHA256).Hash.ToLower() -eq $sha)) { "ok      $dest"; return }
  New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
  $part = Join-Path $tmp ([IO.Path]::GetFileName($dest))
  "fetch   $url"; Invoke-WebRequest $url -OutFile $part -UseBasicParsing
  $got = (Get-FileHash $part -Algorithm SHA256).Hash.ToLower(); if ($got -ne $sha) { throw "Checksum mismatch for $url`n expected $sha`n got      $got" }
  Move-Item -Force $part $dest; "ok      $dest"
}
try {
  # FFmpeg 9.0.2 essentials (Gyan Doshi), GPL v3: the archive is checked, then ffmpeg.exe inside it
  $ff = Join-Path $root 'vendor\ffmpeg\win32-x64\ffmpeg.exe'
  if (-not ((Test-Path $ff) -and ((Get-FileHash $ff -Algorithm SHA256).Hash.ToLower() -eq '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec'))) {
    $zip = Join-Path $tmp 'ffmpeg.zip'
    Get-Verified 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip' $zip '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
    Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try { $e = $z.Entries | Where-Object { $_.FullName -like '*/bin/ffmpeg.exe' } | Select-Object -First 1; New-Item -ItemType Directory -Force (Split-Path -Parent $ff) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $ff, $true) } finally { $z.Dispose() }
    if ((Get-FileHash $ff -Algorithm SHA256).Hash.ToLower() -ne '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec') { throw 'ffmpeg.exe checksum mismatch' }
    "ok      $ff"
  } else { "ok      $ff" }
  # on-device AI models (Xenova ONNX exports on Hugging Face, Apache-2.0)
  $models = @(
    @('Xenova/modnet', 'onnx/model.onnx', '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9'),
    @('Xenova/whisper-base', 'onnx/decoder_model_merged_quantized.onnx', 'a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861'),
    @('Xenova/whisper-base', 'onnx/encoder_model_quantized.onnx', '3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9'),
    @('Xenova/whisper-tiny.en', 'onnx/decoder_model_merged_quantized.onnx', 'dbb2e063b7fbc41d9803b9698f93ecb035c50cbb3fb87b56cb131e4a5eb99059'),
    @('Xenova/whisper-tiny.en', 'onnx/encoder_model_quantized.onnx', '8cc3c6f8563d1b3fbd2c5af9f64c2bed8b020bc593c402d1ef53b9f08fbf1b90'))
  foreach ($m in $models) { Get-Verified "https://huggingface.co/$($m[0])/resolve/main/$($m[1])" (Join-Path $root ("vendor\ai\models\" + $m[0].Replace('/', '\') + '\' + $m[1].Replace('/', '\'))) $m[2] }
  'All third-party files are present and verified.'
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
