"""FastAPI entry point."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .middleware import TenantContextMiddleware
from .routers import admin, branding, catalog, chat, demo, dev_auth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = get_settings()

app = FastAPI(
    title=f"{settings.product_name} API",
    version="1.0.0",
    description=settings.product_tagline,
)

app.add_middleware(TenantContextMiddleware)

# Security headers — set after CORS so they apply to every response.
@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


# CORS must be the OUTERMOST middleware (added last) so that Access-Control-*
# headers are attached to EVERY response, including 401/403 returned early by
# TenantContextMiddleware. Otherwise the browser masks auth errors as CORS
# failures ("Failed to fetch").
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=True,
)


@app.get("/healthz", tags=["meta"])
@app.get("/v1/healthz", tags=["meta"])
def healthz() -> dict:
    return {"status": "ok", "product": settings.product_name}


@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "product": settings.product_name,
        "tagline": settings.product_tagline,
        "endpoints": ["/v1/catalog", "/v1/chat", "/v1/admin/...", "/healthz"],
    }


app.include_router(catalog.router)
app.include_router(branding.router)
app.include_router(chat.router)
app.include_router(admin.router)
app.include_router(dev_auth.router)
app.include_router(demo.router)
