# Aurelia Motors — sample customer (manual onboarding)

A fictional **luxury car manufacturer** you can onboard yourself from the
AgentLoom SaaS Admin Console to demo the platform end-to-end.

> Nothing here is created automatically. Follow the steps below to add the
> customer, assign an instance, and upload the knowledge-base files.

## Suggested customer details

| Field | Value |
|---|---|
| Customer ID (org_id) | `aurelia-motors` |
| Display name | `Aurelia Motors` |
| Tier | `pro` |
| Brand: product name | `Aurelia Concierge` |
| Brand: primary color | `#1B1F3B` |
| Brand: tagline | `Crafted for the extraordinary.` |

## How to onboard (Admin Console)

1. **Customers** tab → *Onboard customer* → fill the fields above → **Save**
   (this auto-creates the `kb-aurelia-motors` Search index).
2. **Instances** tab → select **Aurelia Motors** in the customer list →
   *Assign template* → choose **Customer Care Assistant** (or **Knowledge / FAQ
   Assistant**), set a Display name like `Aurelia Owner Care`, optionally paste
   the instructions addendum below, and paste the **suggested questions** (one
   per line) from the section further down → **Assign**.
3. Still in **Instances**, in *Upload knowledge* select the new instance and
   upload **all the files in the `knowledge/` folder** (multi-select is
   supported) → **Upload & index**.
4. Open the customer webapp, pick **Aurelia Motors**, and ask things like
   *"What does the warranty cover?"* or *"How do I book a service?"*.

## Suggested instructions addendum (optional)

```
You represent Aurelia Motors, a luxury automobile manufacturer. Maintain a
refined, concierge tone. Never quote prices unless they appear in the knowledge
base. For test drives, bespoke commissions, or anything requiring a human,
offer to connect the client with their dedicated Aurelia Client Advisor.
```

## Suggested questions (chips in the customer chat)

Paste these into the *Suggested questions* box on the **Assign template** form
(one per line). They appear as clickable chips on the welcome screen of the
customer chat:

```
What does the warranty cover?
How do I book a service?
What models are in the current range?
How do I commission a bespoke build?
```

