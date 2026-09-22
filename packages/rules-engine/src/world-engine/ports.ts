import type { CategoryFamily, EngineIntent } from "@nocturne/contracts";

export type ActorSnapshot = {
  actorId: string;
  worldId: string;
  shardId: string;
  locationId: string | null;
  lon: number | null;
  lat: number | null;
  version: number;
  possessedIds: string[];
  restrained: boolean;
  conscious: boolean;
};

export type WorldCandidate = {
  entityId?: string;
  sourceKey?: string;
  family: CategoryFamily;
  name: string;
  distanceMeters: number;
  lon?: number;
  lat?: number;
  known: boolean;
  playable: boolean;
};

export type WorldQueryPort = {
  readActor(input: {
    worldId: string;
    shardId: string;
    actorId: string;
  }): Promise<ActorSnapshot | null>;
  listKnown(input: {
    worldId: string;
    shardId: string;
    actorId: string;
    family: CategoryFamily;
  }): Promise<WorldCandidate[]>;
};

export type SourcePort = {
  queryNearest(input: {
    worldId: string;
    family: CategoryFamily;
    lon: number;
    lat: number;
    selector: EngineIntent["selector"];
  }): Promise<WorldCandidate | null>;
};

export type WorldEnginePorts = {
  query: WorldQueryPort;
  source: SourcePort;
};
