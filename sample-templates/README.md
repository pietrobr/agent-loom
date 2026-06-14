# Sample agent templates

The **agent templates** (blueprints shown in the Admin Console's *Templates*
tab) live here as JSON, one file per template. They are the single source of
truth that `scripts/create_foundry_agents.py` seeds into Cosmos during install.

A template is a reusable definition — name, category, base instructions, the
parameters a partner can expose, whether it allows agentic retrieval, and the
default model. A real Foundry agent is only materialised **per customer** when
an instance is configured.

## What's here

| File | Template | Use |
|---|---|---|
| `customer-care-assistant.json` | Customer Care Assistant | General, courteous support agent |
| `knowledge-faq-assistant.json` | Knowledge / FAQ Assistant | Answers strictly grounded on the customer's knowledge base |

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable template id (also the Cosmos document id). |
| `name`, `description`, `category` | Shown in the Designer. |
| `model` | Default model deployment. Overridden at seed time by `FOUNDRY_MODEL_DEPLOYMENT` when set. |
| `instructions` | Base system instructions; each customer adds an addendum per instance. |
| `parameters` | Configurable knobs surfaced to the partner. |
| `agentic_retrieval` | When `true`, instances may enable Azure AI Search agentic retrieval. |
| `status` | `draft` or `published`. |

## Install with or without templates

Templates are seeded by default. To skip seeding them (e.g. you'll author your
own in the Admin Console), set the flag before deploying:

```bash
azd env set SEED_TEMPLATES false
azd up
```

> Note: the two demo customers reference these template ids, so if you disable
> templates you should also disable demo customers
> (`azd env set SEED_DEMO_CUSTOMERS false`) or seeding them will fail to find a
> template.

To add your own template, drop another `*.json` file in this folder using the
same shape and re-run `azd up` (or `python scripts/create_foundry_agents.py`).
