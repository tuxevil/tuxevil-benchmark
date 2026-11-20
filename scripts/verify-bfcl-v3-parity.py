"""Generate golden verdicts from the pinned Gorilla AST checker.

Pass a local copy of the pinned ast_checker.py as the only argument.
Only the Python/native checker is needed. No benchmark calls are executed.
"""
import ast
import hashlib
import json
import re
import sys
from copy import deepcopy
from enum import Enum
from pathlib import Path
from types import SimpleNamespace

SOURCE_SHA256 = "2aae7a68461a8f76c0be3894c8901b66b56967a1989d3ab066051e3fb97f1538"
ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "src/lib/benchmark-data/bfcl-v3-lite.json"


class Language(Enum):
    PYTHON = "python"
    JAVA = "java"
    JAVASCRIPT = "javascript"


def load_checker(path):
    source = path.read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("Official AST checker SHA-256 mismatch")

    tree = ast.parse(source, filename=str(path))
    tree.body = [
        node for node in tree.body
        if not isinstance(node, (ast.Import, ast.ImportFrom))
    ]
    namespace = {
        "re": re,
        "Language": Language,
        "MODEL_CONFIG_MAPPING": {"fixture": SimpleNamespace(underscore_to_dot=True)},
    }
    exec(compile(tree, str(path), "exec"), namespace)
    return namespace["ast_checker"]


def oracle_vectors(checker, case):
    correct = [
        {name.replace(".", "_"): {
            key: next(value for value in options if value != "")
            for key, options in parameters.items() if "" not in options
        }}
        for expected in case["ground_truth"]
        for name, parameters in expected.items()
    ]
    name, arguments = next(iter(correct[0].items()))
    first_key = next(iter(arguments))
    missing = deepcopy(correct)
    del missing[0][name][first_key]
    extra = deepcopy(correct)
    extra[0][name]["unexpected"] = True
    wrong_type = deepcopy(correct)
    wrong_type[0][name][first_key] = str(arguments[first_key])
    wrong_value = deepcopy(correct)
    wrong_value[0][name][first_key] = 99999
    vectors = [
        ("reference", correct),
        ("reversed", list(reversed(correct))),
        ("missing_call", correct[1:]),
        ("extra_call", correct + [correct[0]]),
        ("wrong_tool", [{"unknown_function": arguments}] + correct[1:]),
        ("missing_argument", missing),
        ("extra_argument", extra),
        ("wrong_type", wrong_type),
        ("wrong_value", wrong_value),
    ]
    if case["id"] == "simple_0":
        vectors.append(("normalized_string", [{name: {**arguments, "unit": "U-N I.TS"}}]))
    if len(correct) > 1:
        vectors.append(("duplicate_call", [correct[0], correct[0]]))
    for label, calls in vectors:
        result = checker(
            case["function"], deepcopy(calls), case["ground_truth"],
            Language.PYTHON, case["category"], "fixture",
        )
        yield {
            "id": case["id"], "vector": label, "calls": calls, "valid": result["valid"],
        }


if __name__ == "__main__":
    checker = load_checker(Path(sys.argv[1]))
    print(json.dumps([
        result for case in json.loads(CASES.read_text())
        for result in oracle_vectors(checker, case)
    ], indent=2))
