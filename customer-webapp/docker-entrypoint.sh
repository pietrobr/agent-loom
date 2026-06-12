#!/bin/sh
# Generates a tiny runtime config consumed by index.html before the app loads.
# API_BASE is provided as a Container App env var (the backend URL).
set -e
TARGET=/usr/share/nginx/html/env-config.js
echo "window.__API_BASE__ = \"${API_BASE:-}\";" > "$TARGET"
echo "Wrote $TARGET with API_BASE=${API_BASE:-<empty>}"
