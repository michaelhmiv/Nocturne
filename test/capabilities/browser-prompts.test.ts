import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTION_TYPES } from "../../packages/rules-engine/src/index.js";
import { ACTION_CAPABILITIES } from "./action-capabilities.js";

type BrowserPrompt = { actionType: string; prompt: string };

const prompts = JSON.parse(
  readFileSync(new URL("../browser/action-prompts.json", import.meta.url), "utf8"),
) as BrowserPrompt[];

describe("browser action coverage", () => {
  it("contains exactly one browser scenario for every supported action type", () => {
    expect(prompts.map(({ actionType }) => actionType).sort()).toEqual([...ACTION_TYPES].sort());
    expect(new Set(prompts.map(({ actionType }) => actionType)).size).toBe(ACTION_TYPES.length);
  });

  it.each(prompts)("uses a declared canonical prompt for $actionType", ({ actionType, prompt }) => {
    expect(actionType in ACTION_CAPABILITIES).toBe(true);
    const capability = ACTION_CAPABILITIES[actionType as keyof typeof ACTION_CAPABILITIES];
    expect(capability.browserRequired).toBe(true);
    expect(capability.canonicalPrompts).toContain(prompt);
    expect(prompt.trim().length).toBeGreaterThanOrEqual(8);
  });
});
