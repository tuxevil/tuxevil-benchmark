"""Offline contract tests for the structured tool-call smoke harness."""
import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("agent-tool-smoke.py")
spec = importlib.util.spec_from_file_location("agent_tool_smoke", MODULE)
assert spec is not None and spec.loader is not None
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class AgentToolSmokeTests(unittest.TestCase):
    def test_endpoint_resolution(self):
        self.assertEqual(smoke.endpoint_url("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/chat/completions")
        self.assertEqual(smoke.endpoint_url("https://host/v1"), "https://host/v1/chat/completions")
        self.assertEqual(smoke.endpoint_url("https://host/v1/chat/completions"), "https://host/v1/chat/completions")

    def test_exact_arguments(self):
        case = smoke.CASES[0]
        msg = {"tool_calls": [{"id": "call-1", "type": "function",
                               "function": {"name": "add_numbers", "arguments": '{"a":17,"b":25}'}}]}
        call, name, valid, exact = smoke.check_call(msg, case)
        self.assertEqual(call["id"], "call-1")
        self.assertTrue(name and valid and exact)

    def test_invalid_json_tool_arguments(self):
        msg = {"tool_calls": [{"id": "call-1", "type": "function",
                               "function": {"name": "add_numbers", "arguments": "{oops"}}]}
        _, name, valid, exact = smoke.check_call(msg, smoke.CASES[0])
        self.assertTrue(name)
        self.assertFalse(valid)
        self.assertFalse(exact)

    def test_missing_tool_does_not_pass(self):
        _, name, valid, exact = smoke.check_call({"content": "42"}, smoke.CASES[0])
        self.assertFalse(name or valid or exact)

    def test_aggregate(self):
        rows = [{"model": "a", "correct_tool": True, "exact_args": True,
                 "final_answer_contains_value": True, "first_request_ms": 100},
                {"model": "a", "correct_tool": True, "exact_args": False,
                 "final_answer_contains_value": False, "first_request_ms": 200}]
        result = smoke.aggregate(rows)[0]
        self.assertEqual(result["correct_tool_pct"], 100)
        self.assertEqual(result["exact_arguments_pct"], 50)
        self.assertEqual(result["successful_roundtrip_pct"], 50)
        self.assertEqual(result["median_initial_latency_ms"], 150)


if __name__ == "__main__":
    unittest.main()
