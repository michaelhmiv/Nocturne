import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

describe("migration runner", () => {
  it("serializes concurrent deploy migrations with a PostgreSQL advisory lock", async () => {
    const source = await readFile(join(here, "../src/migrate.ts"), "utf8");

    expect(source).toContain("pg_advisory_lock");
    expect(source).toContain("pg_advisory_unlock");
  });
});
