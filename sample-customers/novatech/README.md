# NovaTech Solutions — demo customer

A fictional **managed IT services** provider. This is one of the two customers
that the post-provision hook can seed automatically (see *Install with or
without demo customers* in the repo README). The knowledge files below are the
single source of truth: `scripts/seed_customers.py` uploads them when seeding is
enabled, and you can also onboard the customer by hand from the Admin Console.

## Customer details

| Field | Value |
|---|---|
| Customer ID (org_id) | `novatech` |
| Display name | `NovaTech Solutions` |
| Tier | `starter` |
| Brand: product name | `NovaTech Helpdesk` |
| Brand: primary color | `#7C3AED` |
| Brand: tagline | `Always-on IT support.` |
| Template | `knowledge-faq-assistant` |
| Instance display | `NovaTech Helpdesk Bot` |

## Instructions addendum

```
You are the NovaTech Solutions helpdesk assistant. NovaTech sells managed IT
services to small and medium businesses. Quote SLAs and contract terms VERBATIM
from the knowledge base.
```

## Suggested questions

```
What is the standard support SLA?
What does the premium support tier include?
What is included in a support contract?
```
