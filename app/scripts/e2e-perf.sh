#!/usr/bin/env bash
# Overlay + resource check on a virtual display.
set -Eeuo pipefail
Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &
export DISPLAY=:99 HOME=/tmp/home XDG_DATA_HOME=/tmp/home/.local/share
mkdir -p $HOME; sleep 1
display -title Overwatch -geometry +0+0 /repo/app/crates/vision/tests/fixtures/f_825.jpg &
sleep 2
dbus-run-session -- /target/release/pickgak > /tmp/app.log 2>&1 &
sleep 10
cpu() { ps -C pickgak,WebKitWebProcess,WebKitNetworkProcess -o comm=,%cpu=,rss= --no-headers | awk '{c+=$2; r+=$3} END {printf "cpu=%.1f%% rss=%dMB", c, r/1024}'; }
ticks() { for p in $(pgrep -f "pickgak|WebKit"); do awk '{print $14+$15}' /proc/$p/stat; done | awk '{s+=$1} END {print s}'; }
t0=$(ticks); sleep 20; t1=$(ticks)
echo "idle 20s: cpu_ticks=$((t1-t0)) ($(( (t1-t0) * 100 / (20*100) ))% of one core)  $(cpu)"
t0=$(ticks)
xdotool keydown Tab; sleep 0.6; xdotool keyup Tab; sleep 2
t1=$(ticks)
echo "one TAB capture: cpu_ticks=$((t1-t0)) (~$(( (t1-t0) * 10 ))ms CPU incl. UI update)"
# show the overlay via the main window's button
WID=$(xdotool search --name "^PickGak$" | head -1)
xdotool windowfocus --sync $WID 2>/dev/null || true; xdotool mousemove 1345 150 click 1; sleep 3; (xwininfo -root -tree | grep -iE "\"[^\"]*(pickgak|overlay)" | head -5 || true); pgrep -a pickgak || echo "app gone"; tail -5 /tmp/app.log
xdotool search --name "PickGak overlay" >/dev/null && echo "overlay window: yes" || echo "overlay window: NO"
for OV in $(xdotool search --name "PickGak overlay"); do xwininfo -id $OV | grep -E "Absolute upper-left X|Absolute upper-left Y|Width|Height|Map State" | tr "\n" " "; echo; done
import -window root /repo/app/dist/e2e-overlay.png

# overlay opened at startup (PICKGAK_OVERLAY=1) to check what it renders
pkill pickgak || true; sleep 2
PICKGAK_OVERLAY=1 dbus-run-session -- /target/release/pickgak > /tmp/app2.log 2>&1 &
sleep 10
for OV in $(xdotool search --name "PickGak overlay"); do echo "startup overlay: $(xwininfo -id $OV | grep "Map State")"; done
import -window root /repo/app/dist/e2e-overlay2.png
