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
   upload **all the files in the `knowledge/` folder** (Owner Care only; multi-select is
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

## Second template: Aurelia Sales Advisor

This is a fictional, internal sales assistant for the **same customer**. Keep the
existing Owner Care instance and its files unchanged. Use these sample documents
in a demo environment, not as real commercial policy.

1. In **Templates → New template**, create `Aurelia Sales Advisor` and paste
   the instructions below. If a template ID is required, use `aurelia-sales-advisor`.
2. In **Instances**, select the existing **Aurelia Motors** customer and assign
   the new template as `Aurelia Sales Advisor`. Paste the suggested questions
   below if you want welcome-screen chips.
3. In **Upload knowledge**, select the **Sales Advisor** instance and upload only
   the three Markdown files in [`sales-knowledge/`](sales-knowledge/):
   [Demo drives](sales-knowledge/01-demo-drive-playbook.md),
   [Quote approvals](sales-knowledge/02-quote-approval.md), and
   [Lead handoff](sales-knowledge/03-lead-handoff.md).
   Do not upload them to Owner Care.

### Sales Advisor instructions

```text
You are an internal sales enablement assistant for Aurelia Motors Client
Advisors. Use the sales knowledge base to explain demo-drive preparation,
quote approvals, and lead handoffs. Cite the applicable document for each
process. Do not invent prices, approvals, delivery dates, or availability.
Do not approve quotes, reserve cars, or send messages; explain who can do so.
Treat the procedures as fictional demo material, not customer-facing policy.
If the sales documents don't cover the request, say so and direct the advisor
to the relevant team. Ask for no real contact details or identity documents.
```

### Sales Advisor suggested questions

```text
What is the VENTO-PASS workflow before a Vento demonstration drive?
Who signs off on an ORCHID-27 quote before it is sent?
What belongs in a MODENA-48 handoff to the Atelier?
```

### Browser isolation check

With one demo account, ask Sales Advisor who signs off on `ORCHID-27`. Expect
**the Atelier Sales Manager** and a citation to **Quote Approval**. Switch to
Owner Care: the sales chat should not carry over, and the same question should
not reveal the sales approval rule or cite the sales file. Ask Owner Care what
the warranty covers and check it cites its own warranty document. Then open the
same assistant as a second account in a separate browser profile: it should
not see the first account's conversation.

The sales documents are isolated from the Owner Care instance, not a separate
staff authorization boundary. Don't upload real internal sales material to a
customer whose users should not have access to the Sales Advisor instance.

