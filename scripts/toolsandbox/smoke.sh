#!/usr/bin/env bash
set -euo pipefail

image=${1:-tuxevil-toolsandbox:wifi-check}
grade() {
  docker run --rm -i --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,nodev,size=8m --cpus 1 --memory 512m --pids-limit 64 "$image"
}

assert_grade() {
  local label=$1 payload=$2 check=$3
  local result
  result=$(printf '%s\n' "$payload" | grade)
  printf '%s\n' "$result" | node -e '
    const assert = require("node:assert/strict");
    const score = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const [label, check] = process.argv.slice(1);
    assert.equal(score.passed, check === "pass");
    if (check === "pass") {
      assert.equal(score.wifiEnabled, false);
      assert.deepEqual(score.milestones, [1, 1]);
    }
    if (check === "on") assert.equal(score.wifiEnabled, true);
    if (check === "silent") assert.equal(score.wifiEnabled, false);
    console.log(label, score);
  ' "$label" "$check"
}

assert_grade "action and confirmation" '{"actions":[false],"finalMessage":"Wifi is turned off"}' pass
assert_grade "confirmation without action" '{"actions":[],"finalMessage":"Wifi is turned off"}' on
assert_grade "action without correct confirmation" '{"actions":[false],"finalMessage":"I cannot help"}' silent
assert_grade "temporary change reverted" '{"actions":[false,true],"finalMessage":"Wifi is turned off"}' on
