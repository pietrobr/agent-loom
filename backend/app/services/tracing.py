"""In-app distributed tracing.

A lightweight, dependency-free tracer that records, for every API request, the
full *round trip* the call makes through the application — the sequence of
spans (Cosmos reads, Search queries, agentic retrieval, Foundry calls, …),
their timing, any errors, and structured events. Traces are stored per-customer
in Cosmos (``traces`` container, with a TTL so they auto-expire) and surfaced in
the Admin Console's Tracing page, filterable by customer, date and level.

Design notes
------------
* The "current" trace is held in a :class:`contextvars.ContextVar`, so service
  code can add spans without threading a handle through every call. anyio copies
  the context into worker threads, so spans created inside ``to_thread`` sync
  calls (Foundry/Search SDKs) attach to the same trace.
* Everything here is **best-effort**: a failure in tracing must never break a
  request, so all public helpers swallow their own exceptions.
* The capture *level* (DEBUG/INFO/WARNING/ERROR) is an admin-tunable threshold.
  A finished trace is persisted only when its highest span level meets the
  configured level — so at WARNING you keep only requests that warned or
  errored, at ERROR only failures, and at DEBUG ("verbose") everything plus
  debug events.
"""
from __future__ import annotations

import contextlib
import logging
import threading
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

# Severity ladder. "verbose" is exposed in the UI as a friendly alias for DEBUG.
LEVELS: Dict[str, int] = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}
DEFAULT_LEVEL = "INFO"

# How long persisted traces live before Cosmos evicts them (14 days).
TRACE_TTL_SECONDS = 14 * 24 * 3600


def level_value(level: str) -> int:
    return LEVELS.get((level or "").strip().upper(), LEVELS[DEFAULT_LEVEL])


def normalize_level(level: str) -> str:
    up = (level or "").strip().upper()
    if up == "VERBOSE":
        up = "DEBUG"
    return up if up in LEVELS else DEFAULT_LEVEL


# --------------------------------------------------------------------------- #
# Trace / span model                                                          #
# --------------------------------------------------------------------------- #
class _Span:
    __slots__ = ("id", "parent_id", "name", "start_ms", "duration_ms",
                 "level", "status", "attributes", "events", "error")

    def __init__(self, name: str, parent_id: Optional[str], start_ms: float, level: str):
        self.id = uuid.uuid4().hex[:12]
        self.parent_id = parent_id
        self.name = name
        self.start_ms = round(start_ms, 2)
        self.duration_ms = 0.0
        self.level = level
        self.status = "ok"
        self.attributes: Dict[str, Any] = {}
        self.events: List[Dict[str, Any]] = []
        self.error: Optional[Dict[str, str]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "parent_id": self.parent_id,
            "name": self.name,
            "start_ms": self.start_ms,
            "duration_ms": round(self.duration_ms, 2),
            "level": self.level,
            "status": self.status,
            "attributes": self.attributes,
            "events": self.events,
            "error": self.error,
        }


