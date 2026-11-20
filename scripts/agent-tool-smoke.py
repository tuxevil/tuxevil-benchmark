#!/usr/bin/env python3
"""Deterministic tool-calling smoke test for OpenAI-compatible local models.

Complements the text-only tuxevil-benchmark quality evaluator. It does NOT run
arbitrary tools: it synthesizes two safe fixtures and sends results back to the
model. Endpoint requests are sequential; use Agent Headroom for concurrency.

Requires Python 3.10+. Never prints, stores or transmits an API key in results.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOOLS = {
    "add_numbers": {
        "type": "function",
        "function": {
            "name": "add_numbers",
            "description": "Suma dos números enteros y devuelve el total; úsala cuando se solicite una suma.",
            "parameters": {
                "type": "object",
                "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
                "required": ["a", "b"],
                "additionalProperties": False,
            },
        },
    },
    "read_sensor": {
        "type": "function",
        "function": {
            "name": "read_sensor",
            "description": "Consulta un sensor de Home Assistant por su ID.",
            "parameters": {
                "type": "object",
                "properties": {"sensor_id": {"type": "string"}},
                "required": ["sensor_id"],
                "additionalProperties": False,
            },
        },
    },
}

CASES = [
    {
        "id": "calculator-es",
        "prompt": "Usa la función add_numbers para sumar 17 y 25. Responde con el número devuelto por la función.",
        "tool": "add_numbers",
        "args": {"a": 17, "b": 25},
        "tool_result": {"sum": 42},
        "expected_fragment": "42",
    },
    {
        "id": "battery-soc-es",
        "prompt": "Consulta el estado de carga de la batería mediante read_sensor con ID battery_soc. Después indica el porcentaje que devolvió.",
        "tool": "read_sensor",
        "args": {"sensor_id": "battery_soc"},
        "tool_result": {"sensor_id": "battery_soc", "value": 67, "unit": "%"},
        "expected_fragment": "67",
    },
]


def endpoint_url(base: str) -> str:
    url = base.rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise ValueError("Use a full HTTP(S) URL")
    return url if url.endswith("/chat/completions") else url + ("/chat/completions" if url.endswith("/v1") else "/v1/chat/completions")


def chat(url: str, api_key: str | None, payload: dict, timeout: float) -> tuple[dict, float]:
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = "Bearer " + api_key
    request = urllib.request.Request(
        url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST"
    )
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    return body, duration_ms


def extract_message(response: dict) -> dict:
    choices = response.get("choices") or []
    if not choices or not isinstance(choices[0].get("message"), dict):
        raise ValueError("Missing choices[0].message")
    return choices[0]["message"]


def check_call(message: dict, case: dict) -> tuple[dict | None, bool, bool, bool]:
    calls = message.get("tool_calls")
    if not isinstance(calls, list) or not calls:
        return None, False, False, False
    for call in calls:
        f = call.get("function") if isinstance(call, dict) else None
        if not isinstance(f, dict) or f.get("name") != case["tool"]:
            continue
        try:
            args = json.loads(f.get("arguments") or "{}")
        except (json.JSONDecodeError, TypeError):
            return call, True, False, False
        if not isinstance(args, dict):
            return call, True, False, False
        exact_match = args == case["args"]
        return call, True, True, exact_match
    return calls[0], False, False, False


def run_case(url: str, model: str, case: dict, api_key: str | None, timeout: float, max_tokens: int) -> dict:
    messages = [
        {"role": "system", "content": "Eres el backend de un agente. Cuando una herramienta sea necesaria, llama la función; no inventes resultados."},
        {"role": "user", "content": case["prompt"]},
    ]
    first_req = {
        "model": model,
        "messages": messages,
        "tools": [TOOLS[case["tool"]]],
        "tool_choice": "auto",
        "temperature": 0,
        "max_tokens": max_tokens,
        "stream": False,
    }
    record = {
        "model": model,
        "case": case["id"],
        "tool_called": False,
        "correct_tool": False,
        "valid_json_args": False,
        "exact_args": False,
        "tool_roundtrip": False,
        "final_answer_contains_value": False,
        "first_request_ms": None,
        "second_request_ms": None,
        "failure": None,
    }
    try:
        first, t1 = chat(url, api_key, first_req, timeout)
        record["first_request_ms"] = t1
        msg = extract_message(first)
        call, found_tool, valid_json, exact_args = check_call(msg, case)
        record["tool_called"] = bool(msg.get("tool_calls"))
        record["correct_tool"] = found_tool
        record["valid_json_args"] = valid_json
        record["exact_args"] = exact_args
        if not (call and found_tool and exact_args):
            record["failure"] = "missing_or_invalid_tool_call"
            return record
        call_id = call.get("id")
        if not isinstance(call_id, str) or not call_id:
            record["failure"] = "missing_tool_call_id"
            return record

        assistant_message = {
            "role": "assistant",
            "content": msg.get("content"),
            "tool_calls": msg["tool_calls"],
        }
        messages.extend([
            assistant_message,
            {"role": "tool", "tool_call_id": call_id, "content": json.dumps(case["tool_result"])},
        ])
        second_req = {
            "model": model, "messages": messages, "temperature": 0,
            "max_tokens": max_tokens, "stream": False,
        }
        second, t2 = chat(url, api_key, second_req, timeout)
        record["second_request_ms"] = t2
        answer = extract_message(second).get("content")
        record["tool_roundtrip"] = True
        record["final_answer_contains_value"] = isinstance(answer, str) and case["expected_fragment"] in answer
        if not record["final_answer_contains_value"]:
            record["failure"] = "missing_expected_tool_result_in_final"
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        record["failure"] = type(exc).__name__ + ": " + str(exc)[:160]
    return record


def aggregate(rows: list[dict]) -> list[dict]:
    models = sorted({r["model"] for r in rows})
    summaries = []
    for model in models:
        run = [r for r in rows if r["model"] == model]
        latencies = [r["first_request_ms"] for r in run if r["first_request_ms"] is not None]
        summaries.append({
            "model": model,
            "trials": len(run),
            "correct_tool_pct": round(100 * sum(r["correct_tool"] for r in run) / len(run), 1),
            "exact_arguments_pct": round(100 * sum(r["exact_args"] for r in run) / len(run), 1),
            "successful_roundtrip_pct": round(100 * sum(r["final_answer_contains_value"] for r in run) / len(run), 1),
            "median_initial_latency_ms": round(statistics.median(latencies), 1) if latencies else None,
        })
    return summaries


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base-url", required=True, help="Base OpenAI-compatible endpoint URL (including /v1 if needed)")
    p.add_argument("--models", required=True, help="Comma-separated served model aliases")
    p.add_argument("--repetitions", type=int, default=3)
    p.add_argument("--max-tokens", type=int, default=256)
    p.add_argument("--timeout", type=float, default=120)
    p.add_argument("--api-key-env", default="BENCH_API_KEY", help="Environment VARIABLE containing key, never a literal key")
    p.add_argument("--out", default="out/agent-tool-smoke.json")
    args = p.parse_args()
    if args.repetitions < 1 or args.max_tokens < 16:
        p.error("repetitions must be >=1 and max-tokens >=16")
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    if not models:
        p.error("at least one model alias is required")
    url = endpoint_url(args.base_url)
    key = os.environ.get(args.api_key_env)
    rows = []
    for model in models:
        for case in CASES:
            for repeat in range(args.repetitions):
                result = run_case(url, model, case, key, args.timeout, args.max_tokens)
                result["repeat"] = repeat + 1
                rows.append(result)
                print(model, case["id"], repeat + 1, "PASS" if result["final_answer_contains_value"] else "FAIL", result["failure"] or "")
    output = {
        "schema_version": "1",
        "kind": "solar_tool_call_smoke",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "endpoint": url,
        "parameters": {"temperature": 0, "max_tokens": args.max_tokens, "repetitions": args.repetitions},
        "cases": [case["id"] for case in CASES],
        "summary": aggregate(rows),
        "results": rows,
    }
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(output["summary"], indent=2, ensure_ascii=False))
    print("Saved", path)
    return 0 if all(r["final_answer_contains_value"] for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
