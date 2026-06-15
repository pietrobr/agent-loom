"""Production token verification helpers: OIDC JWKS fetch + RS256 validation.

Used when ``AUTH_MODE=production``. Verifies access tokens issued by the two
Microsoft Entra tenants:

  * the **provider workforce** tenant (admins), and
  * the **customer Entra External ID (CIAM)** tenant (end users).

Each token is matched to its issuer, then its signature is verified against that
issuer's published JWKS (cached), along with audience / issuer / exp / iat.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Optional

import httpx
from jose import jwt
from jose.exceptions import JWTError

log = logging.getLogger(__name__)

# kid -> JWK, cached per JWKS URI, with a short TTL so key rollover is picked up.
_JWKS_CACHE: Dict[str, Dict[str, Any]] = {}
_JWKS_FETCHED_AT: Dict[str, float] = {}
_JWKS_TTL_SECONDS = 3600
_LOCK = threading.Lock()


def _get_jwks(jwks_uri: str) -> Dict[str, Any]:
    """Return {kid: jwk} for a JWKS URI, refreshing on TTL or cache miss."""
    now = time.time()
    cached = _JWKS_CACHE.get(jwks_uri)
    if cached and (now - _JWKS_FETCHED_AT.get(jwks_uri, 0)) < _JWKS_TTL_SECONDS:
        return cached
    with _LOCK:
        # Re-check after acquiring the lock (another thread may have refreshed).
        cached = _JWKS_CACHE.get(jwks_uri)
        if cached and (now - _JWKS_FETCHED_AT.get(jwks_uri, 0)) < _JWKS_TTL_SECONDS:
            return cached
        resp = httpx.get(jwks_uri, timeout=10.0)
        resp.raise_for_status()
        keys = {k["kid"]: k for k in resp.json().get("keys", []) if "kid" in k}
        _JWKS_CACHE[jwks_uri] = keys
        _JWKS_FETCHED_AT[jwks_uri] = now
        return keys


def _signing_key(token: str, jwks_uri: str) -> Optional[Dict[str, Any]]:
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except JWTError:
        return None
    if not kid:
        return None
    keys = _get_jwks(jwks_uri)
    key = keys.get(kid)
    if key is None:
        # Possible key rollover — force a refresh once.
        _JWKS_FETCHED_AT.pop(jwks_uri, None)
        keys = _get_jwks(jwks_uri)
        key = keys.get(kid)
    return key


def unverified_issuer(token: str) -> Optional[str]:
    """Read the (unverified) ``iss`` claim to route a token to the right IdP."""
    try:
        return jwt.get_unverified_claims(token).get("iss")
    except JWTError:
        return None


def verify_rs256(token: str, *, jwks_uri: str, issuer: str, audience: str) -> Dict[str, Any]:
    """Verify an RS256 token's signature, issuer, audience and timestamps.

    Returns the decoded claims, or raises ``JWTError`` on any failure.
    """
    key = _signing_key(token, jwks_uri)
    if key is None:
        raise JWTError("no matching signing key (kid) in JWKS")
    return jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        audience=audience,
        issuer=issuer,
        options={"require": ["exp", "iat"]},
    )
