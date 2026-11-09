#!/usr/bin/env bash
# Builds the Flatpak repository from an already-built binary (app/target/release/pickgak).
#
#   FLATPAK_GPG_KEY=<fingerprint> app/flatpak/build-repo.sh [output-dir]
#
# FLATPAK_GPG_KEY must be in GNUPGHOME. Output is an OSTree repository with the .flatpakrepo file,
# ready to serve over plain HTTP. The release workflow publishes it on GitHub Pages (FLATPAK_URL).
#
# The app only ships prebuilt files (the binary, a static Tesseract, desktop entry, metadata, icon), so
# nothing runs inside the SDK: the files are laid out by hand and exported with `flatpak build-finish`
# and `build-export`. No flatpak-builder, so no bubblewrap and no runtime download, which lets it run in
# an unprivileged container (e.g. a CI runner). Needs flatpak, appstreamcli and gpg.
set -Eeuo pipefail
CALLER=$(pwd)
cd "$(dirname "$0")"
if [ $# -ge 1 ]; then
  OUT=$1
  case "$OUT" in /*) ;; *) OUT="$CALLER/$OUT" ;; esac
else
  OUT="$PWD/repo"
fi
ID=com.seolcu.pickgak
BIN=${CARGO_TARGET_DIR:-../target}/release/pickgak
[ -f "$BIN" ] || {
  echo "missing $BIN (build it first: npx tauri build --no-bundle -- --no-default-features)" >&2
  exit 1
}
[ -x tesseract/tesseract ] && [ -f tesseract/tessdata/kor.traineddata ] || {
  echo "missing app/flatpak/tesseract (run app/scripts/build-tesseract.sh app/flatpak/tesseract)" >&2
  exit 1
}
KEY=${FLATPAK_GPG_KEY:-}
SIGN=()
[ -n "$KEY" ] && SIGN=(--gpg-sign="$KEY")

B=build-dir
rm -rf "$OUT" "$B"
mkdir -p "$B/files"
cat > "$B/metadata" <<EOF
[Application]
name=$ID
runtime=org.gnome.Platform/x86_64/50
sdk=org.gnome.Sdk/x86_64/50
EOF
F=$B/files
# The same static Tesseract as the AppImage/rpm/deb, so every Linux package has the same OCR engine
install -Dm755 tesseract/tesseract "$F/bin/tesseract"
install -Dm644 tesseract/tessdata/kor.traineddata "$F/share/tessdata/kor.traineddata"
install -Dm644 tesseract/tessdata/eng.traineddata "$F/share/tessdata/eng.traineddata"
install -Dm644 tesseract/LICENSE-tesseract "$F/share/licenses/tesseract/LICENSE"
install -Dm644 tesseract/LICENSE-tessdata "$F/share/licenses/tessdata/LICENSE"
install -Dm644 ocr-smoke.png "$F/share/pickgak/ocr-smoke.png"
install -Dm755 "$BIN" "$F/bin/pickgak"
install -Dm644 $ID.desktop "$F/share/applications/$ID.desktop"
install -Dm644 $ID.metainfo.xml "$F/share/metainfo/$ID.metainfo.xml"
install -Dm644 $ID.png "$F/share/icons/hicolor/512x512/apps/$ID.png"

# AppStream data for the repository's appstream branch (what flatpak-builder generates)
appstreamcli compose --prefix=/ --origin=$ID --components=$ID \
  --result-root="$F" --data-dir="$F/share/app-info/xmls" --icons-dir="$F/share/app-info/icons/flatpak" "$F"

# Stay-on-top over the game needs X11; the app also forces GDK_BACKEND=x11. The tray icon talks to
# StatusNotifierWatcher.
flatpak build-finish "$B" --command=pickgak \
  --share=network --socket=fallback-x11 --share=ipc --device=dri \
  --env=GDK_BACKEND=x11 --env=TESSDATA_PREFIX=/app/share/tessdata \
  --talk-name=org.kde.StatusNotifierWatcher
# --disable-sandbox: the icon validator would need bubblewrap; the icon is our own file
flatpak build-export --disable-sandbox "${SIGN[@]}" "$OUT" "$B" master

{
  echo "[Flatpak Repo]"
  echo "Title=PickGak"
  echo "Url=${FLATPAK_URL:-https://seolcu.github.io/pickgak/flatpak/}"
  echo "Homepage=https://pickgak.seolcu.com/download"
  echo "Comment=Overwatch hero pick helper"
  echo "Description=Overwatch hero pick helper"
  if [ -n "$KEY" ]; then
    gpg --export "$KEY" | base64 -w0 > "$OUT/gpgkey"
    echo "GPGKey=$(cat "$OUT/gpgkey")"
  fi
} > "$OUT/$ID.flatpakrepo"

flatpak build-update-repo "${SIGN[@]}" "$OUT"
rm -rf "$B"
echo "flatpak repo ready in $OUT"
