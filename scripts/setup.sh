#!/usr/bin/env sh
# AgentLoom post-provision hook: seeds Cosmos catalog + creates Foundry agents
# + seeds the two demo customers. Invoked by ``azd up``.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

export COSMOS_ENDPOINT="$(azd env get-value COSMOS_ENDPOINT)"
export COSMOS_DATABASE="$(azd env get-value COSMOS_DATABASE)"
export SEARCH_ENDPOINT="$(azd env get-value SEARCH_ENDPOINT)"
export STORAGE_ACCOUNT="$(azd env get-value STORAGE_ACCOUNT)"
export STORAGE_CONTAINER="$(azd env get-value STORAGE_CONTAINER)"
export KEYVAULT_URI="$(azd env get-value KEYVAULT_URI)"
export FOUNDRY_PROJECT_ENDPOINT="$(azd env get-value FOUNDRY_PROJECT_ENDPOINT)"
export FOUNDRY_MODEL_DEPLOYMENT="$(azd env get-value FOUNDRY_MODEL_DEPLOYMENT)"

echo "Installing backend dependencies for seed scripts…"
python3 -m pip install --quiet -r "$REPO/backend/requirements.txt"

echo "Creating Foundry agent templates…"
python3 "$REPO/scripts/create_foundry_agents.py"

echo "Seeding demo customers…"
python3 "$REPO/scripts/seed_customers.py"

echo "Done. URLs:"
echo "  Backend  : $(azd env get-value BACKEND_URL)"
echo "  Admin    : $(azd env get-value ADMIN_URL)"
echo "  Customer : $(azd env get-value CUSTOMER_URL)"
