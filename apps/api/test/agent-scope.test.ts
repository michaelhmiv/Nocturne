import { describe, expect, it } from "vitest";
import type { AgentIdentity } from "@nocturne/database";
import { hasAgentScope, requireAgentScope, requireBoundCharacter } from "../src/agent-scope.js";

const agent = (overrides: Partial<AgentIdentity> = {}): AgentIdentity => ({
  tokenId: "10000000-0000-4000-8000-000000000001",
  userId: "agent:user",
  label: "test-agent",
  boundCharacterId: null,
  scopes: ["character:read"],
  ...overrides,
});

describe("agent authorization", () => {
  it("accepts a specific scope", () => {
    expect(hasAgentScope(agent(), "character:read")).toBe(true);
    expect(hasAgentScope(agent(), "market:trade")).toBe(false);
  });

  it("keeps the legacy play scope as a temporary wildcard", () => {
    expect(hasAgentScope(agent({ scopes: ["play"] }), "vehicle:claim")).toBe(true);
  });

  it("rejects a missing route scope", () => {
    expect(() => requireAgentScope(agent(), "action:submit")).toThrow(/action:submit/);
  });

  it("prevents a character-bound token from acting as another character", () => {
    expect(() =>
      requireBoundCharacter(
        agent({ boundCharacterId: "10000000-0000-4000-8000-000000000010" }),
        "10000000-0000-4000-8000-000000000011",
      ),
    ).toThrow(/different character/);
  });
});
