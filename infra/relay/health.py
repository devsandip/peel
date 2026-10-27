"""Metadata-only readiness check on the disposable relay. Never returns secret values."""
import json
import subprocess
from pathlib import Path


def active(unit: str) -> bool:
    return subprocess.run(["systemctl", "is-active", "--quiet", unit], capture_output=True).returncode == 0


root = Path("/run/peel-m0-turn")
lines = set((root / "turnserver.conf").read_text().splitlines())
secret = (root / "secret").read_text().strip()
public = (root / "public-ip").read_text().strip()
version = subprocess.check_output(["dpkg-query", "-W", "-f=${Version}", "coturn"], text=True).strip()
storage = subprocess.check_output(["findmnt", "-n", "-o", "FSTYPE", "/run"], text=True).strip()
limit = subprocess.check_output(["systemctl", "show", "peel-m0-turn.service", "-p", "LimitCORE", "--value"], text=True).strip()
print(json.dumps({
    "coturnPackageVersion": version,
    "serviceActive": active("peel-m0-turn.service"),
    "guestTimerActive": active("peel-m0-expiry.timer"),
    "swapEntries": max(0, len(Path("/proc/swaps").read_text().splitlines()) - 1),
    "coreDumpDisabled": limit == "0",
    "runtimeInMemory": storage == "tmpfs",
    "authenticationConfigured": "use-auth-secret" in lines and f"static-auth-secret={secret}" in lines and len(secret) == 64 and "no-auth" not in lines,
    "limitsConfigured": {"user-quota=2", "total-quota=4", "max-bps=131072", "bps-capacity=131072", "max-allocate-lifetime=120"}.issubset(lines),
    "logsDisabled": {"log-file=/dev/null", "simple-log", "no-stdout-log"}.issubset(lines),
    "peerRestricted": "denied-peer-ip=0.0.0.0-255.255.255.255" in lines and f"allowed-peer-ip={public}" in lines and len([line for line in lines if line.startswith("allowed-peer-ip=")]) == 1,
}))
