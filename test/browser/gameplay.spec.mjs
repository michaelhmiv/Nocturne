import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const actions = JSON.parse(
  await readFile(new URL("./action-prompts.json", import.meta.url), "utf8"),
);

test.describe.configure({ mode: "serial" });

test("onboards a character and resolves every supported action through the production UI path", async ({ page }) => {
  const consoleErrors = [];
  const legacyRequests = [];
  const persistentResponses = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/game/ai-jobs/actions")) legacyRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/game/persistent-world/actions")) {
      persistentResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto("/");
  await expect(page.getByText("WHO ENTERS THE CITY?")).toBeVisible();
  await page.getByLabel("Name").fill("Browser Certification Agent");
  await page
    .getByLabel("Character concept")
    .fill("A deterministic browser test character used to certify every Nocturne action.");
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByText("Unit 3B is available.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Take Unit 3B" }).click();
  await expect(page.getByPlaceholder("What do you do?")).toBeVisible({ timeout: 20_000 });

  for (const action of actions) {
    const composer = page.getByPlaceholder("What do you do?");
    await composer.fill(action.prompt);
    await page.getByRole("button", { name: "Do it" }).click();

    const resolvedCard = page
      .locator(".scene-plan-turn")
      .filter({ has: page.locator(".scene-player-line", { hasText: action.prompt }) })
      .last();
    await expect(resolvedCard, `${action.actionType} did not render a resolved plan`).toBeVisible({
      timeout: 30_000,
    });
    await expect(resolvedCard).not.toContainText(/internal_error|request_failed|provider_failure/i);
    await expect(page.locator('[role="alert"]')).not.toContainText(
      /internal_error|request_failed|provider_failure/i,
    );
  }

  expect(legacyRequests, "The browser must not submit gameplay to the legacy action endpoint").toEqual([]);
  expect(persistentResponses).toHaveLength(actions.length);
  expect(
    persistentResponses.filter((response) => response.status >= 500),
    "No persistent-world browser request may return a server error",
  ).toEqual([]);
  expect(consoleErrors, "The production browser flow must not emit console errors").toEqual([]);
});
