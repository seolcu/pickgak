#!/usr/bin/env bash
# Builds every Linux release artifact: the Flatpak repository (app/flatpak/repo) and the rpm, deb and
# AppImage (app/dist). Checks along the way that the bundled OCR engine reads Korean and English, that the
# app shell's tests pass with it, and that the app starts on a virtual display.
#
# Runs by hand anywhere with these tools (rustup,
# node, the Tauri build deps, cmake, flatpak, appstream-compose, gpg, xvfb, dbus).
# Set FLATPAK_GPG_KEY to a fingerprint in GNUPGHOME to sign the Flatpak repository.
#
# usage: app/scripts/build-linux-release.sh
set -Eeuo pipefail
cd "$(dirname "$0")/.."
APP=$PWD
TARGET_DIR=${CARGO_TARGET_DIR:-$APP/target}
T=$APP/flatpak/tesseract

(cd ../frontend && npm run -s build)

scripts/build-tesseract.sh "$T"
TESSDATA_PREFIX=$T/tessdata "$T/tesseract" --list-langs > /tmp/pickgak-langs
grep -qx kor /tmp/pickgak-langs && grep -qx eng /tmp/pickgak-langs
TESSDATA_PREFIX=$T/tessdata "$T/tesseract" flatpak/ocr-smoke.png stdout -l kor+eng --psm 7 2>/dev/null | grep -q '행복'

PICKGAK_TESSERACT=$T/tesseract PICKGAK_TESSDATA=$T/tessdata cargo test -p pickgak --bin pickgak

# The Flatpak runtime has no libappindicator, so its binary is built without the tray
npx tauri build --no-bundle -- --no-default-features
set +e
TESSDATA_PREFIX=$T/tessdata dbus-run-session -- xvfb-run -a timeout 15 "$TARGET_DIR/release/pickgak" > /tmp/pickgak-start.log 2>&1
code=$?
set -e
tail -20 /tmp/pickgak-start.log
[ "$code" -eq 124 ] || { echo "the app exited early ($code)" >&2; exit 1; }
flatpak/build-repo.sh flatpak/repo

rm -rf src-tauri/resources/ocr-linux "$TARGET_DIR"/release/bundle/{rpm,deb,appimage}
mkdir -p src-tauri/resources dist
cp -a "$T" src-tauri/resources/ocr-linux
APPIMAGE_EXTRACT_AND_RUN=1 npx tauri build --config src-tauri/tauri.linux-bundle.conf.json --bundles rpm,deb,appimage
cp "$TARGET_DIR"/release/bundle/rpm/*.rpm "$TARGET_DIR"/release/bundle/deb/*.deb \
  "$TARGET_DIR"/release/bundle/appimage/*.AppImage dist/
ls -la dist flatpak/repo/com.seolcu.pickgak.flatpakrepo
