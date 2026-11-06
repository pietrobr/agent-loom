import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import SYSTEM_ORG
from app.routers import admin
from app.security import Principal, get_principal
from app.services import cosmos
from test_cost_history import FixedDate, MemoryContainer


class MeteringQuotaTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.containers = {
            "metering": MemoryContainer(),
            "tenants": MemoryContainer([{
                "id": "customer", "org_id": "customer", "monthly_token_quota": 1000,
            }]),
        }
        self.stack.enter_context(patch.object(cosmos, "_container", side_effect=self.containers.__getitem__))
        self.stack.enter_context(patch.object(cosmos, "datetime", FixedDate))
        self.app = FastAPI()
        self.app.include_router(admin.router)
        self.app.dependency_overrides[get_principal] = lambda: Principal("admin", SYSTEM_ORG, ["admin"])
        self.client = TestClient(self.app)

    def add(self, item_id, tokens, **fields):
        row = {"id": item_id, "org_id": "customer", "instance_id": "instance",
               "total_tokens": tokens, **fields}
        self.containers["metering"].rows[("customer", item_id)] = row

    def metering(self):
        response = self.client.get("/v1/admin/customers/customer/metering")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_uses_current_month_chat_only_and_preserves_all_time_totals(self):
        self.add("previous", 2000, ts="2026-10-31T23:59:59Z")
        self.add("current", 300, ts="2026-11-01T00:00:00Z")
        self.add("current-ts", 200, _ts=int(datetime(2026, 11, 2, tzinfo=timezone.utc).timestamp()))
        self.add("future", 4000, ts="2026-12-01T00:00:00Z")
        self.add("embeddings", 50000, kind="embedding", ts="2026-11-02T00:00:00Z")
        self.add("agentic", 50000, kind="agentic", ts="2026-11-02T00:00:00Z")
        self.add(cosmos._LIFECYCLE_ID, 50000, kind=cosmos._LIFECYCLE_ID, ts="2026-11-02T00:00:00Z")
        result = self.metering()
        self.assertEqual(result["month"], "2026-11")
        self.assertEqual(result["month_tokens"], 500)
        self.assertEqual(result["monthly_token_quota"], 1000)
        self.assertEqual(result["remaining_tokens"], 500)
        self.assertEqual(result["calls"], 4)
        self.assertEqual(result["total_tokens"], 6500)
        self.assertEqual(result["month_tokens"], cosmos.month_token_usage("customer"))

    def test_empty_month_keeps_full_quota(self):
        self.add("previous", 5000, ts="2026-10-01T00:00:00Z")
        self.assertEqual(self.metering()["month_tokens"], 0)
        self.assertEqual(self.metering()["remaining_tokens"], 1000)

    def test_reached_or_exceeded_quota_has_zero_remaining(self):
        for used in (1000, 1250):
            self.add("current", used, ts="2026-11-01T00:00:00Z")
            result = self.metering()
            self.assertEqual(result["remaining_tokens"], 0)
            self.assertEqual(result["month_tokens"], used)

    def test_zero_and_negative_quotas_are_unlimited(self):
        self.add("current", 2500, ts="2026-11-01T00:00:00Z")
        for quota in (0, -1):
            self.containers["tenants"].rows[("customer", "customer")]["monthly_token_quota"] = quota
            result = self.metering()
            self.assertEqual(result["monthly_token_quota"], quota)
            self.assertIsNone(result["remaining_tokens"])
            self.assertEqual(result["month_tokens"], 2500)

    def test_quota_edits_are_reflected(self):
        self.add("current", 800, ts="2026-11-01T00:00:00Z")
        self.assertEqual(self.metering()["remaining_tokens"], 200)
        self.containers["tenants"].rows[("customer", "customer")]["monthly_token_quota"] = 500
        self.assertEqual(self.metering()["remaining_tokens"], 0)

    def test_month_rollover_resets_usage(self):
        self.add("november", 900, ts="2026-11-30T23:59:59Z")

        class DecemberDate(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 12, 1, tzinfo=timezone.utc)

        with patch.object(cosmos, "datetime", DecemberDate):
            result = self.metering()
        self.assertEqual(result["month"], "2026-12")
        self.assertEqual(result["month_tokens"], 0)
        self.assertEqual(result["remaining_tokens"], 1000)

    def test_month_is_captured_once_for_label_and_count(self):
        self.add("current", 500, ts="2026-11-01T00:00:00Z")
        with patch.object(cosmos, "datetime") as clock:
            clock.now.side_effect = [
                datetime(2026, 11, 30, 23, 59, 59, tzinfo=timezone.utc),
                datetime(2026, 12, 1, tzinfo=timezone.utc),
            ]
            result = self.metering()
        self.assertEqual(clock.now.call_count, 1)
        self.assertEqual(result["month"], "2026-11")
        self.assertEqual(result["month_tokens"], 500)

    def test_unknown_customer_is_not_found(self):
        self.containers["tenants"].rows.clear()
        self.assertEqual(self.client.get("/v1/admin/customers/customer/metering").status_code, 404)


if __name__ == "__main__":
    unittest.main()
