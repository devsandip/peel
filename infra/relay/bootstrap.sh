#!/bin/bash
set -euo pipefail
trap '/usr/sbin/shutdown -h now' ERR
# Arm the guest limit before downloads/setup; the independent AWS schedule is a second guard.
systemd-run --unit=peel-m0-expiry --on-active=30m --timer-property=AccuracySec=1s /usr/sbin/shutdown -h now
test "$(wc -l < /proc/swaps)" -eq 1
ulimit -c 0
systemctl mask coturn.service
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends coturn python3 curl
install -d -m 0750 -o root -g turnserver /run/peel-m0-turn
install -d -m 0750 -o turnserver -g turnserver /run/peel-m0-turn/runtime
install -d -m 0755 /usr/local/lib/peel-m0-turn
TOKEN=$(curl --fail --silent --show-error --max-time 5 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)
curl --fail --silent --show-error --max-time 5 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 > /run/peel-m0-turn/public-ip
curl --fail --silent --show-error --max-time 5 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4 > /run/peel-m0-turn/private-ip
unset TOKEN
python3 - <<'PYCONFIG'
from pathlib import Path
import os, secrets, grp
root = Path('/run/peel-m0-turn')
secret = secrets.token_hex(32)
(root / 'secret').write_text(secret)
os.chmod(root / 'secret', 0o600)
public = (root / 'public-ip').read_text().strip()
private = (root / 'private-ip').read_text().strip()
config = f'''listening-port=3478
listening-ip={private}
relay-ip={private}
external-ip={public}/{private}
min-port=49160
max-port=49179
realm=peel-m0.invalid
fingerprint
use-auth-secret
static-auth-secret={secret}
userdb=/run/peel-m0-turn/runtime/users.sqlite
user-quota=2
total-quota=4
max-bps=131072
bps-capacity=131072
max-allocate-lifetime=120
stale-nonce=120
no-tcp-relay
no-tls
no-dtls
no-cli
no-multicast-peers
denied-peer-ip=0.0.0.0-255.255.255.255
allowed-peer-ip={public}
log-file=/dev/null
simple-log
no-stdout-log
pidfile=/run/peel-m0-turn/runtime/turnserver.pid
'''
path = root / 'turnserver.conf'
path.write_text(config)
os.chown(path, 0, grp.getgrnam('turnserver').gr_gid)
os.chmod(path, 0o640)
PYCONFIG
cat > /usr/local/lib/peel-m0-turn/lease.py <<'PYLEASE'
__LEASE_HELPER__
PYLEASE
chmod 0755 /usr/local/lib/peel-m0-turn/lease.py
cat > /usr/local/lib/peel-m0-turn/health.py <<'PYHEALTH'
__HEALTH_HELPER__
PYHEALTH
chmod 0755 /usr/local/lib/peel-m0-turn/health.py
cat > /etc/systemd/system/peel-m0-turn.service <<'UNIT'
[Unit]
Description=Peel bounded synthetic TURN experiment
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=turnserver
Group=turnserver
ExecStart=/usr/bin/turnserver -c /run/peel-m0-turn/turnserver.conf
Restart=no
LimitCORE=0
MemoryMax=192M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/run/peel-m0-turn/runtime
PrivateTmp=true
StandardOutput=null
StandardError=null
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl start peel-m0-turn.service
systemctl is-active --quiet peel-m0-turn.service
