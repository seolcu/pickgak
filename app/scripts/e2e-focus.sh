#!/usr/bin/env bash
# End-to-end check of when TAB counts (runs inside the build container, after `cargo build --examples`):
#  - only while the game window has focus (_NET_ACTIVE_WINDOW, set here by hand: Xvfb has no window manager)
#  - repeats every 1.5 s while held, and stops when TAB goes up or the game loses focus
set -Eeuo pipefail
cd /src
Xvfb :98 -screen 0 1280x720x24 >/dev/null 2>&1 &
export DISPLAY=:98
sleep 1
display -title Overwatch -geometry +0+0 crates/vision/tests/fixtures/f_825.jpg &
display -title Notes -geometry 300x200+900+500 crates/vision/tests/fixtures/f_548.jpg &
sleep 2
GAME=$(xdotool search --name '^Overwatch$' | head -1)
OTHER=$(xdotool search --name '^Notes$' | head -1)
focus() { xprop -root -f _NET_ACTIVE_WINDOW 32x -set _NET_ACTIVE_WINDOW "$1"; }
cd /tmp
/target/release/examples/probe > focus.log 2>&1 &
PROBE=$!
sleep 1
count() { grep -c "^capture " focus.log || true; }
step() { echo "$1: captures=$(count) tab_events=$(grep -c '^tab ' focus.log || true)"; }

focus "$GAME";  xdotool keydown Tab; sleep 0.6; xdotool keyup Tab; sleep 0.5; step "game focused, held 0.6 s (expect 1 capture)"
focus "$OTHER"; xdotool keydown Tab; sleep 0.6; xdotool keyup Tab; sleep 0.5; step "other window focused (expect no new capture or tab event)"
focus 0;        xdotool keydown Tab; sleep 0.6; xdotool keyup Tab; sleep 0.5; step "Wayland window focused (expect none)"
focus "$GAME";  xdotool keydown Tab; sleep 5;   xdotool keyup Tab; sleep 0.5; step "game focused, held 5 s (expect 4 more: 0.3 s + every 1.5 s)"
xdotool keydown Tab; sleep 1; focus "$OTHER"; sleep 3; xdotool keyup Tab; sleep 0.5; step "focus lost while held (expect 1 more, then stop)"
# GNOME advertises _NET_ACTIVE_WINDOW and deletes it while a Wayland window has focus
xprop -root -f _NET_SUPPORTED 32a -set _NET_SUPPORTED _NET_ACTIVE_WINDOW
xprop -root -remove _NET_ACTIVE_WINDOW
xdotool keydown Tab; sleep 0.6; xdotool keyup Tab; sleep 0.5; step "advertised but deleted, like GNOME with a Wayland window (expect none)"
focus "$GAME"; xdotool keydown Tab; sleep 0.6; xdotool keyup Tab; sleep 0.5; step "advertised and the game focused (expect 1 more)"
kill $PROBE || true
