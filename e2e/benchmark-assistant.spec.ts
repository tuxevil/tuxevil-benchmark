import { expect, test } from "@playwright/test";

test("shows the proposed pilot before starting and displays the result", async ({ page }) => {
  const actions: string[] = [];
  await page.route("**/api/experiments/assistant", async (route) => {
    const body = route.request().postDataJSON();
    actions.push(body.action);
    await route.fulfill({ json: body.action === "plan"
      ? { model: "Gemma local", plan: { cases: 2, thinking: "off" } }
      : { experimentId: "experiment", executionId: "execution", variants: { baseline: "OFF" } } });
  });
  await page.route("**/api/experiments/experiment/executions/execution", (route) => route.fulfill({
    json: {
      execution: { status: "COMPLETED" },
      benchmarkRuns: [],
      publicBenchmarkResults: [{ variantId: "baseline", observations: [
        { id: "observation", caseId: "test:0", metadata: { outcome: "PASS" }, telemetry: { totalDurationMs: 97 } },
      ] }],
    },
  }));
  await page.goto("/admin/churn");
  await page.getByLabel("¿Qué quieres probar?").fill("Prueba mi modelo con dos casos de GSM8K.");
  await page.getByRole("button", { name: "Preparar prueba" }).click();
  await expect(page.getByText(/Gemma local.+GSM8K tuxevil-lite/)).toBeVisible();
  expect(actions).toEqual(["plan"]);
  await page.getByRole("button", { name: "Ejecutar prueba" }).click();
  await expect(page.getByText("Prueba completada")).toBeVisible();
  await expect(page.getByText("test:0 · Thinking OFF · Correcta · 97 ms")).toBeVisible();
  expect(actions).toEqual(["plan", "run"]);
});