class Trace:
    """Mutable, thread-safe collector for one request's spans."""

    def __init__(self, org_id: str, sub: str, method: str, path: str):
        self.id = uuid.uuid4().hex
        self.org_id = org_id or "_system"
        self.sub = sub or ""
        self.method = method
        self.path = path
        self.route: str = path
        self.status: int = 0
        self.started_at = datetime.now(timezone.utc)
        self._t0 = time.perf_counter()
        self._lock = threading.Lock()
        self._stack: List[str] = []
        self.spans: List[_Span] = []
        self.max_level = LEVELS["INFO"]
        self.error: Optional[Dict[str, str]] = None
        self._root_events: List[Dict[str, Any]] = []

    # -- internal helpers --------------------------------------------------- #
    def _now_ms(self) -> float:
        return (time.perf_counter() - self._t0) * 1000.0

    def _bump_level(self, level: str) -> None:
        v = level_value(level)
        if v > self.max_level:
            self.max_level = v

    def open_span(self, name: str, level: str, attributes: Dict[str, Any]) -> _Span:
        with self._lock:
            parent = self._stack[-1] if self._stack else None
            sp = _Span(name, parent, self._now_ms(), normalize_level(level))
            if attributes:
                sp.attributes.update(_safe(attributes))
            self.spans.append(sp)
            self._stack.append(sp.id)
            self._bump_level(sp.level)
            return sp

    def close_span(self, sp: _Span) -> None:
        with self._lock:
            sp.duration_ms = self._now_ms() - sp.start_ms
            if self._stack and self._stack[-1] == sp.id:
                self._stack.pop()
            else:  # out-of-order close (concurrent) — remove if present
                with contextlib.suppress(ValueError):
                    self._stack.remove(sp.id)

    def add_event(self, message: str, level: str, attributes: Dict[str, Any]) -> None:
        with self._lock:
            lvl = normalize_level(level)
            ev = {
                "ts_ms": round(self._now_ms(), 2),
                "level": lvl,
                "message": str(message)[:2000],
                "attributes": _safe(attributes) if attributes else {},
            }
            # Attach to the currently-open span when there is one; otherwise the
            # event lives on the trace as a root-level event.
            target = None
            if self._stack:
                top_id = self._stack[-1]
                for sp in reversed(self.spans):
                    if sp.id == top_id:
                        target = sp
                        break
            if target is not None:
                target.events.append(ev)
            else:
                self._root_events.append(ev)
            self._bump_level(lvl)

    def mark_error(self, exc: BaseException) -> None:
        self.error = {"type": type(exc).__name__, "message": str(exc)[:2000]}
        self.max_level = LEVELS["ERROR"]

    @property
    def level_name(self) -> str:
        for name, val in sorted(LEVELS.items(), key=lambda kv: kv[1], reverse=True):
            if self.max_level >= val:
                return name
        return "INFO"

    def to_dict(self, capture_level: str) -> Dict[str, Any]:
        keep_debug = level_value(capture_level) <= LEVELS["DEBUG"]
        spans = []
        for sp in self.spans:
            d = sp.to_dict()
            if not keep_debug and d["events"]:
                d["events"] = [e for e in d["events"] if e["level"] != "DEBUG"]
            spans.append(d)
        root_events = getattr(self, "_root_events", [])
        if not keep_debug:
            root_events = [e for e in root_events if e["level"] != "DEBUG"]
        return {
            "id": self.id,
            "org_id": self.org_id,
            "kind": "trace",
            "ts": self.started_at.isoformat(),
            "method": self.method,
            "path": self.path,
            "route": self.route,
            "status": self.status,
            "duration_ms": round(self._now_ms(), 2),
            "level": self.level_name,
            "error": self.error,
            "user": self.sub,
            "spans": spans,
            "root_events": root_events,
            "span_count": len(spans),
            "ttl": TRACE_TTL_SECONDS,
        }


