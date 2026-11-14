param([int]$Port = 5173)
# Tiny static file server (no Node/Python needed). Usage: powershell -File serve.ps1
$root = $PSScriptRoot
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Serving $root at http://localhost:$Port/"
$types = @{ '.html'='text/html'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json'; '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.md'='text/markdown'; '.mjs'='text/javascript'; '.wasm'='application/wasm'; '.onnx'='application/octet-stream' }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = $c.Request.Url.LocalPath; if ($p -eq '/') { $p = '/index.html' }
  $f = Join-Path $root ($p.TrimStart('/') -replace '/', '\')
  if ((Test-Path $f -PathType Leaf) -and ($f.StartsWith($root))) {
    $b = [IO.File]::ReadAllBytes($f); $e = [IO.Path]::GetExtension($f).ToLower()
    $c.Response.ContentType = $(if ($types[$e]) { $types[$e] } else { 'application/octet-stream' })
    $c.Response.Headers.Add('Cache-Control', 'no-store')
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
