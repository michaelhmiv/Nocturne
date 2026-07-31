import type {
  PersistentWorldScene,
  PersistentWorldSceneSchema,
} from "../../../packages/contracts/src/persistent-scene.js";
import type { WorldActionPlayerSafeResult } from "../../../packages/contracts/src/world-action.js";

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `Persistent-world request failed with ${response.status}.`,
    );
  }
  return payload as T;
}

export async function loadPersistentWorldScene(input: {
  apiBaseUrl: string;
  accessToken?: string;
  signal?: AbortSignal;
}): Promise<PersistentWorldScene> {
  const response = await fetch(`${input.apiBaseUrl}/v1/persistent-world/scene`, {
    headers: input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {},
    signal: input.signal,
  });
  const payload = await jsonResponse<unknown>(response);
  const schema = (await import("../../../packages/contracts/src/persistent-scene.js"))
    .PersistentWorldSceneSchema as typeof PersistentWorldSceneSchema;
  return schema.parse(payload);
}

export async function submitPersistentWorldAction(input: {
  apiBaseUrl: string;
  command: string;
  actorId?: string;
  idempotencyKey: string;
  accessToken?: string;
  signal?: AbortSignal;
}): Promise<WorldActionPlayerSafeResult> {
  const response = await fetch(`${input.apiBaseUrl}/v1/persistent-world/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
      ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}),
    },
    body: JSON.stringify({
      command: input.command,
      ...(input.actorId ? { actorId: input.actorId } : {}),
    }),
    signal: input.signal,
  });
  return jsonResponse<WorldActionPlayerSafeResult>(response);
}
