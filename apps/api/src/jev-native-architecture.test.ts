import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("Jev-native player action architecture", () => {
  it("does not expose a generative planner or reference interpreter to persistent player actions", () => {
    const code = source("./persistent-world-action-service.ts");
    expect(code).not.toContain("planPersistentWorldAction");
    expect(code).not.toContain("interpretEntityReferences");
    expect(code).not.toContain("generateStructured");
    expect(code).not.toContain("qwen_fallback");
    expect(code).not.toContain("AiProviderClient");
    expect(code).toContain("decideWorldActionFastPath");
  });

  it("does not fall back to generative search semantic analysis", () => {
    const code = source("./search-discovery-service.ts");
    expect(code).not.toContain("analyzeSearchDiscovery");
    expect(code).toContain("decideSearchDiscovery");
  });

  it("does not fall back to generative consumable semantic analysis", () => {
    const code = source("./action-service.ts");
    expect(code).not.toContain("analyzeConsumable");
    expect(code).toContain("decideConsumableFastPath");
  });
});
