"""Replay a bounded native-tool trajectory against the pinned wifi_off scenario."""

import copy
import json
import math
import os
import socketserver
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from tool_sandbox.common.execution_context import DatabaseNamespace, RoleType, new_context
from tool_sandbox.common.tool_discovery import ToolBackend
from tool_sandbox.scenarios.base_scenarios import named_base_scenarios
from tool_sandbox.scenarios.single_tool_call_scenarios import get_extensions
from tool_sandbox.tools.setting import set_wifi_status

MAX_BYTES = 32768
MAX_ACTIONS = 4
SCENARIO = next(
    item for item in get_extensions(named_base_scenarios(ToolBackend.DEFAULT))
    if item.name == "wifi_off"
).get_extended_scenario()["wifi_off"]


def grade(payload):
    if not isinstance(payload, dict) or set(payload) != {"actions", "finalMessage"}:
        raise ValueError("Invalid trajectory")
    actions, final = payload["actions"], payload["finalMessage"]
    if (not isinstance(actions, list) or len(actions) > MAX_ACTIONS
            or any(action is not None and type(action) is not bool for action in actions)
            or not isinstance(final, str) or not final.strip()):
        raise ValueError("Invalid actions or final message")

    context = copy.deepcopy(SCENARIO.starting_context)
    with new_context(context):
        failures = 0
        for action in actions:
            context.add_to_database(DatabaseNamespace.SANDBOX, [{
                "sender": RoleType.AGENT,
                "recipient": RoleType.EXECUTION_ENVIRONMENT,
                "content": "set_wifi_status",
            }])
            try:
                if action is None:
                    raise ValueError("Invalid native tool arguments")
                set_wifi_status(on=action)
                reply = "null"
            except (TypeError, ValueError, PermissionError):
                failures += 1
                reply = "Error"
            context.add_to_database(DatabaseNamespace.SANDBOX, [{
                "sender": RoleType.EXECUTION_ENVIRONMENT,
                "recipient": RoleType.AGENT,
                "content": reply,
            }])
        context.add_to_database(DatabaseNamespace.SANDBOX, [{
            "sender": RoleType.AGENT,
            "recipient": RoleType.USER,
            "content": final,
        }])
        wifi_enabled = bool(context.get_database(DatabaseNamespace.SETTING)["wifi"].item())
        score = SCENARIO.evaluation.evaluate(context, max_turn_count=SCENARIO.max_messages)

    similarity = float(score.similarity)
    return {
        "passed": not wifi_enabled and math.isclose(similarity, 1.0, abs_tol=1e-9),
        "similarity": similarity,
        "milestones": [float(item[1]) for item in score.milestone_mapping.values()],
        "wifiEnabled": wifi_enabled,
        "actions": len(actions),
        "failedActions": failures,
    }


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def do_POST(self):
        try:
            if self.path != "/grade":
                self.send_error(404)
                return
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BYTES:
                self.send_error(413)
                return
            body = json.dumps(grade(json.loads(self.rfile.read(size)))).encode()
        except (ValueError, TimeoutError):
            self.send_error(400)
            return
        except Exception:
            self.send_error(500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def main():
    if sys.argv[1:] == ["serve"]:
        path = Path("/socket/grader.sock")
        path.unlink(missing_ok=True)
        with socketserver.UnixStreamServer(str(path), Handler) as server:
            os.chmod(path, 0o660)
            server.serve_forever()
    else:
        payload = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(payload) > MAX_BYTES:
            raise ValueError("Trajectory too large")
        print(json.dumps(grade(json.loads(payload))))


if __name__ == "__main__":
    main()
