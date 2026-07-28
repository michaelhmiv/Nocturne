import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false,
    max: 10,
  });

  return {
    client,
    db: drizzle(client, { schema }),
    async close(): Promise<void> {
      await client.end();
    },
  };
}

export * from "./game-store.js";
export * from "./schema.js";
