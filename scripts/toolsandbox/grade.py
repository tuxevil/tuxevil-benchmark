"""Execute and grade bounded trajectories against pinned ToolSandbox scenarios."""

import copy
import datetime
import json
import math
import os
import socketserver
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import NAMESPACE_URL, uuid5

from polars.exceptions import DuplicateError

from tool_sandbox.common.execution_context import DatabaseNamespace, RoleType, new_context
from tool_sandbox.common.tool_discovery import ToolBackend
from tool_sandbox.scenarios import base_scenarios, multiple_tool_call_scenarios
from tool_sandbox.scenarios.base_scenarios import named_base_scenarios
from tool_sandbox.scenarios.single_tool_call_scenarios import get_extensions
from tool_sandbox.tools import contact, reminder, utilities
from tool_sandbox.tools.setting import set_wifi_status

MAX_BYTES = 32768
MAX_ACTIONS = 4
SCENARIO = next(
    item for item in get_extensions(named_base_scenarios(ToolBackend.DEFAULT))
    if item.name == "wifi_off"
).get_extended_scenario()["wifi_off"]


def grade_wifi(payload):
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


CONTACT_CASE = "add_contact_with_name_and_phone_number"
REMINDER_CASE = "add_reminder_content_and_date_and_time"
CONTACT_TOOLS = {"add_contact": contact.add_contact}
REMINDER_TOOLS = {
    "add_reminder": reminder.add_reminder,
    "datetime_info_to_timestamp": utilities.datetime_info_to_timestamp,
}
INVALID_TOOL = {"error": "INVALID_TOOL_CALL"}


class FrozenDatetime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        instant = cls(2024, 3, 20, 12, tzinfo=datetime.timezone.utc)
        return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)


def load_state_scenarios():
    clock = SimpleNamespace(datetime=FrozenDatetime, timedelta=datetime.timedelta)
    with patch.object(base_scenarios, "datetime", clock):
        base = named_base_scenarios(ToolBackend.DEFAULT)
    return {
        CONTACT_CASE: (
            next(item for item in get_extensions(base) if item.name == CONTACT_CASE)
            .get_extended_scenario()[CONTACT_CASE],
            DatabaseNamespace.CONTACT,
            CONTACT_TOOLS,
            0,
        ),
        REMINDER_CASE: (
            next(item for item in multiple_tool_call_scenarios.get_extensions(base)
                 if item.name == REMINDER_CASE).get_extended_scenario()[REMINDER_CASE],
            DatabaseNamespace.REMINDER,
            REMINDER_TOOLS,
            1,
        ),
    }


STATE_CASES = load_state_scenarios()
NUMERIC = (int, float)
TOOL_FIELDS = {
    "add_contact": (
        {"name": (str,), "phone_number": (str,)},
        {"relationship": (str, type(None)), "is_self": (bool,)},
    ),
    "datetime_info_to_timestamp": (
        {key: (int,) for key in ("year", "month", "day", "hour", "minute", "second")},
        {},
    ),
    "add_reminder": (
        {"content": (str,), "reminder_timestamp": NUMERIC},
        {"latitude": (*NUMERIC, type(None)), "longitude": (*NUMERIC, type(None))},
    ),
}


def call_state_tool(case_id, tools, action, index):
    name, args = action["name"], action["args"]
    if name not in tools or not isinstance(args, dict):
        return INVALID_TOOL
    required, optional = TOOL_FIELDS[name]
    fields = required | optional
    if not required.keys() <= args.keys() <= fields.keys():
        return INVALID_TOOL
    if any(type(value) not in fields[key] or (type(value) is float and not math.isfinite(value))
           for key, value in args.items()):
        return INVALID_TOOL

    identifier = uuid5(NAMESPACE_URL, f"tuxevil/ToolSandbox/v1/{case_id}/{index}")
    try:
        if name == "add_contact":
            with patch.object(contact, "uuid4", return_value=identifier):
                return tools[name](**args)
        if name == "add_reminder":
            with patch.object(reminder, "uuid4", return_value=identifier), patch.object(
                reminder, "datetime", SimpleNamespace(datetime=FrozenDatetime)
            ):
                return tools[name](**args)
        return tools[name](**args)
    except (TypeError, ValueError, PermissionError, OverflowError, DuplicateError):
        return INVALID_TOOL


