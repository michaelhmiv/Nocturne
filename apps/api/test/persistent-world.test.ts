import { describe, expect, it } from "vitest";
import { createPersistentWorldService } from "../src/persistent-world.js";

function fakeStore(keys: string[] = []) {
  const character = {
    characterId: "40000000-0000-4000-8000-000000000001",
    definitionId: "CHAR-test",
    name: "Night Engineer",
    conceptSummary: "A systems engineer drawn into Calder City's hidden conflicts.",
    originSource: "human",
    selected: true,
    locationId: null,
    residenceId: null,
    createdAt: new Date(0).toISOString(),
  };
  return {
    seedStarterWorld: async () => ({}) as never,
    getStarterWorld: async () => ({}) as never,
    createCharacter: async (_userId: string, _input: unknown, key: string) => {
      keys.push(key);
      return character;
    },
    listCharacters: async () => [character],
    getCharacter: async () => character,
    selectCharacter: async () => character,
    rentStarterResidence: async () => ({
      characterId: character.characterId,
      residenceId: "10000000-0000-4000-8000-000000000005",
      eventId: "50000000-0000-4000-8000-000000000001",
      alreadyRented: false,
    }),
  };
}

describe("persistent world service", () => {
  it("validates character input before calling persistence", async () => {
    const service = createPersistentWorldService(fakeStore());
    await expect(service.createCharacter("user-1", { name: "x" })).rejects.toThrow();
  });

  it("creates a character through the command boundary", async () => {
    const service = createPersistentWorldService(fakeStore());
    const result = await service.createCharacter("user-1", {
      name: "Night Engineer",
      conceptSummary: "A systems engineer drawn into Calder City's hidden conflicts.",
      originSource: "human",
    });
    expect(result.name).toBe("Night Engineer");
  });

  it("scopes supplied idempotency keys to the account and command", async () => {
    const keys: string[] = [];
    const service = createPersistentWorldService(fakeStore(keys));
    await service.createCharacter(
      "user-1",
      {
        name: "Night Engineer",
        conceptSummary: "A systems engineer drawn into Calder City's hidden conflicts.",
        originSource: "human",
      },
      "request-1",
    );
    expect(keys).toEqual(["character:user-1:request-1"]);
  });
});
