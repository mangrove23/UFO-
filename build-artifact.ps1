# Bundle src/*.js + styles.css into a single distributable HTML file.
#   powershell -NoProfile -ExecutionPolicy Bypass -File build-artifact.ps1
#
# NOTE: this script is deliberately ASCII-only. Windows PowerShell 5.1 reads .ps1
# files as ANSI unless they carry a BOM, so non-ASCII text here would be mangled
# (and mangled bytes can silently break parsing). All Korean text lives in the
# UTF-8 source files and in artifact-template.html, which are read with -Encoding UTF8.
#
# The bundle needs no import map: three and rapier are imported by full URL, and
# OrbitControls (which resolves the bare specifier 'three' internally) is replaced
# by src/orbitcam.js.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$THREE_URL  = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js'
$RAPIER_URL = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js'

# dependency order
$order = @('config.js','physics.js','orbitcam.js','paperbox.js','machine.js','claw.js','game.js','ui.js','main.js')

$parts = New-Object System.Collections.Generic.List[string]
foreach ($name in $order) {
  $path = Join-Path $root "src\$name"
  if (-not (Test-Path $path)) { throw "missing $path" }

  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $lines = $text -split "`r?`n"

  $out = New-Object System.Collections.Generic.List[string]
  $inImport = $false
  foreach ($line in $lines) {
    if ($inImport) {
      if ($line -match "from\s+'[^']+';") { $inImport = $false }
      continue
    }
    if ($line -match '^\s*import\s') {
      if ($line -notmatch "from\s+'[^']+';") { $inImport = $true }
      continue
    }
    $out.Add(($line -replace '^\s*export\s+(?=(const|let|var|function|class|async)\s)', ''))
  }

  $parts.Add("// ===== src/$name =====")
  $parts.Add(($out -join "`n"))
}

$header = "import * as THREE from '$THREE_URL';`n" +
          "import * as __rapierNS from '$RAPIER_URL';`n" +
          "const RAPIER = (__rapierNS && __rapierNS.World) ? __rapierNS : (__rapierNS.default || __rapierNS);`n" +
          "const __boot = document.getElementById('boot');`n" +
          "addEventListener('error', e => { if (__boot && __boot.isConnected) __boot.textContent = 'ERROR: ' + e.message; });`n"

$js = $header + "`n" + ($parts -join "`n`n") + "`nif (__boot) __boot.remove();`n"

$css = [System.IO.File]::ReadAllText((Join-Path $root 'styles.css'), [System.Text.Encoding]::UTF8)
$tpl = [System.IO.File]::ReadAllText((Join-Path $root 'artifact-template.html'), [System.Text.Encoding]::UTF8)

$html = $tpl.Replace('/*__CSS__*/', $css).Replace('/*__JS__*/', $js)

$distDir = Join-Path $root 'dist'
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

$enc = New-Object System.Text.UTF8Encoding($false)
$outFile = Join-Path $distDir 'ufo-catcher.html'
[System.IO.File]::WriteAllText($outFile, $html, $enc)

# GitHub Pages / Netlify 등은 index.html 을 기본 문서로 찾는다.
# dist 폴더를 그대로 올리면 바로 배포되도록 같은 내용을 index.html 로도 쓴다.
[System.IO.File]::WriteAllText((Join-Path $distDir 'index.html'), $html, $enc)

# GitHub Pages 의 Jekyll 전처리를 끈다 (밑줄로 시작하는 파일이 무시되는 것을 방지)
[System.IO.File]::WriteAllText((Join-Path $distDir '.nojekyll'), '', $enc)

$kb = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Host "built $outFile  ($kb KB)"
Write-Host "also wrote dist\index.html and dist\.nojekyll (ready to upload as a GitHub Pages site)"
