import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("overview shows the live route chain and provider health", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/#/overview");
  await expect(page.getByRole("heading", { name: "The next request has a path." })).toBeVisible();
  await expect(page.getByText("Primary Firecrawl", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Secondary Firecrawl", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Disabled fallback", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("2/2")).toBeVisible();
  await expect(page.getByText("live", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("provider CRUD, test, disable, and delete work from the dashboard", async ({ page }) => {
  await page.goto("/#/providers");
  await page.getByRole("button", { name: "Add provider" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add a provider" })).toBeVisible();

  await dialog.getByLabel(/Provider ID/).fill("e2e-added");
  await dialog.getByLabel(/Display name/).fill("E2E added");
  await dialog.getByLabel(/Base URL/).fill("http://127.0.0.1:4311");
  await dialog.getByLabel(/Priority/).fill("5");
  await dialog.getByRole("button", { name: "Add provider" }).click();

  await expect(page.getByText("E2E added", { exact: true })).toBeVisible();
  await expect(page.getByText("e2e-added", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit E2E added" }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByLabel(/Display name/).fill("E2E edited");
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("E2E edited", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Disable E2E edited" }).click();
  await expect(page.getByText("E2E edited", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Enable E2E edited" }).click();
  await page.getByRole("button", { name: "Test E2E edited" }).click();
  await expect(page.getByRole("heading", { name: "Probe: e2e-added" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();

  await page.getByRole("button", { name: "Delete E2E edited" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete provider" }).click();
  await expect(page.getByText("E2E edited", { exact: true })).toHaveCount(0);
});

test("routing policy and settings persist across reloads", async ({ page }) => {
  await page.goto("/#/routing");
  const threshold = page.getByLabel(/Failures before auto-disable/);
  await expect(threshold).toHaveValue("3");
  await threshold.fill("5");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Routing policy saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Failures before auto-disable/)).toHaveValue("5");
  await page.getByLabel(/Failures before auto-disable/).fill("3");
  await page.getByRole("button", { name: "Save policy" }).click();

  await page.goto("/#/settings");
  const rpm = page.getByLabel(/Requests per minute/);
  await expect(rpm).toHaveValue("60");
  await rpm.fill("90");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Requests per minute/)).toHaveValue("90");
  await page.getByLabel(/Requests per minute/).fill("60");
  await page.getByRole("button", { name: "Save settings" }).click();
});

test("provider order can be changed from providers and the route board", async ({ page }) => {
  await page.goto("/#/providers");
  await page.getByRole("button", { name: "Raise Secondary Firecrawl" }).click();
  await page.waitForTimeout(400);
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toContainText("Secondary Firecrawl");
  await page.getByRole("button", { name: "Lower Secondary Firecrawl" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator("tbody tr").first()).toContainText("Primary Firecrawl");

  await page.goto("/#/overview");
  await page.getByRole("button", { name: "Raise Secondary Firecrawl" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".route-row").first()).toContainText("Secondary Firecrawl");
  await page.getByRole("button", { name: "Lower Secondary Firecrawl" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".route-row").first()).toContainText("Primary Firecrawl");
});

test("search requests appear in the log explorer with an attempt chain", async ({ page }) => {
  const response = await page.request.post("/v2/search", {
    data: { query: "e2e search", limit: 3 },
  });
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.success).toBe(true);
  expect(payload.data.web.length).toBeGreaterThan(0);

  await page.goto("/#/logs");
  await expect(page.getByText("/v2/search").first()).toBeVisible();
  await page.locator("tbody tr").first().click();
  await expect(page.getByText("Attempt chain", { exact: true })).toBeVisible();
  await expect(page.getByText("primary", { exact: true }).first()).toBeVisible();
});

test("API keys can be created before authentication is enabled", async ({ page }) => {
  await page.goto("/#/access");
  await page.getByRole("tab", { name: "API keys" }).click();
  await page.getByRole("button", { name: "Generate key" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Generate API key" })).toBeVisible();
  await dialog.getByLabel("Key name").fill("bootstrap");
  await dialog.getByRole("button", { name: "Generate key" }).click();
  await expect(page.getByRole("heading", { name: "API key created" })).toBeVisible();
  await expect(page.getByText("bootstrap", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Owner: system", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("bootstrap", { exact: true })).toBeVisible();
});

test("command palette navigates without a pointer", async ({ page }) => {
  await page.goto("/#/overview");
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Jump to" })).toBeVisible();
  await dialog.getByRole("button", { name: /Providers/ }).click();
  await expect(page).toHaveURL(/#\/providers/);
  await expect(page.getByRole("heading", { name: "Providers", level: 2 })).toBeVisible();
});

test("mobile layout has no horizontal overflow and the nav works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/overview");
  await expect(page.getByRole("heading", { name: "The next request has a path." })).toBeVisible();
  const rail = page.locator("#primary-navigation");
  await expect(rail).toHaveAttribute("aria-hidden", "true");
  expect(await rail.evaluate((element) => (element as HTMLElement).inert)).toBe(true);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Overview" })).toBeFocused();
  await expect(rail).not.toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Providers" }).click();
  await expect(page.getByRole("heading", { name: "Providers", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("authentication can be enabled, used to sign in, and disabled", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("switch", { name: "Require authentication" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Create the first admin" })).toBeVisible();
  await dialog.getByLabel(/username/i).fill("admin");
  await dialog.getByLabel(/^Password/).fill("password123");
  await dialog.getByLabel(/Confirm password/).fill("password123");
  await dialog.getByRole("button", { name: "Create admin and enable" }).click();
  await expect(page.getByText("Admin created and authentication enabled")).toBeVisible();
  await expect(page.getByText("enabled", { exact: true }).first()).toBeVisible();

  await page.goto("/#/access");
  await expect(page.getByText("admin", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel(/Username/).fill("admin");
  await page.getByLabel(/Password/).fill("password123");
  await page.getByRole("button", { name: /Enter control plane/ }).click();
  await expect(page.getByRole("heading", { name: "Access", level: 2 })).toBeVisible();
  await page.goto("/#/overview");
  await expect(page.getByRole("heading", { name: "The next request has a path." })).toBeVisible();

  await page.goto("/#/settings");
  await page.getByRole("switch", { name: "Require authentication" }).click();
  const disableDialog = page.getByRole("dialog");
  await expect(disableDialog.getByRole("heading", { name: "Disable authentication?" })).toBeVisible();
  await disableDialog.getByRole("button", { name: "Disable authentication" }).click();
  await expect(page.getByText("Authentication disabled")).toBeVisible();
});
