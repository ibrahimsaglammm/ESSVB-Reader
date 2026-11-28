param(
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

if (-not $SkipTests) {
  Write-Host "Running frontend & Rust tests before packaging..."
  pnpm run typecheck
  pnpm run lint
  pnpm test
  Push-Location (Join-Path $Root "src-tauri")
  try {
    cargo clippy --all-targets -- -D warnings
    cargo test
  } finally {
    Pop-Location
  }
}

Write-Host "Building frontend production bundle..."
pnpm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

Write-Host "Building ESSVB-Reader Windows x64 MSI + NSIS installers..."
pnpm exec tauri build --bundles "msi,nsis"
if ($LASTEXITCODE -ne 0) { throw "Tauri installer build failed" }

$OutDir = Join-Path $Root "dist-packages"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$MsiDir = Join-Path $Root "src-tauri\target\release\bundle\msi"
$NsisDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"

if (Test-Path $MsiDir) {
  Get-ChildItem $MsiDir -Filter "*.msi" | Copy-Item -Destination $OutDir -Force
}
if (Test-Path $NsisDir) {
  Get-ChildItem $NsisDir -Filter "*.exe" | Copy-Item -Destination $OutDir -Force
}

$ReleaseExe = Join-Path $Root "src-tauri\target\release\essvb-reader.exe"
if (-not (Test-Path $ReleaseExe)) {
  throw "Release executable missing at $ReleaseExe"
}

Write-Host "Creating Windows x64 Portable package..."
$StageDir = Join-Path $OutDir "portable-stage"
if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

Copy-Item $ReleaseExe (Join-Path $StageDir "essvb-reader.exe") -Force
Set-Content -Path (Join-Path $StageDir "portable.txt") -Value "ESSVB-Reader Portable Mode Marker (do not delete)" -Encoding UTF8
Copy-Item (Join-Path $Root "LICENSE") (Join-Path $StageDir "LICENSE") -Force
Copy-Item (Join-Path $Root "THIRD_PARTY_LICENSES.md") (Join-Path $StageDir "THIRD_PARTY_LICENSES.md") -Force
Set-Content -Path (Join-Path $StageDir "README-PORTABLE.txt") -Value @"
ESSVB-Reader v0.2.1 (Portable Edition)
- portable.txt dosyasi bu klasorde bulundugu surece tum kitaplar, veritabani, vurgular ve ayarlar yanindaki 'data' klasorunde saklanir.
- Microsoft Tolga Turkce sesli okuma icin Windows 11 Ayarlar > Zaman ve Dil > Konusma bolumunden Turkce ses paketinin kurulu oldugundan emin olun.
"@ -Encoding UTF8

$PortableZip = Join-Path $OutDir "ESSVB-Reader-0.2.1-windows-x64-portable.zip"
if (Test-Path $PortableZip) { Remove-Item -Force $PortableZip }
$ProgressPreference = "SilentlyContinue"
Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $PortableZip -CompressionLevel Optimal
Remove-Item -Recurse -Force $StageDir

Write-Host "Packaging complete. Artifacts in ${OutDir}:"
Get-ChildItem $OutDir | ForEach-Object {
  $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  Write-Host (" - {0} ({1:N2} MB) SHA256={2}" -f $_.Name, ($_.Length / 1MB), $hash)
}
