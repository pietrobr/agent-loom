import json
import unittest
from contextlib import ExitStack, nullcontext
from unittest.mock import patch

from azure.core.exceptions import AzureError
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sse_starlette.sse import AppStatus

from app.routers import admin, chat
from app import security
from app.security import Principal, get_principal
from app.services import foundry


class ConversationTests(unittest.TestCase):
    def test_customer_webapp_can_preflight_conversation_patch(self):
        from app.main import app, settings

        origins = settings.allowed_origins_list
        origin = "https://customer.example" if "*" in origins else origins[0]
        response = TestClient(app).options("/v1/chat/conversations/example?instance_id=a", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertIn("PATCH", response.headers["access-control-allow-methods"].split(", "))

    def test_owner_instance_and_legacy_mappings(self):
        stored = {"thread_id": "foundry-id", "user_id": "alice", "instance_id": "a"}
        with patch.object(chat.cosmos, "read", return_value=stored), \
             patch.object(chat.foundry, "create_thread") as create:
            self.assertEqual(chat._thread_id_for("org", "alice", "a", "id", new=False), "foundry-id")
            for user, instance in [("bob", "a"), ("alice", "b")]:
                with self.assertRaises(HTTPException) as error:
                    chat._thread_id_for("org", user, instance, "id", new=False)
                self.assertEqual(error.exception.status_code, 404)
            create.assert_not_called()
        with patch.object(chat.cosmos, "read", return_value={"thread_id": "legacy"}):
            with self.assertRaises(HTTPException):
                chat._thread_id_for("org", "alice", "a", "id", new=False)

    def test_new_mapping_is_created_with_owner(self):
        with patch.object(chat.foundry, "create_thread", return_value="foundry-id"), \
             patch.object(chat.cosmos, "create") as create:
            chat._thread_id_for("org", "alice", "a", "id", new=True)
            self.assertEqual(create.call_args.args[2]["user_id"], "alice")
            self.assertEqual(create.call_args.args[2]["instance_id"], "a")

    def test_production_token_without_subject_is_rejected(self):
        settings = security.get_settings().model_copy(update={
            "ciam_tenant_id": "tenant", "workforce_tenant_id": "",
        })
        with patch.object(security.jwks_mod, "unverified_issuer", return_value=settings.ciam_oidc_issuer), \
             patch.object(security.jwks_mod, "verify_rs256", return_value={}), \
             patch.object(security, "_resolve_customer_org", return_value="org"):
            with self.assertRaises(HTTPException) as error:
                security._verify_production("token", settings)
        self.assertEqual(error.exception.status_code, 401)


class CitationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.principal = Principal("alice", "org", [])
        app = FastAPI()
        app.include_router(chat.router)
        app.include_router(admin.router)
        app.dependency_overrides[get_principal] = lambda: self.principal
        self.stack.enter_context(patch.object(AppStatus, "should_exit_event", None))
        self.client = self.stack.enter_context(TestClient(app))
        self.stack.enter_context(patch.object(chat.cosmos, "get_tenant", return_value={}))
        self.stack.enter_context(patch.object(chat.cosmos, "get_instance", return_value={
            "template_id": "template", "foundry_agent_id": "agent", "model": "model",
        }))
        self.stack.enter_context(patch.object(chat.cosmos, "get_template", return_value={"id": "template"}))
        self.stack.enter_context(patch.object(chat, "_thread_id_for", return_value="thread"))
        self.stack.enter_context(patch.object(chat.cosmos, "log_metering"))
        self.save_turn = self.stack.enter_context(patch.object(chat.cosmos, "save_chat_turn"))
        self.stack.enter_context(patch.object(chat.tracing, "span", side_effect=lambda *a, **k: nullcontext(None)))
        self.stack.enter_context(patch.object(chat.tracing, "event"))
        self.stack.enter_context(patch.object(chat.tracing, "annotate_genai"))
        self.run = self.stack.enter_context(patch.object(chat.foundry, "stream_run", side_effect=lambda **kwargs: iter([
            ("token", "Answer [[source:1]]"), ("done", ""),
        ])))

    def sources_event(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        events = response.text.replace("\r\n", "\n").split("\n\n")
        for event in events:
            if "event: sources" in event:
                return json.loads(next(line[6:] for line in event.splitlines() if line.startswith("data: ")))
        self.fail("missing sources event")

    def test_sources_match_excerpts_sent_to_model(self):
        hits = [{"id": "chunk", "parent_id": "doc", "title": "Title",
                 "source": "upload", "content": "x" * 1300}, {"content": ""}]
        with patch.object(chat.search, "search", return_value=hits):
            data = self.sources_event(self.client.post("/v1/chat", json={"instance_id": "a", "message": "question"}))
        self.assertEqual(data["status"], "available")
        self.assertEqual(len(data["sources"]), 1)
        self.assertEqual(len(data["sources"][0]["content"]), 1200)
        knowledge = self.run.call_args.kwargs["knowledge"]
        self.assertEqual(data["sources"], knowledge)
        prompt = foundry._build_user_content("question", knowledge, {})
        self.assertIn("[[source:1]]", prompt)
        self.assertIn("x" * 1200, prompt)
        self.assertNotIn("x" * 1201, prompt)

    def test_empty_and_failed_retrieval_are_distinct(self):
        for result, status in [([], "not_found"), (RuntimeError("unavailable"), "error")]:
            with self.subTest(status=status), patch.object(
                chat.search, "search", side_effect=result if isinstance(result, Exception) else None,
                return_value=result if isinstance(result, list) else None,
            ):
                data = self.sources_event(self.client.post("/v1/chat", json={"instance_id": "a", "message": "question"}))
                self.assertEqual(data, {"status": status, "sources": []})

    def test_agentic_synthesis_without_references_falls_back_to_search(self):
        chat.cosmos.get_instance.return_value["agentic_retrieval"] = True
        with patch.object(chat.agentic, "retrieve", return_value=("synthesized", [], 10)), \
             patch.object(chat.search, "search", return_value=[]) as search:
            data = self.sources_event(self.client.post("/v1/chat", json={"instance_id": "a", "message": "question"}))
        search.assert_called_once()
        self.assertEqual(data, {"status": "not_found", "sources": []})
        self.assertEqual(self.run.call_args.kwargs["knowledge"], [])

    def test_agentic_references_are_sent_as_sources(self):
        chat.cosmos.get_instance.return_value["agentic_retrieval"] = True
        refs = [{"title": "Doc", "source": "upload", "content": "Evidence"}]
        with patch.object(chat.agentic, "retrieve", return_value=("answer", refs, 10)), \
             patch.object(chat.search, "search") as search:
            data = self.sources_event(self.client.post("/v1/chat", json={"instance_id": "a", "message": "question"}))
        search.assert_not_called()
        self.assertEqual(data["sources"][0]["content"], "Evidence")
        self.assertEqual(data["sources"], self.run.call_args.kwargs["knowledge"])

    def test_completed_turn_saves_exact_sources_before_done(self):
        hits = [{"title": "Doc", "source": "upload", "content": "Evidence"}]
        with patch.object(chat.search, "search", return_value=hits):
            response = self.client.post("/v1/chat", json={"instance_id": "a", "message": "question"})
        self.assertIn("event: done", response.text)
        org, conversation, turn = self.save_turn.call_args.args
        self.assertEqual(org, "org")
        self.assertEqual(turn["conversation_id"], conversation)
        self.assertIn(f'"turn_id": "{turn["id"]}"', response.text)
        self.assertEqual((turn["user_id"], turn["instance_id"]), ("alice", "a"))
        self.assertEqual((turn["user_text"], turn["answer"]), ("question", "Answer [[source:1]]"))
        self.assertEqual(turn["sources"], self.sources_event(response))

    def test_partial_turn_is_not_saved_and_save_failure_is_visible(self):
        with patch.object(chat.search, "search", return_value=[]):
            success = self.run.side_effect
            self.run.side_effect = lambda **kwargs: iter([("token", "partial"), ("error", "failed"), ("done", "")])
            response = self.client.post("/v1/chat", json={"instance_id": "a", "message": "question"})
            self.assertIn("event: error", response.text)
            self.save_turn.assert_not_called()
            self.run.side_effect = success
            self.save_turn.side_effect = AzureError("storage unavailable")
            response = self.client.post("/v1/chat", json={"instance_id": "a", "message": "question"})
        self.assertIn("could not be saved to chat history", response.text)
        self.assertLess(response.text.index("event: error"), response.text.index("event: done"))

    def test_history_list_binds_owner_and_instance_to_org_partition(self):
        with patch.object(chat.cosmos, "query", return_value=[]) as query:
            response = self.client.get("/v1/chat/conversations?instance_id=a")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        container, org, sql, params = query.call_args.args
        self.assertEqual((container, org), ("threads", "org"))
        self.assertIn("c.user_id = @user", sql)
        self.assertIn("c.instance_id = @instance", sql)
        self.assertEqual({p["name"]: p["value"] for p in params}, {"@user": "alice", "@instance": "a"})

    def test_history_detail_restores_sources_and_denies_foreign_conversations(self):
        thread = {"thread_id": "foundry", "user_id": "alice", "instance_id": "a", "updated_at": "today"}
        turn = {"user_text": "question", "answer": "Answer [[source:1]]", "sources": {"status": "available", "sources": []}}
        with patch.object(chat.cosmos, "read", side_effect=lambda container, org, key: thread if org == "org" else None), \
             patch.object(chat.cosmos, "query", return_value=[turn]) as query:
            path = "/v1/chat/conversations/example?instance_id="
            self.assertEqual(self.client.get(path + "a").json(), {"turns": [turn]})
            query.reset_mock()
            self.assertEqual(self.client.get(path + "b").status_code, 404)
            self.principal = Principal("bob", "org", [])
            self.assertEqual(self.client.get(path + "a").status_code, 404)
            self.principal = Principal("alice", "other-org", [])
            self.assertEqual(self.client.get(path + "a").status_code, 404)
            query.assert_not_called()

    def test_create_folder_scopes_owner_and_validates_name(self):
        with patch.object(chat.cosmos, "create") as create:
            path = "/v1/chat/folders?instance_id=a"
            self.assertEqual(self.client.post(path, json={"name": "  "}).status_code, 422)
            create.assert_not_called()
            response = self.client.post(path, json={"name": " Training  notes "})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "Training notes")
        container, org, item = create.call_args.args
        self.assertEqual((container, org, item["user_id"], item["instance_id"]), ("threads", "org", "alice", "a"))
        self.assertEqual(item["folder_id"], response.json()["folder_id"])

    def test_feedback_requires_matching_saved_answer(self):
        thread = {"thread_id": "foundry", "user_id": "alice", "instance_id": "a"}
        turn = {"conversation_id": "example", "user_id": "alice", "instance_id": "a"}
        path = "/v1/chat/conversations/example/turns/turn::saved/feedback?instance_id=a"
        with patch.object(chat.cosmos, "read", side_effect=lambda _, org, key: (
            (turn if key.startswith("turn::") else thread) if org == "org" else None
        )), patch.object(chat.cosmos, "save_chat_feedback") as save:
            for principal in (Principal("bob", "org", []), Principal("alice", "other", [])):
                self.principal = principal
                self.assertEqual(self.client.put(path, json={"rating": "down"}).status_code, 404)
            self.principal = Principal("alice", "org", [])
            turn["conversation_id"] = "other-chat"
            self.assertEqual(self.client.put(path, json={"rating": "down"}).status_code, 404)
            turn["conversation_id"] = "example"
            self.assertEqual(self.client.put(path, json={"rating": "down", "comment": "x" * 1001}).status_code, 422)
            save.assert_not_called()
            response = self.client.put(path, json={"rating": "down", "comment": " Missing detail "})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["comment"], "Missing detail")
            save.assert_called_once_with("org", "turn::saved", response.json())

    def test_admin_feedback_filters_scope_and_only_exposes_reviewed_answer(self):
        feedback = {"rating": "up", "comment": "", "submitted_at": "today"}
        sources = [{"number": 1, "content": "Cited"}, {"number": 2, "content": "Also cited"},
                   {"number": 3, "content": "Not cited"}]
        turn = {"feedback": feedback,
                "answer": "Answer (source: [1]) (FONTI : [01, 2; 9, 1]) [[source:9]] (source: [8]) `[3] (source: [3])`",
                "user_text": "private question", "sources": {"sources": sources}}
        path = "/v1/admin/customers/org/feedback"
        with patch.object(chat.cosmos, "query", return_value=[]) as query, \
             patch.object(chat.cosmos, "read", return_value=turn) as read:
            self.assertEqual(self.client.get(path).status_code, 403)
            self.assertEqual(self.client.get(path + "/turn::saved").status_code, 403)
            query.assert_not_called()
            read.assert_not_called()
            self.principal = Principal("admin", "_system", ["admin"])
            self.assertEqual(self.client.get(path + "?instance_id=a&rating=up").status_code, 200)
            self.assertEqual(query.call_args.args[:2], ("threads", "org"))
            self.assertEqual(query.call_args.args[3], [{"name": "@instance", "value": "a"}, {"name": "@rating", "value": "up"}])
            self.assertEqual(self.client.get(path + "/turn::saved").json(), {
                "answer": "Answer [1] [1] [2] [unverified citation] [unverified citation] (source: [8]) `[3] (source: [3])`",
                "feedback": feedback, "sources": sources[:2],
            })
            read.assert_called_once_with("threads", "org", "turn::saved")

    def test_pin_rename_and_move_require_owned_folder_and_chat(self):
        folder_id = "d15b268f-93f6-4b6a-9c2c-c80fbdce15a2"
        thread = {"thread_id": "foundry", "user_id": "alice", "instance_id": "a", "updated_at": "today"}
        folder = {"user_id": "bob", "instance_id": "a"}
        path = "/v1/chat/conversations/example?instance_id=a"
        changes = {"title": "Training", "pinned": True, "folder_id": folder_id}
        with patch.object(chat.cosmos, "read", side_effect=lambda _, org, key: (
            (folder if key.startswith("folder::") else thread) if org == "org" else None
        )), patch.object(chat.cosmos, "update_chat_metadata") as update:
            self.assertEqual(self.client.patch(path, json=changes).status_code, 404)
            folder["user_id"], folder["instance_id"] = "alice", "b"
            self.assertEqual(self.client.patch(path, json=changes).status_code, 404)
            self.principal = Principal("alice", "other-org", [])
            self.assertEqual(self.client.patch(path, json={"pinned": True}).status_code, 404)
            update.assert_not_called()
            self.principal = Principal("alice", "org", [])
            folder["instance_id"] = "a"
            self.assertEqual(self.client.patch(path, json=changes).status_code, 204)
            update.assert_called_once_with("org", "example", changes)
            self.assertEqual(self.client.patch(path, json={"folder_id": None, "pinned": False}).status_code, 204)
            update.assert_called_with("org", "example", {"folder_id": None, "pinned": False})


if __name__ == "__main__":
    unittest.main()
