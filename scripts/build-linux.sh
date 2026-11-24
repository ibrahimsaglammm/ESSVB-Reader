#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/5] Installing frontend dependencies..."
pnpm install --frozen-lockfile

echo "[2/5] Running checks & tests..."
pnpm run typecheck
pnpm run lint
pnpm test
(cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test)

echo "[3/5] Building frontend..."
pnpm run build

echo "[4/5] Building Linux x64 AppImage..."
pnpm exec tauri build --bundles appimage

OUT_DIR="$ROOT_DIR/dist-packages"
mkdir -p "$OUT_DIR"
APPIMAGE_DIR="$ROOT_DIR/src-tauri/target/release/bundle/appimage"
if [ -d "$APPIMAGE_DIR" ]; then
  find "$APPIMAGE_DIR" -maxdepth 1 -name "*.AppImage" -exec cp -f {} "$OUT_DIR/" \;
fi

echo "[5/5] Done. Artifacts in $OUT_DIR:"
ls -lh "$OUT_DIR"
