import { AgentStoreError, type AgentIdentity } from "@nocturne/database";

export type AgentScope =
  | "character:read"
  | "character:write"
  | "action:submit"
  | "market:read"
  | "market:trade"
  | "vehicle:read"
  | "vehicle:claim"
  | "agent:manage";

export function hasAgentScope(agent: AgentIdentity, required: AgentScope): boolean {
  return agent.scopes.includes("*") || agent.scopes.includes("play") || agent.scopes.includes(required);
}

export function requireAgentScope(
  agent: AgentIdentity | null,
  required: AgentScope,
): AgentIdentity | null {
  if (!agent) return null;
  if (!hasAgentScope(agent, required)) {
    throw new AgentStoreError("forbidden", `Agent token requires scope: ${required}.`);
  }
  return agent;
}

export function requireBoundCharacter(
  agent: AgentIdentity | null,
  requestedCharacterId: string | null | undefined,
): void {
  if (!agent?.boundCharacterId || !requestedCharacterId) return;
  if (agent.boundCharacterId !== requestedCharacterId) {
    throw new AgentStoreError(
      "forbidden",
      "Agent token is bound to a different character.",
    );
  }
}
