import { test, expect } from "@playwright/test";

const webUrl = process.env.NOCTURNE_WEB_URL || "http://127.0.0.1:3000";

test("audits navigation, character drawer, refresh, and responsive gameplay controls", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const consoleErrors = [];
  const serverErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(response.status() + " " + response.url());
  });

  await page.goto(webUrl + "/");
  await expect(page.getByRole("link", { name: "Play" })).toBeVisible();

  const composer = page.getByPlaceholder("What do you do?");
  let composerReady = true;
  try {
    await expect(composer).toBeVisible({ timeout: 15_000 });
  } catch {
    composerReady = false;
  }
  if (!composerReady) {
    await page.getByLabel("Name").fill("Interaction Audit Agent");
    await page
      .getByLabel("Character concept")
      .fill("A disposable browser interaction audit character.");
    await page.getByRole("button", { name: "Begin" }).click();
  }
  await expect(composer).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Play" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByPlaceholder("What do you do?")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Open character panel|Character/ }).click();
  await expect(page.locator(".scene-character-panel")).toBeVisible();
  await page.getByRole("button", { name: "Close character panel" }).click();
  await expect(page.locator(".scene-character-panel")).toHaveCount(0);

  await page.reload();
  await expect(page.getByPlaceholder("What do you do?")).toBeVisible({ timeout: 30_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByPlaceholder("What do you do?")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByPlaceholder("What do you do?")).toBeVisible();

  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(/Sign in required|Welcome back|Enter Calder City/)).toBeVisible();
  await page.getByRole("link", { name: "Play" }).click();

  expect(serverErrors, "UI interaction coverage found server errors").toEqual([]);
  expect(consoleErrors, "UI interaction coverage found console errors").toEqual([]);
});
