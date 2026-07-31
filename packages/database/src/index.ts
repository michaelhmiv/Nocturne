import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as coreSchema from "./schema.js";
import * as entityLifecycleSchema from "./entity-lifecycle-schema.js";
import * as worldSchema from "./world-schema.js";

const schema = { ...coreSchema, ...entityLifecycleSchema, ...worldSchema };

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { prepare: false, max: 10 });
  return {
    client,
    db: drizzle(client, { schema }),
    async close() {
      await client.end();
    },
  };
}
export * from "./action-store.js";
export * from "./agent-store.js";
export * from "./ai-job-store.js";
export * from "./consumption-store.js";
export * from "./context-store.js";
export * from "./conversation-store.js";
export * from "./entity-lifecycle-schema.js";
export * from "./entity-lifecycle-store.js";
export * from "./game-store.js";
export * from "./invention-store.js";
export * from "./json.js";
export * from "./location-materialization-store.js";
export * from "./location-store.js";
export * from "./market-store.js";
export * from "./materialization-store.js";
export * from "./persistent-plan-store.js";
export * from "./reference-resolution-store.js";
export * from "./relationship-store.js";
export * from "./relevance-context-store.js";
export * from "./state-operation-executor.js";
export * from "./universal-operation-executor.js";
export * from "./world-schema.js";
export * from "./world-store.js";
export * from "./schema.js";
