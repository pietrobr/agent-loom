#!/usr/bin/env sh
# AgentLoom post-provision hook: seeds the catalog (agent templates) + the two
# demo customers (instances + knowledge). Invoked by ``azd up``.
#
# Cosmos DB is private (publicNetworkAccess=Disabled), so this hook cannot reach
# it from the developer machine. Instead it drives the backend Container App —
# which lives inside the VNet — over its public HTTPS ingress (BACKEND_URL).
# The backend performs all the Cosmos/Search/Blob/Foundry writes. No firewall
# changes required.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

export BACKEND_URL="$(azd env get-value BACKEND_URL)"
export FOUNDRY_MODEL_DEPLOYMENT="$(azd env get-value FOUNDRY_MODEL_DEPLOYMENT)"

# Seed flags (default: enabled). Configure before `azd up` with e.g.
#   azd env set SEED_TEMPLATES false
#   azd env set SEED_DEMO_CUSTOMERS false
SEED_TEMPLATES="$(azd env get-value SEED_TEMPLATES 2>/dev/null || echo true)"
export SEED_TEMPLATES
SEED_DEMO_CUSTOMERS="$(azd env get-value SEED_DEMO_CUSTOMERS 2>/dev/null || echo true)"
export SEED_DEMO_CUSTOMERS

# In production auth mode the seeder needs an interactive admin sign-in, which
# must not happen inside `azd up`. Skip auto-seeding and tell the user to run it
# manually as a separate step (keeps dev and prod fully separate).
AUTH_MODE="$(azd env get-value AUTH_MODE 2>/dev/null || echo dev)"
export AUTH_MODE
case "$(printf '%s' "$AUTH_MODE" | tr '[:upper:]' '[:lower:]')" in
  production|prod)
    echo "AUTH_MODE=production — skipping automatic seeding."
    echo "Run the seed manually once, signing in as the provider admin:"
    echo ""
    echo "  export AUTH_MODE=production"
    echo "  export BACKEND_URL=\$(azd env get-value BACKEND_URL)"
    echo "  export VITE_ADMIN_CLIENT_ID=\$(azd env get-value VITE_ADMIN_CLIENT_ID)"
    echo "  export VITE_ADMIN_AUTHORITY=\$(azd env get-value VITE_ADMIN_AUTHORITY)"
    echo "  export VITE_ADMIN_API_SCOPE=\$(azd env get-value VITE_ADMIN_API_SCOPE)"
    echo "  python3 scripts/seed_via_api.py"
    echo ""
    ;;
  *)
    echo "Installing dependencies for the API seeder…"
    python3 -m pip install --quiet httpx
    echo "Seeding via backend API ($BACKEND_URL)…"
    python3 "$REPO/scripts/seed_via_api.py"
    ;;
esac

echo "Done. URLs:"
echo "  Backend  : $(azd env get-value BACKEND_URL)"
echo "  Admin    : $(azd env get-value ADMIN_URL)"
echo "  Customer : $(azd env get-value CUSTOMER_URL)"