def _safe(attrs: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce attribute values to small, JSON-serialisable primitives."""
    out: Dict[str, Any] = {}
    for k, v in (attrs or {}).items():
        if v is None or isinstance(v, (bool, int, float)):
            out[k] = v
        else:
            s = str(v)
            out[k] = s if len(s) <= 500 else s[:500] + "…"
    return out


# --------------------------------------------------------------------------- #
# Context-local current trace + public API                                    #
# --------------------------------------------------------------------------- #
_current: ContextVar[Optional[Trace]] = ContextVar("current_trace", default=None)


def start_trace(org_id: str, sub: str, method: str, path: str) -> Trace:
    tr = Trace(org_id, sub, method, path)
    _current.set(tr)
    return tr


def current() -> Optional[Trace]:
    return _current.get()


def clear() -> None:
    _current.set(None)


@contextlib.contextmanager
def span(name: str, level: str = "INFO", **attributes: Any):
    """Record a child span around a block of work.

    Safe to use even when no trace is active (becomes a no-op).
    """
    tr = current()
    if tr is None:
        yield None
        return
    sp: Optional[_Span] = None
    try:
        sp = tr.open_span(name, level, attributes)
    except Exception:  # pragma: no cover - never break the caller
        yield None
        return
    try:
        yield sp
    except BaseException as exc:
        try:
            if sp is not None:
                sp.status = "error"
                sp.error = {"type": type(exc).__name__, "message": str(exc)[:2000]}
                tr.max_level = LEVELS["ERROR"]
        except Exception:
            pass
        raise
    finally:
        try:
            if sp is not None:
                tr.close_span(sp)
        except Exception:
            pass


def event(message: str, level: str = "INFO", **attributes: Any) -> None:
    """Record a point-in-time event on the current span/trace (best-effort)."""
    tr = current()
    if tr is None:
        return
    try:
        tr.add_event(message, level, attributes)
    except Exception:
        pass


def set_attr(**attributes: Any) -> None:
    """Attach attributes to the currently-open span (best-effort)."""
    tr = current()
    if tr is None or not tr.spans:
        return
    try:
        with tr._lock:  # noqa: SLF001 - same module
            if tr._stack:
                top_id = tr._stack[-1]
                for sp in reversed(tr.spans):
                    if sp.id == top_id:
                        sp.attributes.update(_safe(attributes))
                        break
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Capture-level config (cached) + ASGI middleware                             #
# --------------------------------------------------------------------------- #
_config_cache: Dict[str, Any] = {"level": DEFAULT_LEVEL, "exp": 0.0}
_CONFIG_TTL = 30.0  # seconds


def get_capture_level() -> str:
    """Current capture-level threshold, cached for a few seconds."""
    now = time.time()
    if _config_cache["exp"] > now:
        return _config_cache["level"]
    level = DEFAULT_LEVEL
    try:
        from . import cosmos  # local import to avoid cycle

        level = normalize_level(cosmos.get_tracing_config().get("level", DEFAULT_LEVEL))
    except Exception:
        pass
    _config_cache["level"] = level
    _config_cache["exp"] = now + _CONFIG_TTL
    return level


def invalidate_config_cache() -> None:
    _config_cache["exp"] = 0.0


# Paths that are never traced (health checks, docs, and the tracing API itself
# to avoid self-referential noise).
_SKIP_PREFIXES = ("/v1/admin/traces", "/v1/admin/tracing", "/docs", "/redoc", "/openapi")
_SKIP_EXACT = {"/", "/healthz", "/v1/healthz", "/favicon.ico"}


def _should_trace(method: str, path: str) -> bool:
    if method == "OPTIONS":
        return False
    if path in _SKIP_EXACT:
        return False
    return not any(path.startswith(p) for p in _SKIP_PREFIXES)


class TracingMiddleware:
    """Starlette/ASGI middleware that records one trace per HTTP request.

    Implemented as a raw ASGI middleware (not BaseHTTPMiddleware) so the
    contextvar set here reliably propagates to the route handler and to anyio
    worker threads used by the sync Azure SDK calls.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        path = scope.get("path", "")
        if not _should_trace(method, path):
            await self.app(scope, receive, send)
            return

        tr = start_trace(org_id="_system", sub="", method=method, path=path)
        status_holder = {"code": 0}

        async def send_wrapper(message):
            if message.get("type") == "http.response.start":
                status_holder["code"] = message.get("status", 0)
            await send(message)

        error: Optional[BaseException] = None
        try:
            await self.app(scope, receive, send_wrapper)
        except BaseException as exc:  # noqa: BLE001 - re-raised after recording
            error = exc
            tr.mark_error(exc)
            raise
        finally:
            try:
                tr.status = status_holder["code"] or (500 if error else 0)
                # Resolve the authenticated principal stashed on the request
                # state by the tenant-context middleware (set during the call).
                principal = None
                state = scope.get("state") or {}
                principal = state.get("principal")
                if principal is not None:
                    tr.org_id = getattr(principal, "org_id", tr.org_id) or tr.org_id
                    tr.sub = getattr(principal, "sub", tr.sub) or tr.sub
                if tr.status >= 500:
                    tr.max_level = max(tr.max_level, LEVELS["ERROR"])
                elif tr.status >= 400 and tr.max_level < LEVELS["WARNING"]:
                    tr.max_level = LEVELS["WARNING"]
                _persist(tr)
            except Exception:  # pragma: no cover - never break the response
                pass
            finally:
                clear()


def _persist(tr: Trace) -> None:
    capture = get_capture_level()
    if tr.max_level < level_value(capture):
        return
    try:
        from . import cosmos  # local import to avoid cycle

        cosmos.save_trace(tr.to_dict(capture))
    except Exception:
        pass

