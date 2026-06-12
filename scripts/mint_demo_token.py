"""Mint a demo JWT (HS256) for local/manual testing of the chat endpoint.

Reads JWT_SECRET / JWT_ISSUER / JWT_AUDIENCE from env (matches the backend).

Usage:
  python scripts/mint_demo_token.py horizon-travel demo-user
  python scripts/mint_demo_token.py _system admin-user admin
"""
from __future__ import annotations

import os
import sys
import time

from jose import jwt


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    org_id = sys.argv[1]
    sub = sys.argv[2] if len(sys.argv) > 2 else "demo-user"
    roles = sys.argv[3:] if len(sys.argv) > 3 else []

    secret = os.environ.get("JWT_SECRET", "local-dev-secret-change-me")
    issuer = os.environ.get("JWT_ISSUER", "agentloom-local")
    audience = os.environ.get("JWT_AUDIENCE", "agentloom")
    ttl = int(os.environ.get("TOKEN_TTL", "3600"))

    now = int(time.time())
    claims = {
        "sub": sub,
        "org_id": org_id,
        "roles": roles,
        "iat": now,
        "exp": now + ttl,
        "iss": issuer,
        "aud": audience,
    }
    print(jwt.encode(claims, secret, algorithm="HS256"))


if __name__ == "__main__":
    main()
