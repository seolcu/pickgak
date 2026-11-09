#!/usr/bin/env bash
# End-to-end check of TAB capture on a virtual X display (runs inside the build container).
# A window named like a Proton game shows a real scoreboard frame; xdotool holds TAB.
set -Eeuo pipefail
cd /src
Xvfb :99 -screen 0 1280x720x24 >/dev/null 2>&1 &
export DISPLAY=:99
sleep 1
display -title Overwatch -geometry +0+0 crates/vision/tests/fixtures/f_825.jpg &
sleep 2
cd /tmp
/target/debug/examples/probe > probe.log 2>&1 &
PROBE=$!
sleep 1
xdotool keydown Tab; sleep 0.6; xdotool keyup Tab      # held: one capture
sleep 0.3
xdotool keydown Tab; sleep 0.1; xdotool keyup Tab      # tap: no capture
sleep 0.3
xdotool key a b c                                       # other keys: ignored
sleep 1
kill $PROBE || true
cat probe.log
grep -c "^capture " probe.log | xargs -I{} echo "captures={}"
