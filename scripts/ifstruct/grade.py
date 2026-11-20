"""Run the pinned IFStruct validator against a fixed benchmark case."""

import json
import resource
import sys
from pathlib import Path

resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
memory_limit = 128 * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (memory_limit, memory_limit))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from validator import validate_response


def main():
    inputs = sys.stdin.buffer.read(128 * 1024 + 1)
    if len(inputs) > 128 * 1024:
        raise ValueError("IFStruct input exceeds validator limit")
    request = json.loads(inputs)
    fixture = request["fixture"]
    result = validate_response(
        response=request["response"],
        json_schema=fixture["json_schema"],
        top_level_count=fixture["top_level_count"],
        require_no_commentary=fixture["require_no_commentary"],
        output_format=fixture["output_format"],
        top_level_key=fixture["top_level_key"],
        require_wrapper_key=fixture["require_wrapper_key"],
        require_code_block=fixture["require_code_block"],
    )
    json.dump({
        "passed": result.passed,
        "errorCount": len(result.errors),
        "errors": [error[:200] for error in result.errors[:20]],
        "details": result.details,
    }, sys.stdout)


if __name__ == "__main__":
    main()
