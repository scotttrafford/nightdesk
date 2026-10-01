#!/usr/bin/env bash
# Safely restart the NightDesk call server and verify it afterwards.
#
#   bash deploy/restart.sh
#
# 1. Waits until no calls are in progress (a restart drops in-progress calls)
# 2. Restarts the systemd service (SERVICE_NAME in .env, default "nightdesk")
# 3. Checks /health locally and through the public URL (ngrok or BASE_URL)
# 4. If VALIDATE_TWILIO_SIGNATURE=true, proves Twilio-signed requests are
#    accepted and unsigned ones rejected
#
# Needs sudo for the restart. Run from anywhere; paths are relative to the repo.
set -uo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP" || exit 1
[ -f .env ] || { echo "No .env in $APP"; exit 1; }

envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//'; }
SERVICE=$(envval SERVICE_NAME); SERVICE=${SERVICE:-nightdesk}
PORT=$(envval PORT); PORT=${PORT:-3000}
MODE=$(envval TUNNEL_MODE); MODE=${MODE:-direct}
VALIDATE=$(envval VALIDATE_TWILIO_SIGNATURE)

say()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!!  %s\n' "$*"; exit 1; }

say "Checking sudo"
sudo -v || fail "sudo is required to restart $SERVICE"

say "Waiting for calls in progress to finish"
for i in $(seq 1 30); do
  ACTIVE=$(node --input-type=module -e "
    import 'dotenv/config'; import twilio from 'twilio';
    const c = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const n = (await c.calls.list({ status: 'in-progress' })).length + (await c.calls.list({ status: 'ringing' })).length;
    console.log(n);") || fail "Could not ask Twilio for active calls — check TWILIO_* in .env"
  [ "$ACTIVE" = "0" ] && break
  echo "   $ACTIVE call(s) in progress, waiting 10s..."; sleep 10
done
[ "$ACTIVE" = "0" ] || fail "Calls still in progress after 5 minutes — not restarting."
echo "   no active calls"

say "Restarting $SERVICE"
sudo systemctl restart "$SERVICE" || fail "systemctl restart failed — see: sudo journalctl -u $SERVICE -n 50"
for i in $(seq 1 30); do curl -sf "localhost:$PORT/health" >/dev/null && break; sleep 0.5; done
curl -sf "localhost:$PORT/health" >/dev/null || fail "Not healthy after restart — see: sudo journalctl -u $SERVICE -n 50"
echo "   healthy on port $PORT"

say "Checking the public URL"
URL=""
if [ "$MODE" = "ngrok" ]; then
  for i in $(seq 1 30); do
    URL=$(curl -s http://127.0.0.1:4040/api/tunnels | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).tunnels.find(t=>t.proto==="https").public_url)}catch{}})')
    [ -n "$URL" ] && curl -sf "$URL/health" >/dev/null && break
    URL=""; sleep 1
  done
  [ -n "$URL" ] || URL=$(envval NGROK_URL)
else
  URL=$(envval BASE_URL)
fi
URL=${URL%/}
if [ -n "$URL" ] && curl -sf --max-time 10 "$URL/health" >/dev/null; then
  echo "   $URL/health OK"
else
  echo "!!  $URL/health not reachable from this machine — check the tunnel / proxy"
fi

if [ "$VALIDATE" = "true" ] && [ -n "$URL" ]; then
  say "Checking Twilio signature validation"
  read -r SIGNED UNSIGNED < <(node --input-type=module -e "
    import 'dotenv/config'; import twilio from 'twilio';
    const url = '$URL/call/status';
    const params = { CallSid: 'CArestartcheck0000000000000000000', CallStatus: 'ringing' };
    const sig = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
    const post = (h) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...h }, body: new URLSearchParams(params) }).then(r => r.status).catch(() => 0);
    console.log(await post({ 'X-Twilio-Signature': sig }), await post({}));")
  echo "   signed request:   HTTP $SIGNED (want 204)"
  echo "   unsigned request: HTTP $UNSIGNED (want 403)"
  [ "$SIGNED" = "204" ] || echo "!!  Signed requests are rejected — real calls will fail. Check that the public URL matches Twilio's webhook URL."
fi

say "Done."
