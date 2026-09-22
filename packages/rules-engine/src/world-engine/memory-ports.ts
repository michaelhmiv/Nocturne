import type { ActorSnapshot, SourcePort, WorldCandidate, WorldQueryPort } from "./ports.js";

export type MemoryWorld = {
  actors: ActorSnapshot[];
  known: WorldCandidate[];
  sources: WorldCandidate[];
};

export function createMemoryPorts(world: MemoryWorld): {
  query: WorldQueryPort;
  source: SourcePort;
} {
  const query: WorldQueryPort = {
    async readActor({ actorId, worldId, shardId }) {
      return (
        world.actors.find(
          (actor) =>
            actor.actorId === actorId && actor.worldId === worldId && actor.shardId === shardId,
        ) ?? null
      );
    },
    async listKnown({ family, worldId, shardId }) {
      return world.known.filter(
        (candidate) =>
          candidate.family === family &&
          candidate.known &&
          (!candidate.worldId || candidate.worldId === worldId) &&
          (!candidate.shardId || candidate.shardId === shardId),
      );
    },
  };

  const source: SourcePort = {
    async queryNearest({ family, lon, lat }) {
      const matches = world.sources.filter((candidate) => candidate.family === family);
      if (matches.length === 0) return null;
      const nearest = [...matches].sort((left, right) => {
        const leftDistance =
          left.distanceMeters || distanceMeters(lon, lat, left.lon ?? lon, left.lat ?? lat);
        const rightDistance =
          right.distanceMeters || distanceMeters(lon, lat, right.lon ?? lon, right.lat ?? lat);
        return leftDistance - rightDistance;
      })[0];
      return nearest ?? null;
    },
  };

  return { query, source };
}

function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earth = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}
