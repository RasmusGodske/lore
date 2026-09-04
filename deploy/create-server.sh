#!/usr/bin/env bash
# Create the VM at Hetzner Cloud from deploy/cloud-init.yml.
#
#   HETZNER_API_TOKEN=... deploy/create-server.sh lore.example.com ~/.ssh/id_ed25519.pub [server-type] [location]
#
# Idempotent per name: refuses to create a second server called "lore". Creates (or reuses) the
# SSH key and a firewall allowing only 22, 80 and 443, then prints the IP to put in DNS.
# Other providers: feed deploy/cloud-init.yml (with the two placeholders substituted) as user
# data to an Ubuntu 24.04 server and skip this script.
set -euo pipefail
DOMAIN="${1:?domain, e.g. lore.example.com}"
PUBKEY_FILE="${2:?path to an SSH public key}"
TYPE="${3:-cx33}"
LOCATION="${4:-fsn1}"
: "${HETZNER_API_TOKEN:?set HETZNER_API_TOKEN (e.g. from .env)}"
H="https://api.hetzner.cloud/v1"
api() { curl -sS -H "Authorization: Bearer $HETZNER_API_TOKEN" -H "Content-Type: application/json" "$@"; }
here="$(cd "$(dirname "$0")" && pwd)"

if api "$H/servers?name=lore" | python3 -c 'import sys,json; sys.exit(0 if json.load(sys.stdin)["servers"] else 1)'; then
  echo "a server named lore already exists; refusing to create another" >&2; exit 1
fi

pubkey="$(cat "$PUBKEY_FILE")"
key_id=$(api "$H/ssh_keys?name=lore-deploy" | python3 -c 'import sys,json; k=json.load(sys.stdin)["ssh_keys"]; print(k[0]["id"] if k else "")')
if [ -z "$key_id" ]; then
  key_id=$(api -X POST "$H/ssh_keys" -d "$(python3 -c 'import json,sys; print(json.dumps({"name":"lore-deploy","public_key":sys.argv[1]}))' "$pubkey")" | python3 -c 'import sys,json; print(json.load(sys.stdin)["ssh_key"]["id"])')
  echo "created ssh key lore-deploy ($key_id)"
fi

fw_id=$(api "$H/firewalls?name=lore" | python3 -c 'import sys,json; f=json.load(sys.stdin)["firewalls"]; print(f[0]["id"] if f else "")')
if [ -z "$fw_id" ]; then
  fw_id=$(api -X POST "$H/firewalls" -d '{"name":"lore","rules":[
    {"direction":"in","protocol":"tcp","port":"22","source_ips":["0.0.0.0/0","::/0"]},
    {"direction":"in","protocol":"tcp","port":"80","source_ips":["0.0.0.0/0","::/0"]},
    {"direction":"in","protocol":"tcp","port":"443","source_ips":["0.0.0.0/0","::/0"]}]}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["firewall"]["id"])')
  echo "created firewall lore ($fw_id)"
fi

user_data=$(python3 - "$here/cloud-init.yml" "$DOMAIN" "$pubkey" <<'PY'
import sys
text=open(sys.argv[1]).read().replace("__DOMAIN__", sys.argv[2]).replace("__SSH_KEY__", sys.argv[3])
print(text)
PY
)
body=$(python3 -c 'import json,sys; print(json.dumps({
  "name":"lore","server_type":sys.argv[1],"location":sys.argv[2],"image":"ubuntu-24.04",
  "ssh_keys":[int(sys.argv[3])],"firewalls":[{"firewall":int(sys.argv[4])}],
  "user_data":sys.argv[5],"labels":{"app":"lore"}}))' "$TYPE" "$LOCATION" "$key_id" "$fw_id" "$user_data")
resp=$(api -X POST "$H/servers" -d "$body")
ip=$(echo "$resp" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["server"]["public_net"]["ipv4"]["ip"]) if "server" in d else (print(json.dumps(d), file=sys.stderr) or sys.exit(1))')
echo
echo "server lore created: $ip ($TYPE, $LOCATION)"
echo "1. create the DNS record:   $DOMAIN  A  $ip"
echo "2. wait for cloud-init:     ssh deploy@$ip 'cloud-init status --wait; cat /var/log/lore-runsc-check.log'"
echo "3. continue with deploy/README.md, step 'Install the application'"
