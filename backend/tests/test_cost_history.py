import copy
import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import patch

from azure.cosmos import exceptions
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.models import SYSTEM_ORG
from app.routers import admin
from app.security import Principal, get_principal
from app.services import cosmos, pricing, search


class MemoryContainer:
    def __init__(self, rows=()):
        self.rows = {(row["org_id"], row["id"]): copy.deepcopy(row) for row in rows}
        self.batches = []
        self.fail_batch = None

    def read_item(self, item, partition_key):
        row = self.rows.get((partition_key, item))
        if row is None:
            raise exceptions.CosmosResourceNotFoundError(status_code=404)
        return copy.deepcopy(row)

    def read_all_items(self):
        return copy.deepcopy(list(self.rows.values()))

    def query_items(self, query, parameters, partition_key):
        rows = [row for (org, _), row in self.rows.items() if org == partition_key]
        if query == "SELECT c.id FROM c":
            return [{"id": row["id"]} for row in rows]
        return copy.deepcopy(rows)

    def execute_item_batch(self, batch_operations, partition_key):
        self.batches.append((partition_key, batch_operations))
        if len(self.batches) == self.fail_batch:
            raise exceptions.CosmosHttpResponseError(status_code=503, message="unavailable")
        for operation, arguments in batch_operations:
            if operation != "delete" or (partition_key, arguments[0]) not in self.rows:
                raise AssertionError("invalid partition-scoped delete")
        for _, arguments in batch_operations:
            del self.rows[(partition_key, arguments[0])]
        return [{} for _ in batch_operations]


class FixedDate(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 11, 6, 7, 0, tzinfo=timezone.utc)


class CostHistoryTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.containers = {
            name: MemoryContainer() for name in ("metering", "tenants", "instances", "traces")
        }
        self.stack.enter_context(patch.object(cosmos, "_container", side_effect=self.containers.__getitem__))
        self.stack.enter_context(patch.object(cosmos, "datetime", FixedDate))
        self.stack.enter_context(patch.object(cosmos, "get_infra_config", return_value={}))
        self.stack.enter_context(patch.object(search, "document_count", return_value=0))
        self.stack.enter_context(patch.object(pricing, "shared_infrastructure", return_value={"ai_search": 100.0}))
        self.stack.enter_context(patch.object(pricing, "token_cost", return_value=1.0))
        self.stack.enter_context(patch.object(pricing, "embedding_cost", return_value=0.25))
        self.trace_event = self.stack.enter_context(patch.object(admin.tracing, "event"))
        self.app = FastAPI()
        self.app.include_router(admin.router)
        self.app.add_middleware(CORSMiddleware, allow_origins=["https://admin.example"])
        self.app.dependency_overrides[get_principal] = lambda: Principal("admin", SYSTEM_ORG, ["admin"])
        self.client = TestClient(self.app)

    def add(self, container, row):
        self.containers[container].rows[(row["org_id"], row["id"])] = copy.deepcopy(row)

    def add_history(self, org_id="deleted"):
        self.add("metering", {
            "id": cosmos._LIFECYCLE_ID, "kind": cosmos._LIFECYCLE_ID, "org_id": org_id,
            "name": org_id, "periods": [{
                "start": "2026-10-01T00:00:00Z", "end": "2026-11-03T00:00:00Z",
            }],
        })
        for item_id, kind, ts in (
            ("chat-oct", "chat", "2026-10-05T00:00:00Z"),
            ("chat-nov", "chat", "2026-11-02T00:00:00Z"),
            ("embedding", "embedding", "2026-10-05T00:00:00Z"),
            ("agentic", "agentic", "2026-10-05T00:00:00Z"),
        ):
            self.add("metering", {
                "id": item_id, "org_id": org_id, "kind": kind, "ts": ts,
                "input_tokens": 10, "total_tokens": 10,
            })

    def purge(self, org_id="deleted"):
        return self.client.delete(
            f"/v1/admin/costs/{org_id}", headers={"Origin": "https://admin.example"}
        )

    def test_removes_all_months_and_metering_but_preserves_traces_and_other_customers(self):
        self.add_history()
        self.add_history("other")
        self.add("traces", {"id": "trace", "org_id": "deleted", "method": "POST"})
        traces_before = copy.deepcopy(self.containers["traces"].rows)
        other_before = {key: row for key, row in self.containers["metering"].rows.items() if key[0] == "other"}
        result = self.purge()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {"status": "deleted", "org_id": "deleted", "deleted_records": 5})
        self.assertEqual(cosmos.metering_summary("deleted")["calls"], 0)
        self.assertEqual(cosmos.get_lifecycle("deleted"), None)
        self.assertEqual(self.containers["traces"].rows, traces_before)
        self.assertEqual(self.containers["metering"].rows, other_before)
        self.assertEqual(
            {client["org_id"] for month in cosmos.cost_summary()["by_month"] for client in month["clients"]},
            {"other"},
        )
        self.trace_event.assert_called_once_with(
            "Customer cost and metering history deleted", org_id="deleted", deleted_records=5
        )

    def test_deleted_status_is_based_on_tenant_existence_not_suspension(self):
        for org in ("deleted", "active", "suspended"):
            self.add_history(org)
        for org, enabled in (("active", True), ("suspended", False)):
            self.add("tenants", {"id": org, "org_id": org, "name": org, "enabled": enabled})
        for month in cosmos.cost_summary()["by_month"]:
            flags = {client["org_id"]: client["is_deleted"] for client in month["clients"]}
            self.assertEqual(flags, {"deleted": True, "active": False, "suspended": False})

    def test_existing_and_suspended_customers_cannot_be_purged(self):
        self.add_history()
        before = copy.deepcopy(self.containers["metering"].rows)
        for enabled in (True, False):
            self.add("tenants", {"id": "deleted", "org_id": "deleted", "enabled": enabled})
            self.assertEqual(self.purge().status_code, 409)
            self.assertEqual(self.containers["metering"].rows, before)
        self.assertEqual(self.containers["metering"].batches, [])

    def test_remaining_instances_block_purge(self):
        self.add_history()
        self.add("instances", {"id": "instance", "org_id": "deleted"})
        self.assertEqual(self.purge().status_code, 409)
        self.assertEqual(self.containers["metering"].batches, [])

    def test_system_partition_is_protected(self):
        self.add_history(SYSTEM_ORG)
        self.assertEqual(self.purge(SYSTEM_ORG).status_code, 400)
        self.assertEqual(self.containers["metering"].batches, [])

    def test_missing_history_returns_explicit_not_found(self):
        self.assertEqual(self.purge().status_code, 404)
        self.trace_event.assert_not_called()

    def test_admin_role_is_required(self):
        self.add_history()
        self.app.dependency_overrides[get_principal] = lambda: Principal("user", "deleted", [])
        self.assertEqual(self.purge().status_code, 403)
        self.assertEqual(self.containers["metering"].batches, [])

    def test_last_customer_removes_all_cost_months(self):
        self.add_history()
        self.assertEqual(len(cosmos.cost_summary()["by_month"]), 2)
        self.assertEqual(self.purge().status_code, 200)
        summary = cosmos.cost_summary()
        self.assertEqual(summary["by_month"], [])
        self.assertEqual(summary["total_cost"], 0)
        self.assertEqual(summary["infra_monthly"], 100)

    def test_remaining_customer_shares_and_totals_are_recalculated(self):
        self.add_history()
        self.add_history("other")
        before = cosmos.cost_summary()["by_month"][1]
        self.assertEqual(before["total_cost"], 104.5)
        self.assertEqual(before["clients"][0]["infra_cost"], 50.0)
        self.assertEqual(self.purge().status_code, 200)
        after = cosmos.cost_summary()["by_month"][1]
        self.assertEqual(after["total_cost"], 102.25)
        self.assertEqual(after["clients"][0]["org_id"], "other")
        self.assertEqual(after["clients"][0]["infra_cost"], 100.0)
        self.assertEqual(after["clients"][0]["infra_weight"], 1.0)

    def test_batch_limit_and_lifecycle_last(self):
        self.add_history()
        for i in range(200):
            self.add("metering", {"id": f"event-{i}", "org_id": "deleted"})
        self.assertEqual(self.purge().json()["deleted_records"], 205)
        batches = self.containers["metering"].batches
        self.assertEqual([len(operations) for _, operations in batches], [100, 100, 5])
        self.assertTrue(all(org == "deleted" for org, _ in batches))
        self.assertEqual(batches[-1][1][-1], ("delete", (cosmos._LIFECYCLE_ID,)))

    def test_partial_batch_failure_is_visible_and_retry_removes_remaining_history(self):
        self.add_history()
        for i in range(100):
            self.add("metering", {"id": f"event-{i}", "org_id": "deleted"})
        self.containers["metering"].fail_batch = 2
        with self.assertLogs(admin.log, level="ERROR"):
            result = self.purge()
        self.assertEqual(result.status_code, 503)
        self.assertIn("Some records may already", result.json()["detail"])
        self.assertEqual(result.headers["access-control-allow-origin"], "https://admin.example")
        self.assertIsNotNone(cosmos.get_lifecycle("deleted"))
        self.trace_event.assert_not_called()
        self.containers["metering"].fail_batch = None
        self.assertEqual(self.purge().json()["deleted_records"], 5)
        self.assertEqual(self.containers["metering"].rows, {})

    def test_guard_read_failure_is_reported_without_deletion(self):
        with patch.object(cosmos, "get_tenant", side_effect=exceptions.CosmosHttpResponseError(status_code=503)), \
             self.assertLogs(admin.log, level="ERROR"):
            self.assertEqual(self.purge().status_code, 503)
        self.assertEqual(self.containers["metering"].batches, [])


if __name__ == "__main__":
    unittest.main()
