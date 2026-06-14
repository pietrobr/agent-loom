# Stride Labs — sample customer (manual onboarding)

A fictional **running-shoe manufacturer** you can onboard yourself from the
AgentLoom SaaS Admin Console to demo the platform end-to-end.

> Nothing here is created automatically. Follow the steps below to add the
> customer, assign an instance, and upload the knowledge-base files.

## Suggested customer details

| Field | Value |
|---|---|
| Customer ID (org_id) | `stride-labs` |
| Display name | `Stride Labs` |
| Tier | `pro` |
| Brand: product name | `Stride Assistant` |
| Brand: primary color | `#E8552D` |
| Brand: tagline | `Run further, recover faster.` |

## How to onboard (Admin Console)

1. **Customers** tab → *Onboard customer* → fill the fields above → **Save**
   (this auto-creates the `kb-stride-labs` Search index).
2. **Instances** tab → select **Stride Labs** in the customer list →
   *Assign template* → choose **Knowledge / FAQ Assistant** (or **Customer Care
   Assistant**), set a Display name like `Stride Runner Support`, optionally
   paste the instructions addendum below, and paste the **suggested questions**
   (one per line) from the section further down → **Assign**.
3. Still in **Instances**, in *Upload knowledge* select the new instance and
   upload **all the files in the `knowledge/` folder** (multi-select is
   supported) → **Upload & index**.
4. Open the customer webapp, pick **Stride Labs**, and ask things like
   *"Which shoe is best for marathon training?"* or *"How do I return a pair?"*.

## Suggested instructions addendum (optional)

```
You represent Stride Labs, a performance running-shoe brand. Be friendly,
energetic and practical, like a knowledgeable run-store associate. Recommend
shoes only from the current range in the knowledge base, and always ask about
the runner's distance, surface and pronation before suggesting a model. For
sizing disputes, defective pairs, or anything needing a human, offer to connect
the runner with the Stride Labs Support team.
```

## Suggested questions (chips in the customer chat)

Paste these into the *Suggested questions* box on the **Assign template** form
(one per line). They appear as clickable chips on the welcome screen of the
customer chat:

```
Which shoe is best for marathon training?
How do I find my correct size?
What is your return and exchange policy?
How many kilometres should a pair last?
```
