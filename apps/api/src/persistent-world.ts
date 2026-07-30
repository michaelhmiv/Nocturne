import { randomUUID } from "node:crypto";
import {
  CreateCharacterInputSchema,
  RentResidenceInputSchema,
  type CharacterSummary,
  type RentResidenceResult,
  type StarterWorld,
} from "@nocturne/contracts";
import type { PersistentWorldStore } from "@nocturne/database";
import { getCharacterBoundMutationAgent, requireBoundCharacter } from "./agent-scope.js";

export interface PersistentWorldService {
  createCharacter(
    userId: string,
    input: unknown,
    idempotencyKey?: string,
  ): Promise<CharacterSummary>;
  listCharacters(userId: string): Promise<CharacterSummary[]>;
  getCharacter(userId: string, characterId: string): Promise<CharacterSummary | null>;
  selectCharacter(userId: string, characterId: string): Promise<CharacterSummary>;
  getStarterWorld(): Promise<StarterWorld>;
  rentStarterResidence(
    userId: string,
    input: unknown,
    idempotencyKey?: string,
  ): Promise<RentResidenceResult>;
}

export function createPersistentWorldService(store: PersistentWorldStore): PersistentWorldService {
  return {
    async createCharacter(userId, input, idempotencyKey) {
      const parsed = CreateCharacterInputSchema.parse(input);
      await store.seedStarterWorld();
      return store.createCharacter(
        userId,
        parsed,
        idempotencyKey || `character:${userId}:${randomUUID()}`,
      );
    },
    listCharacters: (userId) => store.listCharacters(userId),
    getCharacter: (userId, characterId) => {
      requireBoundCharacter(getCharacterBoundMutationAgent(), characterId);
      return store.getCharacter(userId, characterId);
    },
    selectCharacter: (userId, characterId) => store.selectCharacter(userId, characterId),
    async getStarterWorld() {
      await store.seedStarterWorld();
      return store.getStarterWorld();
    },
    async rentStarterResidence(userId, input, idempotencyKey) {
      const parsed = RentResidenceInputSchema.parse(input);
      await store.seedStarterWorld();
      return store.rentStarterResidence(
        userId,
        parsed.characterId,
        idempotencyKey || `residence:${userId}:${parsed.characterId}:${randomUUID()}`,
      );
    },
  };
}
