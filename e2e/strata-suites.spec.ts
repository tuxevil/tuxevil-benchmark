import { expect, test } from "@playwright/test";

test("Test Suite discovers and launches Strata using its configured endpoint", async ({ page }) => {
  await page.route("**/api/settings", (route) => route.fulfill({ json: { settings: {
    ollamaUrl: "http://ollama.local:11434",
    strataUrl: "http://strata.local:8081/v1",
    activeProvider: "ollama",
  } } }));
  await page.route("**/api/scenarios", (route) => route.fulfill({ json: { scenarios: [] } }));
  await page.route("**/api/models?**", (route) => {
    const url = new URL(route.request().url());
    const isStrata = url.searchParams.get("url") === "http://strata.local:8081/v1";
    return route.fulfill({ json: { models: [{ name: isStrata ? "strata-only-model" : "ollama-only-model", size: "local" }] } });
  });
  await page.goto("/admin/suites");
  await expect(page.getByRole("option", { name: /ollama-only-model/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Strata", exact: true }).click();
  await expect(page.getByRole("option", { name: /strata-only-model/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /ollama-only-model/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Refresh Strata/ }).click();
  await expect(page.getByRole("option", { name: /strata-only-model/ })).toHaveCount(1);
  await page.getByRole("button", { name: /Mode B/ }).click();
  await page.route("**/api/runs", (route) => route.fulfill({ status: 400, json: { error: "Captured test run" } }));
  page.on("dialog", (dialog) => dialog.dismiss());
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/api/runs") && request.method() === "POST");
  await page.getByRole("button", { name: /Run.*Models/ }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    provider: "strata", providerUrl: "http://strata.local:8081/v1", models: ["strata-only-model"],
  });
});
