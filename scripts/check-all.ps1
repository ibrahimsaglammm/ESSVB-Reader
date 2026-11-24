$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Host "[1/8] Prettier format check..."
pnpm run format:check

Write-Host "[2/8] TypeScript check..."
pnpm run typecheck

Write-Host "[3/8] ESLint check..."
pnpm run lint

Write-Host "[4/8] Vitest unit tests..."
pnpm test

Write-Host "[5/8] Rust formatting, Clippy, and tests..."
Push-Location (Join-Path $Root "src-tauri")
try {
  cargo fmt --check
  cargo clippy --all-targets -- -D warnings
  cargo test
} finally {
  Pop-Location
}

Write-Host "[6/8] Static security & zero-telemetry scan..."
$files = Get-ChildItem -Path "src","src-tauri\src","index.html" -Recurse -Include *.ts,*.tsx,*.rs,*.html
$hits = $files | Select-String -Pattern "eval\(|new Function|dangerouslySetInnerHTML|posthog|sentry|google-analytics|gtag|unpkg\.com|fonts\.googleapis|fonts\.gstatic|jsdelivr|cdnjs"
if ($hits) {
  $hits | ForEach-Object { Write-Error "$($_.Filename):$($_.LineNumber): $($_.Line)" }
  exit 1
}

Write-Host "[7/8] npm dependency audit..."
pnpm audit

Write-Host "[8/8] Rust cargo-audit (if installed)..."
if (Get-Command cargo-audit -ErrorAction SilentlyContinue) {
  Push-Location (Join-Path $Root "src-tauri")
  try { cargo audit } finally { Pop-Location }
} else {
  Write-Warning "cargo-audit is not installed. Install via 'cargo install cargo-audit' in CI."
}

Write-Host "ALL CHECKS PASSED."
