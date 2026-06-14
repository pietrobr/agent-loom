# Horizon Travel — demo customer

A fictional **premium travel agency**. This is one of the two customers that the
post-provision hook can seed automatically (see *Install with or without demo
customers* in the repo README). The knowledge files below are the single source
of truth: `scripts/seed_customers.py` uploads them when seeding is enabled, and
you can also onboard the customer by hand from the Admin Console.

## Customer details

| Field | Value |
|---|---|
| Customer ID (org_id) | `horizon-travel` |
| Display name | `Horizon Travel` |
| Tier | `pro` |
| Brand: product name | `Horizon Travel Concierge` |
| Brand: primary color | `#0E7C86` |
| Brand: tagline | `Your journey, our care.` |
| Template | `customer-care-assistant` |
| Instance display | `Horizon Customer Care` |

## Instructions addendum

```
You represent Horizon Travel, a premium travel agency. Booking changes are free
up to 14 days before departure. Always offer to escalate complex refund cases to
a human agent.
```

## Suggested questions

```
How do I change my booking?
What is your refund policy?
How do I add baggage to my reservation?
```
