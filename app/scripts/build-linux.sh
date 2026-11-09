#!/usr/bin/env bash
# Builds the Linux desktop app inside the build container (see app/docker/Dockerfile).
#   docker run --rm -v "$REPO":/repo -v pickgak-cargo:/cargo -v pickgak-target:/target \
#     -v pickgak-npm:/root/.npm -w /repo/app pickgak-app-build scripts/build-linux.sh
set -Eeuo pipefail
cd /repo/app && scripts/build-tesseract.sh src-tauri/resources/ocr-linux
cd /repo/frontend && npm run -s build
cd /repo/app
rm -rf /target/release/bundle/rpm /target/release/bundle/deb /target/release/bundle/appimage
npx tauri build --config src-tauri/tauri.linux-bundle.conf.json --bundles rpm,deb,appimage
mkdir -p /repo/app/dist
cp /target/release/bundle/rpm/*.rpm /target/release/bundle/deb/*.deb \
  /target/release/bundle/appimage/*.AppImage /repo/app/dist/
ls -la /repo/app/dist
