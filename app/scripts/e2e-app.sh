#!/usr/bin/env bash
# Smoke test of the built app on a virtual display: it starts, keeps running, and a held TAB over a
# game-like window produces a capture in the app data dir.
set -Eeuo pipefail
Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &
export DISPLAY=:99 HOME=/tmp/home XDG_DATA_HOME=/tmp/home/.local/share
mkdir -p $HOME
sleep 1
display -title Overwatch -geometry +0+0 /repo/app/crates/vision/tests/fixtures/f_825.jpg &
sleep 2
dbus-run-session -- /target/release/pickgak > /tmp/app.log 2>&1 &
APP=$!
sleep 8
xdotool search --name "^PickGak$" >/dev/null && echo "main window: yes" || echo "main window: NO"
xdotool search --name "Overwatch" windowactivate 2>/dev/null || true
xdotool keydown Tab; sleep 0.6; xdotool keyup Tab
sleep 3
ls -la $XDG_DATA_HOME/com.seolcu.pickgak/captures/ 2>/dev/null || echo "no captures dir"
kill -0 $APP && echo "app alive: yes" || echo "app alive: NO"
import -window root /repo/app/dist/e2e-screen.png 2>/dev/null || true
kill $APP 2>/dev/null || true
tail -5 /tmp/app.log
