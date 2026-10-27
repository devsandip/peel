"""Short-lived M0 TURN authentication, not Peel pairing or an app entitlement."""
import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import sys
import time
from pathlib import Path


def issue(secret: bytes, now: int, nonce: str, public_ip: str) -> dict:
    if len(secret) < 32 or not isinstance(now, int) or now < 0:
        raise ValueError("Invalid lease inputs")
    if not re.fullmatch(r"[a-z0-9-]{8,64}", nonce):
        raise ValueError("Invalid lease nonce")
    address = ipaddress.IPv4Address(public_ip)
    if address.is_private or address.is_multicast or address.is_unspecified:
        raise ValueError("The relay needs a public IPv4 address")
    expires = now + 300
    username = f"{expires}:peel-m0:{nonce}"
    credential = base64.b64encode(hmac.new(secret, username.encode(), hashlib.sha1).digest()).decode()
    return {
        "expiresAt": expires,
        "username": username,
        "credential": credential,
        "urls": [f"turn:{address}:3478?transport=udp", f"turn:{address}:3478?transport=tcp"],
    }


if __name__ == "__main__":
    if sys.argv[1:] not in ([], ["--expired-fixture"]):
        raise ValueError("Unrecognized M0 fixture option")
    root = Path("/run/peel-m0-turn")
    secret = (root / "secret").read_bytes().strip()
    address = (root / "public-ip").read_text().strip()
    now = int(time.time()) - (600 if sys.argv[1:] else 0)
    print(json.dumps(issue(secret, now, secrets.token_hex(16), address)))
