#!/usr/bin/env bash
set -euo pipefail

: "${BENCHMARK_SMOKE_IMAGE:?Set to a locally built production image}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
scratch=$(mktemp -d)
project="tuxevil-smoke-${scratch##*.}"
compose=(docker compose --project-name "${project,,}" -f deploy/runtime-smoke.compose.yaml)

cleanup() {
  local status=$?
  if (( status != 0 )); then
    "${compose[@]}" logs --tail 70 >&2 || true
  fi
  "${compose[@]}" down --volumes --timeout 8 >/dev/null
  rmdir "$scratch"
}
trap cleanup EXIT

"${compose[@]}" up -d --wait --wait-timeout 60
execution_id=$("${compose[@]}" exec -T fixture node /smoke.mjs check)
outcomes=$("${compose[@]}" exec -T postgres psql -U smoke -d smoke -At -v ON_ERROR_STOP=1 \
  -v execution_id="$execution_id" <<'SQL'
WITH observations AS (
  SELECT CASE WHEN jsonb_typeof(metadata) = 'string'
    THEN (metadata #>> '{}')::jsonb ELSE metadata END AS detail
  FROM experiment_execution_observations
  WHERE execution_id = :'execution_id'::uuid
)
SELECT string_agg(detail->>'outcome', ',' ORDER BY detail->>'outcome')
FROM observations;
SQL
)
if [[ "$outcomes" != "PASS,PROVIDER_ERROR,WRONG_ANSWER" ]]; then
  echo "Unexpected persisted GSM8K outcomes: $outcomes" >&2
  exit 1
fi
echo "Verified the three GSM8K outcomes persisted in PostgreSQL."
