# Meridian Industries — HR Office (demo customer)

A fictional **HR office** that screens candidate CVs. This demo customer shows
how an agent can evaluate résumés against rules that the company maintains in
its knowledge base — rules that HR can re-upload and change over time.

The `knowledge/` files are the single source of truth and are uploaded when
seeding is enabled; you can also onboard the customer by hand from the Admin
Console. The `demo-cvs/` files are **test inputs** (not knowledge): paste one
into the chat and ask the agent to evaluate it.

## Customer details

| Field | Value |
|---|---|
| Customer ID (org_id) | `meridian-hr` |
| Display name | `Meridian Industries — HR Office` |
| Tier | `pro` |
| Brand: product name | `Meridian Talent Screener` |
| Brand: primary color | `#1F6FEB` |
| Brand: tagline | `Fair, fast candidate screening.` |
| Template | `cv-evaluation-assistant` |
| Instance display | `Meridian CV Screener` |

## Knowledge base — CV evaluation rules

These documents define how CVs are scored. HR can edit and re-upload them at any
time (the agent always uses the latest uploaded version):

| File | Purpose |
|---|---|
| `knowledge/01-evaluation-criteria.md` | Scoring criteria and weighting. |
| `knowledge/02-mandatory-requirements.md` | Knock-out requirements (force Reject). |
| `knowledge/03-scoring-and-recommendation.md` | Score thresholds → recommendation. |

## Demo CVs (test inputs)

| File | Expected outcome |
|---|---|
| `demo-cvs/marco-bianchi.md` | Strong candidate → **Advance**. |
| `demo-cvs/sara-conti.md` | < 3 years experience → mandatory requirement unmet → **Reject**. |

## Instructions addendum

```
You support the HR office of Meridian Industries, a mid-size engineering
company. Screen candidate CVs strictly against the current evaluation rules in
the knowledge base, which HR updates from time to time. When a mandatory
requirement is unmet, the recommendation must be Reject regardless of the
overall score.
```

## Suggested questions

```
What are our current CV evaluation criteria?
Evaluate the CV of Marco Bianchi for the Backend Engineer role.
Evaluate the CV of Sara Conti for the Backend Engineer role.
```