def replay_state(payload, grading):
    expected = {"caseId", "actions", "feedback", "finalMessage"} if grading else {"caseId", "actions"}
    if not isinstance(payload, dict) or set(payload) != expected:
        raise ValueError("Invalid trajectory")
    case_id, actions = payload["caseId"], payload["actions"]
    if (not isinstance(case_id, str) or case_id not in STATE_CASES
            or not isinstance(actions, list) or len(actions) > MAX_ACTIONS
            or any(not isinstance(action, dict) or set(action) != {"name", "args"}
                   or not isinstance(action["name"], str) for action in actions)):
        raise ValueError("Invalid scenario or actions")
    if grading:
        final, feedback = payload["finalMessage"], payload["feedback"]
        if (not isinstance(final, str) or not final.strip()
                or not isinstance(feedback, list) or len(feedback) != len(actions)
                or any(not isinstance(reply, str) for reply in feedback)):
            raise ValueError("Invalid final message or feedback")
    elif not actions:
        raise ValueError("A step requires an action")

    scenario, namespace, tools, state_milestone = STATE_CASES[case_id]
    context = copy.deepcopy(scenario.starting_context)
    context.trace_tool = False
    failures = 0
    with new_context(context):
        initial_rows = context.get_database(namespace).height
        for index, action in enumerate(actions):
            name = action["name"]
            context.add_to_database(DatabaseNamespace.SANDBOX, [{
                "sender": RoleType.AGENT,
                "recipient": RoleType.EXECUTION_ENVIRONMENT,
                "content": name,
            }])
            result = call_state_tool(case_id, tools, action, index)
            trace = None
            if result == INVALID_TOOL:
                failures += 1
            else:
                trace = [json.dumps({"tool_name": name, "arguments": action["args"], "result": result})]
            context.add_to_database(DatabaseNamespace.SANDBOX, [{
                "sender": RoleType.EXECUTION_ENVIRONMENT,
                "recipient": RoleType.AGENT,
                "content": json.dumps(result),
                "tool_trace": trace,
            }])
            if grading and json.loads(feedback[index]) != result:
                raise ValueError("Stored feedback differs from replay")

        if not grading:
            return {"result": result}
        context.add_to_database(DatabaseNamespace.SANDBOX, [{
            "sender": RoleType.AGENT,
            "recipient": RoleType.USER,
            "content": final,
        }])
        evaluation = scenario.evaluation.evaluate(context, max_turn_count=scenario.max_messages)
        added_rows = context.get_database(namespace).height - initial_rows

    similarity = float(evaluation.similarity)
    milestones = [float(evaluation.milestone_mapping.get(i, (0, 0))[1]) for i in range(2)]
    state_reached = added_rows == 1 and math.isclose(milestones[state_milestone], 1.0, abs_tol=1e-9)
    return {
        "passed": state_reached and math.isclose(similarity, 1.0, abs_tol=1e-9),
        "stateGoalReached": state_reached,
        "similarity": similarity,
        "milestones": milestones,
        "actions": len(actions),
        "failedActions": failures,
    }


def grade(payload):
    if isinstance(payload, dict) and "caseId" in payload:
        return replay_state(payload, grading=True)
    return grade_wifi(payload)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def do_POST(self):
        try:
            if self.path not in ("/step", "/grade"):
                self.send_error(404)
                return
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BYTES:
                self.send_error(413)
                return
            payload = json.loads(self.rfile.read(size))
            result = grade(payload) if self.path == "/grade" else replay_state(payload, grading=False)
            body = json.dumps(result).encode()
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
        data = json.loads(payload)
        result = replay_state(data, grading=False) if sys.argv[1:] == ["step"] else grade(data)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
