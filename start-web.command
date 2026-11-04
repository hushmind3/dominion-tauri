#!/bin/zsh
cd "$(dirname "$0")"
npm run build >/dev/null 2>&1
PIDS=$(lsof -nP -iTCP:4317 -sTCP:LISTEN -t 2>/dev/null)
for p in $PIDS; do kill -9 $p 2>/dev/null; done
nohup node server/index.mjs > /tmp/dominion-web.log 2>&1 &
sleep 5
open -a "Google Chrome" "http://127.0.0.1:4317"
