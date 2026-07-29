import { describe, expect, it } from "vitest";
import { serializeJson } from "../src/json.js";

describe("serializeJson", () => {
  it("returns JSON text for postgres JSONB parameters", () => {
    expect(serializeJson({ nested: [1, true] })).toBe('{"nested":[1,true]}');
  });
});
