import { AsyncLocalStorage } from "node:async_hooks";
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

type AgentAuthorizationContext = {
  agent: AgentIdentity;
  scope: AgentScope;
};

const authorizationContext = new AsyncLocalStorage<AgentAuthorizationContext | null>();
const CHARACTER_BOUND_MUTATION_SCOPES = new Set<AgentScope>(["market:trade", "vehicle:claim"]);

export function hasAgentScope(agent: AgentIdentity, required: AgentScope): boolean {
  return (
    agent.scopes.includes("*") || agent.scopes.includes("play") || agent.scopes.includes(required)
  );
}

export function requireAgentScope(
  agent: AgentIdentity | null,
  required: AgentScope,
): AgentIdentity | null {
  if (!agent) {
    authorizationContext.enterWith(null);
    return null;
  }
  if (!hasAgentScope(agent, required)) {
    throw new AgentStoreError("forbidden", `Agent token requires scope: ${required}.`);
  }
  authorizationContext.enterWith({ agent, scope: required });
  return agent;
}

export function getCharacterBoundMutationAgent(): AgentIdentity | null {
  const context = authorizationContext.getStore();
  if (!context || !CHARACTER_BOUND_MUTATION_SCOPES.has(context.scope)) return null;
  return context.agent;
}

export function requireBoundCharacter(
  agent: AgentIdentity | null,
  requestedCharacterId: string | null | undefined,
): void {
  if (!agent?.boundCharacterId || !requestedCharacterId) return;
  if (agent.boundCharacterId !== requestedCharacterId) {
    throw new AgentStoreError("forbidden", "Agent token is bound to a different character.");
  }
}
