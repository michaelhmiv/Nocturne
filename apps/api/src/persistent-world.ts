import { randomUUID } from "node:crypto";
import {
  CreateCharacterInputSchema,
  RentResidenceInputSchema,
  type CharacterSummary,
  type RentResidenceResult,
  type StarterWorld,
} from "@nocturne/contracts";
import type { PersistentWorldStore } from "@nocturne/database";
import { z } from "zod";

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function scopedIdempotencyKey(command: string, userId: string, key?: string): string {
  const requestKey = key ? IdempotencyKeySchema.parse(key) : randomUUID();
  return `${command}:${userId}:${requestKey}`;
}

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
        scopedIdempotencyKey("character", userId, idempotencyKey),
      );
    },
    listCharacters: (userId) => store.listCharacters(userId),
    getCharacter: (userId, characterId) => store.getCharacter(userId, characterId),
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
        scopedIdempotencyKey("residence", userId, idempotencyKey),
      );
    },
  };
}
