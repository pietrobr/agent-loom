"""Single source of truth for the built-in **demo customers**.

This module is intentionally dependency-free (standard library only — no Azure
SDKs, no backend imports) so it can be imported by both:

  * ``seed_customers.py``  — direct Cosmos seeding (used from inside the VNet), and
  * ``seed_via_api.py``    — seeding over the backend REST API (used by the
                             post-provision hook, since Cosmos is private).

Each customer's knowledge lives under ``sample-customers/<org_id>/knowledge/*.md``
(the same folder used for manual onboarding), so there is a single source of
truth for each customer's content.
"""
from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SAMPLES_DIR = REPO / "sample-customers"


CUSTOMERS = [
    {
        "org_id": "horizon-travel",
        "name": "Horizon Travel",
        "tier": "pro",
        "monthly_token_quota": 5_000_000,
        "branding": {
            "product_name": "Horizon Travel Concierge",
            "primary_color": "#0E7C86",
            "logo_url": "/logo.svg",
            "tagline": "Your journey, our care.",
        },
        "template_id": "customer-care-assistant",
        "instance_display": "Horizon Customer Care",
        "instructions_addendum": (
            "You represent Horizon Travel, a premium travel agency. "
            "Booking changes are free up to 14 days before departure. "
            "Always offer to escalate complex refund cases to a human agent."
        ),
        "suggested_questions": [
            "How do I change my booking?",
            "What is your refund policy?",
            "How do I add baggage to my reservation?",
        ],
    },
    {
        "org_id": "novatech",
        "name": "NovaTech Solutions",
        "tier": "starter",
        "monthly_token_quota": 1_000_000,
        "branding": {
            "product_name": "NovaTech Helpdesk",
            "primary_color": "#7C3AED",
            "logo_url": "/logo.svg",
            "tagline": "Always-on IT support.",
        },
        "template_id": "knowledge-faq-assistant",
        "instance_display": "NovaTech Helpdesk Bot",
        "instructions_addendum": (
            "You are the NovaTech Solutions helpdesk assistant. NovaTech sells "
            "managed IT services to small and medium businesses. Quote SLAs and "
            "contract terms VERBATIM from the knowledge base."
        ),
        "suggested_questions": [
            "What is the standard support SLA?",
            "What does the premium support tier include?",
            "What is included in a support contract?",
        ],
    },
    {
        "org_id": "meridian-hr",
        "name": "Meridian Industries — HR Office",
        "tier": "pro",
        "monthly_token_quota": 5_000_000,
        "branding": {
            "product_name": "Meridian Talent Screener",
            "primary_color": "#1F6FEB",
            "logo_url": "/logo.svg",
            "tagline": "Fair, fast candidate screening.",
        },
        "template_id": "cv-evaluation-assistant",
        "instance_display": "Meridian CV Screener",
        "instructions_addendum": (
            "You support the HR office of Meridian Industries, a mid-size "
            "engineering company. Screen candidate CVs strictly against the "
            "current evaluation rules in the knowledge base, which HR updates "
            "from time to time. When a mandatory requirement is unmet, the "
            "recommendation must be Reject regardless of the overall score."
        ),
        "suggested_questions": [
            "What are our current CV evaluation criteria?",
            "Evaluate the CV of Marco Bianchi for the Backend Engineer role.",
            "Evaluate the CV of Sara Conti for the Backend Engineer role.",
        ],
    },
]


def load_knowledge_dir(org_id: str) -> list[dict]:
    """Read a demo customer's knowledge .md files into upload-ready docs.

    Each file becomes one document: the first non-empty line is the title and
    the whole file is the content. Files are sorted by name (use a NN- prefix
    to control order). Returns [] if the folder is missing.
    """
    kdir = SAMPLES_DIR / org_id / "knowledge"
    if not kdir.is_dir():
        print(f"  !! no knowledge folder for {org_id} at {kdir}")
        return []
    docs: list[dict] = []
    for path in sorted(kdir.glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            continue
        title = next((ln.strip() for ln in text.splitlines() if ln.strip()), path.stem)
        docs.append({"title": title, "source": f"{org_id} knowledge", "content": text})
    return docs
