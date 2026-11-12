#!/usr/bin/env bash
# Overlay drag regression, both states:
# - locked: the overlay is click-through, so dragging it must not move it
# - unlocked: dragging the panel by a child element must move it
# The drag region and the start_dragging permission are easy to break.
set -Eeuo pipefail
Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &
export DISPLAY=:99 HOME=/tmp/home XDG_DATA_HOME=/tmp/home/.local/share
mkdir -p "$HOME"
display -title Overwatch -geometry +0+0 /repo/app/crates/vision/tests/fixtures/f_825.jpg &
sleep 2

# $1: PICKGAK_OVERLAY value. Prints "before: X Y after: X Y" and returns 0 when the window moved.
try() {
  PICKGAK_OVERLAY="$1" /target/release/pickgak > /tmp/app.log 2>&1 &
  local app=$!
  sleep 8
  local ov
  ov=$(xdotool search --name "^PickGak overlay$" | head -1)
  if [ -z "$ov" ]; then
    echo "overlay window: NO ($1)"
    tail -5 /tmp/app.log
    kill "$app" 2>/dev/null || true
    return 2
  fi
  local x y before after
  at() { xdotool getwindowgeometry --shell "$ov" | awk -F= '/^(X|Y)=/{printf "%s ", $2}'; }
  x=$(xdotool getwindowgeometry --shell "$ov" | awk -F= '/^X=/{print $2}')
  y=$(xdotool getwindowgeometry --shell "$ov" | awk -F= '/^Y=/{print $2}')
  before=$(at)
  # start on a child element inside the panel: only a "deep" drag region catches this. The window is
  # fitted to its content, so the empty overlay is much shorter than the 480 it starts with.
  xdotool mousemove $((x + 170)) $((y + 30)) mousedown 1
  sleep 0.3
  xdotool mousemove $((x + 570)) $((y + 300))
  sleep 0.3
  xdotool mouseup 1
  sleep 1
  after=$(at)
  echo "$1: before: $before after: $after"
  # wait for it to exit: PickGak runs one copy at a time, so the next start would find it still running
  kill "$app" 2>/dev/null || true
  wait "$app" 2>/dev/null || true
  [ "$before" != "$after" ]
}

set +e
try 1
r=$?
set -e
if [ "$r" -eq 2 ]; then
  exit 1
elif [ "$r" -eq 0 ]; then
  echo "locked overlay moved: NO (it should not)"
  exit 1
fi
echo "locked overlay: stayed put"
if ! try unlocked; then
  echo "unlocked overlay drag: NO"
  exit 1
fi
echo "overlay drag: yes"
