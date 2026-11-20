"""Score the last boxed answer with the pinned Math-Verify evaluator."""
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
memory = 256 * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (memory, memory))

from math_verify import LatexExtractionConfig, parse, verify


def last_boxed(text):
    marker = "\\boxed{"
    start = text.rfind(marker)
    if start < 0:
        return None
    start += len(marker)
    depth = 1
    for index, char in enumerate(text[start:], start):
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index]
    return None


def parse_answer(value):
    return parse(
        "$" + value + "$",
        extraction_config=[LatexExtractionConfig()],
        extraction_mode="first_match",
        fallback_mode="no_fallback",
    )


def main():
    payload = sys.stdin.buffer.read(128 * 1024 + 1)
    if len(payload) > 128 * 1024:
        raise ValueError("MATH-500 input exceeds validator limit")
    request = json.loads(payload)
    gold = parse_answer(request["answer"])
    if not gold:
        raise ValueError("MATH-500 reference cannot be parsed")

    candidate = last_boxed(request["response"])
    if candidate is None:
        result = {"passed": False, "reason": "MISSING_BOXED_ANSWER"}
    elif len(candidate) > 2048:
        result = {"passed": False, "reason": "BOXED_ANSWER_TOO_LONG"}
    elif "$" in candidate:
        result = {"passed": False, "reason": "UNPARSEABLE_ANSWER", "boxedAnswer": candidate}
    else:
        prediction = parse_answer(candidate)
        passed = bool(prediction) and verify(gold, prediction, strict=True)
        reason = "EQUIVALENT" if passed else "NOT_EQUIVALENT" if prediction else "UNPARSEABLE_ANSWER"
        result = {"passed": passed, "reason": reason, "boxedAnswer": candidate}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
