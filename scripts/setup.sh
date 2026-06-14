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

echo "Installing dependencies for the API seeder…"
python3 -m pip install --quiet httpx

echo "Seeding via backend API ($BACKEND_URL)…"
python3 "$REPO/scripts/seed_via_api.py"

echo "Done. URLs:"
echo "  Backend  : $(azd env get-value BACKEND_URL)"
echo "  Admin    : $(azd env get-value ADMIN_URL)"
echo "  Customer : $(azd env get-value CUSTOMER_URL)"
