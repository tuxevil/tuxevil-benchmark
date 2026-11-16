# IA Solar — auditoría de tuxevil-benchmark y prueba de agentes (2026-11-16)

This is a focused **source-code audit** plus a new standalone Python smoke runner. No runtime inference numbers are claimed.

## Findings in current TypeScript implementation

1. **Tool calling is not yet a scored benchmark mode.** In \`src/lib/benchmark-queue.ts\`, each model receives a role system + role user + role assistant text transcript. \`src/lib/ollama-client.ts\` and \`src/lib/providers/openai-client.ts\` do not send \`tools\` or \`tool_choice\` and do not evaluate structured \`tool_calls\` returned from the provider. Thus a model's quality score does **not** establish its ability to operate an agent.
2. **Judge metric is generic.** \`src/lib/frontier-evaluator.ts\` uses an LLM judge (star rating, grammar, compliance and accuracy). It doesn't validate JSON tool arguments, tool name, multi-turn tool-response consumption, or tool call success against a deterministic oracle. The judge can overvalue fluent text and under/overestimate small models.
3. **TTFT includes thinking tokens.** Both stream parsers start their \`firstTokenAt\` timer when either content or separate reasoning begins. This is a useful time-to-first-emitted-token metric but *not* time-to-first-visible-answer; comparisons must label it correctly.
4. **Provider throughput isn't perfectly comparable.** Ollama reports \`eval_duration\` directly; OpenAI-compatible servers may lack timings and fall back to elapsed wall time after first emitted token. For actual comparative throughput, use backend-reported decode separately from end-to-end and standardize output lengths/settings.
5. **Reasoning mode, truncation and format matter.** The openai client can send \`reasoning_effort\`, \`max_tokens\`, \`temperature\` and other options, but the same setting may not map identically across llama.cpp and other engines. Preserve raw request body, runner version, model hash, sampler, prompt/chat template and reasoning status. Empty visible responses can be categorized as failed even if reasoning was generated.
6. **No production concurrency conclusion is available.** One standardized client in existing model suite does not demonstrate sustainable multi-agent load; use Agent Headroom CROWD and an end-to-end LiteLLM test.

## Added reproducible smoke test

File: \`scripts/agent-tool-smoke.py\`

A deterministic **text-plus-tools API** check against a supplied OpenAI-compatible \`/v1\` endpoint. Two Spanish fixtures:
- \`calculator-es\`: calls \`add_numbers(a=17,b=25)\`, accepts function name and **exact JSON parameters**, returns synthetic \`sum=42\` in a follow-up tool message; requires the model to respond with 42.
- \`battery-soc-es\`: calls \`read_sensor(sensor_id="battery_soc")\`, returns synthetic 67%; requires the follow-up to contain 67.

This script **does not execute external tools**, shell commands or access Home Assistant. It sends fake fixture outputs only. The output JSON contains summary pass rates, timings and reasons, not secret keys or raw prompts. Requests are sequential; it is not a concurrency test.

~~~bash
# Run against your local llama-server (configured with the proper chat template and tool support).
python3 scripts/agent-tool-smoke.py \
  --base-url http://127.0.0.1:8080/v1 \
  --models gemma4-e2b-q4_k_m,lfm3-1.7b-q4_k_m \
  --repetitions 5 \
  --out out/solar-agent-tool-smoke.json

# To use a protected proxy, set the key in the environment; do not pass it in CLI args.
export BENCH_API_KEY="..."  # shell history risk: use a secrets manager in production
python3 scripts/agent-tool-smoke.py \
  --base-url https://ai.tuxevil.com/v1 \
  --models solar-small
~~~

The model identifiers above are **illustrative**, not verified served aliases. The second command is for future deployment only and should not run until the private API is active.

Check offline tests with:

~~~bash
python3 -m unittest scripts/test_agent_tool_smoke.py -v
~~~

## Upgrade plan (not implemented in this PR)

- Integrate structured \`tool_calls\` as a first-class scenario with a trusted fixture executor and deterministic argument comparators.
- Add multi-turn tests, Spanish instruction following, schema/JSON strictness, tool-result grounding, refusal on unnecessary tool calls, and security/injection tests.
- Run each model with identical prompt templates where supported, temperature and token budgets, and several repeats; report uncertainty and failures instead of a single blended score.
- Combine quality threshold with Agent Headroom 1/2/4/8 concurrency sweeps and real GPU-power/Solar Assistant measurements.
- Avoid promising a single winner before actual RTX 4000 results.
