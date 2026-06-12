"""Smoke test end-to-end contro il backend deployato.

Minta due token (Horizon Travel e NovaTech), chiama /v1/chat in streaming,
e verifica anche l'isolamento cross-tenant (atteso 403).
"""
import json
import os
import time
import urllib.request

import sys
sys.path.insert(0, "backend")
from jose import jwt

BACKEND = os.environ["BACKEND_URL"].rstrip("/")
SECRET = os.environ.get("JWT_SECRET", "local-dev-secret-change-me")
ISS = os.environ.get("JWT_ISSUER", "agentloom-local")
AUD = os.environ.get("JWT_AUDIENCE", "agentloom")


def tok(org, roles=None):
    now = int(time.time())
    return jwt.encode(
        {"sub": f"demo-{org}", "org_id": org, "roles": roles or [],
         "iat": now, "exp": now + 1800, "iss": ISS, "aud": AUD},
        SECRET, algorithm="HS256",
    )


def chat(org, instance_id, message):
    body = json.dumps({"message": message, "instance_id": instance_id}).encode()
    req = urllib.request.Request(
        f"{BACKEND}/v1/chat", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + tok(org),
                 "Accept": "text/event-stream"},
    )
    print(f"\n=== CHAT [{org}/{instance_id}] Q: {message}")
    text = []
    with urllib.request.urlopen(req, timeout=120) as resp:
        event = None
        for raw in resp:
            line = raw.decode("utf-8", "ignore").rstrip("\n")
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
                if event == "token":
                    text.append(data)
                elif event == "meta":
                    print("  meta:", data)
                elif event == "usage":
                    print("  usage:", data)
                elif event == "error":
                    print("  ERROR:", data)
    print("  ANSWER:", "".join(text)[:600])


def cross_tenant_check():
    # org horizon-travel token tenta di usare l'istanza di novatech
    body = json.dumps({"message": "hi", "instance_id": "inst-knowledge-faq-assistant"}).encode()
    req = urllib.request.Request(
        f"{BACKEND}/v1/chat", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + tok("horizon-travel"),
                 "Accept": "text/event-stream"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            print("\n=== CROSS-TENANT: status", resp.status, "(atteso 404, istanza non nel suo org)")
    except urllib.error.HTTPError as e:
        print("\n=== CROSS-TENANT: HTTP", e.code, "(isolamento OK se 403/404)")


if __name__ == "__main__":
    chat("horizon-travel", "inst-customer-care-assistant", "What is your refund policy?")
    chat("novatech", "inst-knowledge-faq-assistant", "What is included in a support contract?")
    cross_tenant_check()
    print("\nDONE")
