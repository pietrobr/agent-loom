import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

import httpx
from azure.core.exceptions import HttpResponseError
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.routers import admin
from app.security import Principal, require_admin
from app.services import agentic


class CustomerDeletionTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.calls = Mock()
        targets = {
            "tenant": (admin.cosmos, "get_tenant"),
            "instances": (admin.cosmos, "list_instances"),
            "agentic": (admin.agentic, "delete_resources"),
            "index": (admin.search, "delete_index"),
            "group": (admin.ciam_groups, "delete_group"),
            "lifecycle": (admin.cosmos, "record_lifecycle"),
            "delete": (admin.cosmos, "delete"),
        }
        for name, (module, attribute) in targets.items():
            mock = self.stack.enter_context(patch.object(module, attribute))
            self.calls.attach_mock(mock, name)
        self.calls.tenant.return_value = {"org_id": "test", "name": "Test", "group_id": "group"}
        self.calls.instances.return_value = []
        app = FastAPI()
        app.include_router(admin.router)
        app.add_middleware(CORSMiddleware, allow_origins=["https://admin.example"])
        app.dependency_overrides[require_admin] = lambda: Principal("admin", "_system", ["admin"])
        self.client = TestClient(app)

    def delete(self):
        return self.client.delete(
            "/v1/admin/customers/test", headers={"Origin": "https://admin.example"}
        )

    def test_resources_are_removed_before_index_and_tenant(self):
        response = self.delete()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "deleted", "org_id": "test"})
        names = [call[0] for call in self.calls.mock_calls]
        self.assertLess(names.index("agentic"), names.index("index"))
        self.assertLess(names.index("index"), names.index("group"))
        self.assertLess(names.index("group"), names.index("lifecycle"))
        self.assertLess(names.index("lifecycle"), names.index("delete"))

    def test_attached_instances_block_all_cleanup(self):
        self.calls.instances.return_value = [{"id": "instance"}]
        self.assertEqual(self.delete().status_code, 409)
        self.calls.agentic.assert_not_called()
        self.calls.index.assert_not_called()
        self.calls.delete.assert_not_called()

    def test_unknown_customer_blocks_all_cleanup(self):
        self.calls.tenant.return_value = None
        self.assertEqual(self.delete().status_code, 404)
        self.calls.agentic.assert_not_called()
        self.calls.index.assert_not_called()

    def test_agentic_error_is_visible_and_stops_cleanup(self):
        request = httpx.Request("DELETE", "https://search.example/knowledgebases/test")
        response = httpx.Response(409, request=request)
        self.calls.agentic.side_effect = httpx.HTTPStatusError(
            "resource still referenced", request=request, response=response
        )
        result = self.delete()
        self.assertEqual(result.status_code, 502)
        self.assertEqual(result.headers["access-control-allow-origin"], "https://admin.example")
        self.calls.index.assert_not_called()
        self.calls.delete.assert_not_called()
        self.calls.lifecycle.assert_not_called()

    def test_index_error_is_visible_and_keeps_customer(self):
        self.calls.index.side_effect = HttpResponseError("index still referenced")
        self.assertEqual(self.delete().status_code, 502)
        self.calls.group.assert_not_called()
        self.calls.lifecycle.assert_not_called()
        self.calls.delete.assert_not_called()


class AgenticDeletionTests(unittest.TestCase):
    def run_delete(self, statuses):
        paths = []

        def handle(request):
            paths.append(request.url.path)
            return httpx.Response(statuses[len(paths) - 1], request=request)

        client = httpx.Client(transport=httpx.MockTransport(handle))
        with patch.object(agentic.httpx, "Client", return_value=client), \
             patch.object(agentic, "_headers", return_value={}), \
             patch.object(agentic, "_base", return_value="https://search.example"):
            agentic.delete_resources("test")
        return paths

    def test_base_is_removed_before_source(self):
        self.assertEqual(
            self.run_delete([204, 204]),
            ["/knowledgebases/kbagent-test", "/knowledgesources/ks-test"],
        )

    def test_missing_resources_allow_retry(self):
        self.assertEqual(len(self.run_delete([404, 404])), 2)

    def test_failed_base_deletion_stops_source_deletion(self):
        with self.assertRaises(httpx.HTTPStatusError):
            self.run_delete([409])

    def test_failed_source_deletion_is_not_ignored(self):
        with self.assertRaises(httpx.HTTPStatusError):
            self.run_delete([204, 403])

    def test_transport_error_is_not_ignored(self):
        def unavailable(request):
            raise httpx.ConnectError("unavailable", request=request)

        client = httpx.Client(transport=httpx.MockTransport(unavailable))
        with patch.object(agentic.httpx, "Client", return_value=client), \
             patch.object(agentic, "_headers", return_value={}), \
             patch.object(agentic, "_base", return_value="https://search.example"), \
             self.assertRaises(httpx.ConnectError):
            agentic.delete_resources("test")


if __name__ == "__main__":
    unittest.main()
