#!/usr/bin/env bash
# Builds a fully static Tesseract CLI (Tesseract 5.5.3 + Leptonica 1.87.0) and the Korean/English
# tessdata_fast models for the desktop app. Static means the AppImage/rpm/deb/Flatpak do not need a
# host tesseract, and the same engine runs everywhere.
#
#   app/scripts/build-tesseract.sh [output-dir]
#
# Default output: app/src-tauri/resources/ocr-linux. The Flatpak CI uses app/flatpak/tesseract.
# Packages: cmake, ninja, a C++ compiler and the static libc/libstdc++/libpng/zlib packages.
#   Fedora: cmake ninja-build gcc-c++ glibc-static libstdc++-static libpng-static zlib-ng-compat-static
#   Debian: cmake ninja-build g++ libc6-dev libpng-dev zlib1g-dev
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/src-tauri/resources/ocr-linux"}
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
VERSION="tesseract-5.5.3_leptonica-1.87.0_tessdata-8741641"
TESS_TAG=5.5.3
LEP_TAG=1.87.0
TESSDATA_COMMIT=87416418657359cb625c412a48b6e1d6d41c29bd
TESS_SHA=9218e62793116d42a9f6d14cd9348518b27f382096eea3d0f2d1a24616bb5884
LEP_SHA=fa2b40c5caea96d1bb93a97486262aed8731b69ce25a84a6bf5d25323e33f631
KOR_SHA=6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2
ENG_SHA=7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2

if [ -x "$OUT/tesseract" ] && [ "$(cat "$OUT/.version" 2>/dev/null || true)" = "$VERSION" ]; then
  echo "tesseract already built in $OUT"
  exit 0
fi
for tool in cmake ninja g++ curl tar; do
  command -v "$tool" >/dev/null || {
    echo "missing $tool (install the build packages listed at the top of this script)" >&2
    exit 1
  }
done
PNG_A=$(find /usr/lib /usr/lib64 -name 'libpng*.a' 2>/dev/null | head -1)
Z_A=$(find /usr/lib /usr/lib64 -name 'libz.a' 2>/dev/null | head -1)
[ -n "$PNG_A" ] && [ -n "$Z_A" ] || {
  echo "missing static libpng/libz (libpng-static + zlib-ng-compat-static / libpng-dev + zlib1g-dev)" >&2
  exit 1
}

WORK=${PICKGAK_TESSERACT_BUILD:-/tmp/pickgak-tesseract-build}
mkdir -p "$WORK"
cd "$WORK"
[ -f leptonica.tar.gz ] || curl -fsSL -o leptonica.tar.gz "https://github.com/DanBloomberg/leptonica/archive/refs/tags/$LEP_TAG.tar.gz"
[ -f tesseract.tar.gz ] || curl -fsSL -o tesseract.tar.gz "https://github.com/tesseract-ocr/tesseract/archive/refs/tags/$TESS_TAG.tar.gz"
echo "$LEP_SHA  leptonica.tar.gz" | sha256sum -c - >/dev/null
echo "$TESS_SHA  tesseract.tar.gz" | sha256sum -c - >/dev/null
rm -rf leptonica tesseract prefix
mkdir -p leptonica tesseract prefix
tar xzf leptonica.tar.gz -C leptonica --strip-components=1
tar xzf tesseract.tar.gz -C tesseract --strip-components=1

cmake -S leptonica -B lep -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_PROG=OFF \
  -DCMAKE_INSTALL_PREFIX="$WORK/prefix" \
  -DENABLE_JPEG=OFF -DENABLE_TIFF=OFF -DENABLE_WEBP=OFF -DENABLE_OPENJPEG=OFF -DENABLE_GIF=OFF \
  -DENABLE_PNG=ON -DENABLE_ZLIB=ON -DCMAKE_FIND_LIBRARY_SUFFIXES=.a \
  -DPNG_LIBRARY="$PNG_A" -DZLIB_LIBRARY="$Z_A"
cmake --build lep -j2
cmake --install lep

cmake -S tesseract -B tess -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TRAINING_TOOLS=OFF \
  -DGRAPHICS_DISABLED=ON -DOPENMP_BUILD=OFF \
  -DCMAKE_PREFIX_PATH="$WORK/prefix" -DCMAKE_INSTALL_PREFIX="$WORK/prefix" \
  -DCMAKE_EXE_LINKER_FLAGS=-static \
  -DCMAKE_CXX_FLAGS="-static-libstdc++ -static-libgcc" \
  -DCMAKE_FIND_LIBRARY_SUFFIXES=.a
cmake --build tess -j2 --target tesseract

mkdir -p "$OUT/tessdata" "$WORK/tessdata"
cp tess/bin/tesseract "$OUT/tesseract"
strip "$OUT/tesseract"
chmod 0755 "$OUT/tesseract"
[ -f tessdata/kor.traineddata ] || curl -fsSL -o tessdata/kor.traineddata "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TESSDATA_COMMIT/kor.traineddata"
[ -f tessdata/eng.traineddata ] || curl -fsSL -o tessdata/eng.traineddata "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TESSDATA_COMMIT/eng.traineddata"
echo "$KOR_SHA  tessdata/kor.traineddata" | sha256sum -c - >/dev/null
echo "$ENG_SHA  tessdata/eng.traineddata" | sha256sum -c - >/dev/null
cp tessdata/kor.traineddata tessdata/eng.traineddata "$OUT/tessdata/"
curl -fsSL -o "$OUT/LICENSE-tesseract" "https://raw.githubusercontent.com/tesseract-ocr/tesseract/$TESS_TAG/LICENSE"
curl -fsSL -o "$OUT/LICENSE-tessdata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TESSDATA_COMMIT/LICENSE"
echo "$VERSION" >"$OUT/.version"
echo "tesseract built in $OUT"
TESSDATA_PREFIX="$OUT/tessdata" "$OUT/tesseract" --list-langs 2>/dev/null | grep -qx kor
TESSDATA_PREFIX="$OUT/tessdata" "$OUT/tesseract" --list-langs 2>/dev/null | grep -qx eng
