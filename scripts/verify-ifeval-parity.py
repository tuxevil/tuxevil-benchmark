"""Generate golden verdicts from the pinned Google Research evaluator.

Pass a directory containing the original instruction_following_eval package.
The selected checks need no NLTK downloads.
"""
import hashlib
import json
import sys
from pathlib import Path

SOURCE_DIGESTS = {
    "instructions.py": "60e086f5342a03ce8e18b64bbcccf86308f523c08aa826707a562150a52f3edf",
    "evaluation_lib.py": "35decc06000718487f44d7deafa6d3f48a8ec0886281edf40162c0265b7d248c",
    "instructions_registry.py": "ec92d72c264f6d906978613085db262356174300370a3fffe6fefd5969ce9cfc",
    "instructions_util.py": "a73797261eee5bf447e279d82a2b700b1bdd3cb1193412dbab1270a85832bc6b",
}
CASES = Path(__file__).resolve().parents[1] / "src/lib/benchmark-data/ifeval-lite.json"
RESPONSES = [
    "",
    "  \u001c\u0085\n",
    "A plain response",
    "Sure, here it is:\nA plain response",
    "A plain response\nExtra, line",
    "A, comma",
    "**\"Quoted answer\"**",
    "Sure:\n\"Quoted answer\"\nThanks",
    '\u0085"Quoted answer"\u001c',
    "“Smart quotes”",
    "* Pepper\n- Domino\n* Oreo",
    "**Pepper**\n- Domino\n* Oreo",
    "\n  * Pepper\r\n- Domino\n\t* Oreo",
    "* Pepper\r- Domino\n* Oreo",
    '* Pepper\n*\n- Oreo',
    '"Here are eight ideas\n* one\n* two\n* three\n* four\n* five\n* six\n* seven\n* eight"',
]


def run(package_root):
    for name, expected in SOURCE_DIGESTS.items():
        source = (package_root / "instruction_following_eval" / name).read_bytes()
        if hashlib.sha256(source).hexdigest() != expected:
            raise ValueError(f"Official IFEval source digest mismatch: {name}")
    sys.path.insert(0, str(package_root))
    from instruction_following_eval import evaluation_lib

    vectors = []
    for row in json.loads(CASES.read_text()):
        case = evaluation_lib.InputExample(**row)
        for response in RESPONSES:
            responses = {case.prompt: response}
            strict = evaluation_lib.test_instruction_following_strict(case, responses)
            loose = evaluation_lib.test_instruction_following_loose(case, responses)
            vectors.append({
                "key": case.key,
                "response": response,
                "strict": strict.follow_instruction_list,
                "loose": loose.follow_instruction_list,
            })
    return vectors


if __name__ == "__main__":
    print(json.dumps(run(Path(sys.argv[1]).resolve()), ensure_ascii=False, indent=2))
