#!/usr/bin/env bash
# Cross-builds the Windows installer (NSIS) on Linux with cargo-xwin, so no Windows host is needed.
# Needs: rustup with the x86_64-pc-windows-msvc target, cargo-xwin, clang, lld, llvm, nsis (makensis),
# 7z, node. cargo-xwin downloads the MSVC CRT and Windows SDK on
# first use (Microsoft's license applies) into its cache.
#
# The OCR engine is the official Windows Tesseract installer, unpacked with 7z and pinned by hash.
#
# usage: app/scripts/build-windows.sh   -> app/dist/PickGak_<version>_x64-setup.exe
set -Eeuo pipefail
cd "$(dirname "$0")/.."
APP=$PWD
TARGET=x86_64-pc-windows-msvc
VERSION=$(grep -m1 '^version = ' Cargo.toml | cut -d'"' -f2)
TARGET_DIR=${CARGO_TARGET_DIR:-$APP/target}

TESS_URL=https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe
TESS_SHA=bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4
TESSDATA=https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd

dir=src-tauri/resources/tesseract
if [ ! -f "$dir/tesseract.exe" ] || [ ! -f "$dir/tessdata/kor.traineddata" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/setup.exe" "$TESS_URL"
  echo "$TESS_SHA  $tmp/setup.exe" | sha256sum -c --quiet
  rm -rf "$dir" && mkdir -p "$dir"
  7z x -y "-o$dir" "$tmp/setup.exe" >/dev/null
  rm -rf "$dir/\$PLUGINSDIR" "$dir/doc" "$dir/uninstall.exe" \
    "$dir/tessdata/configs" "$dir/tessdata/tessconfigs" "$dir/tessdata/pdf.ttf"
  find "$dir/tessdata" -name '*.jar' -delete
  curl -fsSL -o "$dir/tessdata/kor.traineddata" "$TESSDATA/kor.traineddata"
  curl -fsSL -o "$dir/tessdata/eng.traineddata" "$TESSDATA/eng.traineddata"
fi
[ -f "$dir/tesseract.exe" ] || { echo "tesseract.exe missing after unpacking" >&2; exit 1; }

(cd ../frontend && npm run -s build)
rm -rf "$TARGET_DIR/$TARGET/release/bundle/nsis"
npx tauri build --runner cargo-xwin --target "$TARGET" --bundles nsis
mkdir -p dist
cp "$TARGET_DIR/$TARGET/release/bundle/nsis/PickGak_${VERSION}_x64-setup.exe" dist/
ls -la "dist/PickGak_${VERSION}_x64-setup.exe"
