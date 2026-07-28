import { describe, expect, it } from "vitest";
import { createNocturneAuth } from "../src/index.js";

describe("createNocturneAuth", () => {
  it("exposes a shutdown hook for its PostgreSQL pool", async () => {
    const auth = createNocturneAuth({
      databaseUrl: "postgresql://user:password@127.0.0.1:5432/nocturne",
      secret: "test-secret-at-least-32-characters-long",
      baseUrl: "http://localhost:3000",
      trustedOrigins: ["http://localhost:3000"],
    });

    expect(auth.close).toBeTypeOf("function");
    await auth.close();
  });
});
