import { expect, test } from "@playwright/test";

test("Leer de Settings reuses a manually registered llama.cpp target", async ({ page, request }) => {
  const endpoint = "http://127.0.0.1:28081";
  const before = await request.get("/api/settings");
  expect(before.ok()).toBeTruthy();
  const { settings } = await before.json();
  const update = await request.patch("/api/settings", { data: { llamacppUrl: endpoint } });
  expect(update.ok()).toBeTruthy();
  const create = await request.post("/api/experiments/targets", {
    data: { label: "Proxmox manual", provider: "llamacpp", endpoint: endpoint + "/" },
  });
  expect(create.ok()).toBeTruthy();
  const { target } = await create.json();

  let importedId: string | undefined;
  try {
    await page.goto("/admin/churn");
    await page.getByRole("button", { name: "Leer de Settings" }).click();
    await expect(page.getByText("Target ready: Proxmox manual")).toBeVisible();

    const response = await request.get("/api/experiments/targets");
    const { targets } = await response.json();
    expect(targets.filter((entry: { endpoint: string }) => entry.endpoint.replace(/\/$/, "") === endpoint))
      .toEqual([target]);

    expect((await request.delete(`/api/experiments/targets/${target.id}`)).ok()).toBeTruthy();
    await page.getByRole("button", { name: "Leer de Settings" }).click();
    await expect(page.getByText("Target ready: llama.cpp (Settings)")).toBeVisible();

    const imported = await request.post("/api/experiments/targets/from-settings", { data: { provider: "llamacpp" } });
    expect(imported.ok()).toBeTruthy();
    const { target: saved } = await imported.json();
    importedId = saved.id;
    expect(saved).toMatchObject({ provider: "llamacpp", endpoint });
    expect(saved).not.toHaveProperty("apiKey");
  } finally {
    await request.delete(`/api/experiments/targets/${importedId ?? target.id}`);
    await request.patch("/api/settings", { data: { llamacppUrl: settings.llamacppUrl } });
  }
});
