#!/bin/sh
# Generates a tiny runtime config consumed by index.html before the app loads.
# API_BASE is provided as a Container App env var (the backend URL); the AUTH_*
# vars (optional) switch the SPA from dev-token mode to Entra ID MSAL sign-in.
set -e
TARGET=/usr/share/nginx/html/env-config.js
{
  echo "window.__API_BASE__ = \"${API_BASE:-}\";"
  echo "window.__AUTH_CLIENT_ID__ = \"${AUTH_CLIENT_ID:-}\";"
  echo "window.__AUTH_AUTHORITY__ = \"${AUTH_AUTHORITY:-}\";"
  echo "window.__AUTH_API_SCOPE__ = \"${AUTH_API_SCOPE:-}\";"
} > "$TARGET"
echo "Wrote $TARGET with API_BASE=${API_BASE:-<empty>} AUTH_CLIENT_ID=${AUTH_CLIENT_ID:-<empty>}"
