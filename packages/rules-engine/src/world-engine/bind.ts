import {
  type EngineBindStatus,
  type EngineBoundTarget,
  type EngineIntent,
} from "@nocturne/contracts";
import type { ActorSnapshot, WorldCandidate, WorldEnginePorts } from "./ports.js";

export type BindResult = {
  status: EngineBindStatus;
  actor: ActorSnapshot | null;
  target?: EngineBoundTarget;
  conflictNames: string[];
};

export async function bindIntent(
  intent: EngineIntent,
  ports: WorldEnginePorts,
): Promise<BindResult> {
  const actor = await ports.query.readActor({
    worldId: intent.worldId,
    shardId: intent.shardId,
    actorId: intent.actorId,
  });
  if (!actor) {
    return { status: "impossible", actor: null, conflictNames: [] };
  }
  if (!actor.conscious || actor.restrained) {
    if (intent.primitive === "travel" || intent.primitive === "occupy" || intent.primitive === "operate") {
      return { status: "impossible", actor, conflictNames: [] };
    }
  }

  if (
    intent.primitive === "perceive" &&
    (!intent.category || intent.category === "body.self" || intent.category === "item.cash")
  ) {
    return {
      status: "bound",
      actor,
      target: { known: true, playable: true, family: intent.category },
      conflictNames: [],
    };
  }

  if (!intent.category && intent.explicitEntityIds.length === 0) {
    return { status: "unsupported", actor, conflictNames: [] };
  }

  if (intent.primitive === "operate" && intent.category === "item.weapon") {
    const held = actor.possessedIds.filter((id) => intent.explicitEntityIds.includes(id));
    if (intent.explicitEntityIds.length === 0 && actor.possessedIds.length === 0) {
      return { status: "impossible", actor, conflictNames: [] };
    }
    if (intent.explicitEntityIds.length > 0 && held.length === 0) {
      return { status: "impossible", actor, conflictNames: [] };
    }
  }

  const known = intent.category
    ? await ports.query.listKnown({
        worldId: intent.worldId,
        shardId: intent.shardId,
        actorId: intent.actorId,
        family: intent.category,
      })
    : [];

  const explicit = known.filter(
    (candidate) => candidate.entityId && intent.explicitEntityIds.includes(candidate.entityId),
  );
  const pool = explicit.length > 0 ? explicit : known;

  if (shouldClarify(intent, pool)) {
    return {
      status: "clarify_known_conflict",
      actor,
      conflictNames: pool.map((candidate) => candidate.name).slice(0, 3),
    };
  }

  if (pool.length === 1) {
    return { status: "bound", actor, target: toTarget(pool[0]), conflictNames: [] };
  }

  if (pool.length > 1 && (intent.selector === "nearest" || intent.selector === "any")) {
    const nearest = [...pool].sort((left, right) => left.distanceMeters - right.distanceMeters)[0];
    return { status: "bound", actor, target: toTarget(nearest), conflictNames: [] };
  }

  if (actor.lon === null || actor.lat === null || !intent.category) {
    return { status: "need_source", actor, conflictNames: [] };
  }

  const sourced = await ports.source.queryNearest({
    worldId: intent.worldId,
    family: intent.category,
    lon: actor.lon,
    lat: actor.lat,
    selector: intent.selector,
  });
  if (!sourced) {
    return { status: "need_source", actor, conflictNames: [] };
  }
  return {
    status: "materialize_from_source",
    actor,
    target: toTarget(sourced),
    conflictNames: [],
  };
}

function shouldClarify(intent: EngineIntent, pool: WorldCandidate[]) {
  if (pool.length < 2) return false;
  if (intent.selector === "nearest" || intent.selector === "any" || intent.selector === "here") {
    return false;
  }
  const places = new Set(
    pool.map((candidate) => `${candidate.lon ?? "?"}:${candidate.lat ?? "?"}:${candidate.entityId}`),
  );
  return places.size >= 2;
}

function toTarget(candidate: WorldCandidate): EngineBoundTarget {
  return {
    entityId: candidate.entityId,
    sourceKey: candidate.sourceKey,
    family: candidate.family,
    name: candidate.name,
    distanceMeters: candidate.distanceMeters,
    lon: candidate.lon,
    lat: candidate.lat,
    known: candidate.known,
    playable: candidate.playable,
  };
}
