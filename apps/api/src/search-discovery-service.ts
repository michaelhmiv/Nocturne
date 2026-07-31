import { createHash } from "node:crypto";
import {
  SearchDiscoveryResultSchema,
  type MaterializationAnalysisRequest,
  type SearchDiscoveryResult,
  type UniversalWorldOperation,
} from "@nocturne/contracts";
import {
  analyzeMaterialization,
  analyzeSearchDiscovery,
  type AiProviderClient,
} from "@nocturne/ai-gm";
import type {
  MaterializationStore,
  RelevanceContextStore,
  UniversalOperationExecutor,
  WorldScope,
} from "@nocturne/database";
import { resolveContest } from "@nocturne/rules-engine";

export class SearchDiscoveryServiceError extends Error {
  constructor(
    readonly code:
      "invalid_area" | "analysis_rejected" | "materialization_rejected" | "unsupported_outcome",
    message: string,
  ) {
    super(message);
    this.name = "SearchDiscoveryServiceError";
  }
}

function seedFor(secret: string | Buffer, idempotencyKey: string) {
  return createHash("sha256")
    .update(secret)
    .update("search-discovery-v1")
    .update(idempotencyKey)
    .digest("hex");
}

function outcomeText(
  grade: ReturnType<typeof resolveContest>["outcomeGrade"],
  analysis: Awaited<ReturnType<typeof analyzeSearchDiscovery>>["data"],
) {
  switch (grade) {
    case "complete_success":
      return analysis.successDescription;
    case "success_with_consequence":
      return analysis.consequenceDescription;
    case "partial_success":
      return analysis.partialDescription;
    case "failure_with_progress":
      return analysis.progressDescription;
    case "failure":
      return analysis.failureDescription;
    case "catastrophic_reversal":
      return analysis.reversalDescription;
  }
}

export function createSearchDiscoveryService(dependencies: {
  client: Pick<AiProviderClient, "generateStructured">;
  context: RelevanceContextStore;
  materialization: MaterializationStore;
  executor: UniversalOperationExecutor;
  rollSecret: string | Buffer;
  loadReusableDefinitions(input: {
    scope: Pick<WorldScope, "worldId">;
    requestedConcept: string;
  }): Promise<MaterializationAnalysisRequest["reusableDefinitions"]>;
  loadArea(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    areaId: string;
  }): Promise<{ name: string; description: string } | null>;
}) {
  async function execute(input: {
    scope: WorldScope;
    actorId: string;
    areaId: string;
    rawText: string;
    requestedConcept: string;
    idempotencyKey: string;
  }): Promise<SearchDiscoveryResult> {
    const area = await dependencies.loadArea({ scope: input.scope, areaId: input.areaId });
    if (!area) throw new SearchDiscoveryServiceError("invalid_area", "Search area not found.");

    const context = await dependencies.context.compile({
      scope: input.scope,
      viewpointId: input.actorId,
      command: input.rawText,
      explicitEntityIds: [input.areaId],
    });
    const existingCandidates = await dependencies.materialization.findExistingCompatible({
      scope: input.scope,
      locationId: input.areaId,
      requestedConcept: input.requestedConcept,
      viewpointId: input.actorId,
    });
    const sourceCandidates = await dependencies.materialization.listSources({
      scope: input.scope,
      locationId: input.areaId,
    });
    const actorFacts = context.playerKnownFacts
      .filter(({ entityId }) => entityId === input.actorId)
      .map(({ factId, claim, value }) => `${factId}: ${claim}=${JSON.stringify(value)}`)
      .slice(0, 32);
    const areaFacts = [...context.playerKnownFacts, ...context.authoritativeHiddenFacts]
      .filter(({ entityId }) => entityId === input.areaId)
      .map(({ factId, claim, value }) => `${factId}: ${claim}=${JSON.stringify(value)}`)
      .slice(0, 32);

    const analyzed = await analyzeSearchDiscovery(dependencies.client, {
      rawText: input.rawText,
      actorId: input.actorId,
      areaId: input.areaId,
      areaName: area.name,
      areaDescription: area.description,
      requestedConcept: input.requestedConcept,
      actorFacts,
      areaFacts,
      existingCandidates: existingCandidates.map((candidate) => ({
        entityId: candidate.entityId,
        name: candidate.name,
        conceptSummary: candidate.conceptSummary,
        hidden: !candidate.alreadyObserved,
        concealment: Number(candidate.state.concealment || 0),
        supportingFactIds: context.authoritativeHiddenFacts
          .filter(({ entityId }) => entityId === candidate.entityId)
          .map(({ factId }) => factId)
          .slice(0, 24),
      })),
      materializationSourceIds: sourceCandidates.map(({ sourceId }) => sourceId),
    });
    const analysis = analyzed.data;
    const resolution = resolveContest({
      actionType: "search_discovery",
      actorScore: analysis.actorScore,
      targetScore: analysis.targetScore,
      modifiers: analysis.modifiers,
      seed: seedFor(dependencies.rollSecret, input.idempotencyKey),
      uncertaintyRange: 3,
      maxModifierTotal: 10,
    });
    const outcomeFact = outcomeText(resolution.outcomeGrade, analysis);
    const discoverable = ["complete_success", "success_with_consequence"].includes(
      resolution.outcomeGrade,
    );
    let discoveredEntityId: string | undefined;
    let materialized = false;
    const informationIds: string[] = [];

    if (discoverable && analysis.selectedExistingEntityId) {
      discoveredEntityId = analysis.selectedExistingEntityId;
    } else if (discoverable && analysis.mayMaterialize) {
      const request = await dependencies.materialization.beginRequest({
        scope: input.scope,
        idempotencyKey: `${input.idempotencyKey}:materialization-request`,
        actorId: input.actorId,
        locationId: input.areaId,
        requestedConcept: input.requestedConcept,
        authoritativeContext: {
          contextCompilationId: context.compilationId,
          searchOutcomeGrade: resolution.outcomeGrade,
        },
      });
      const selectedSource = sourceCandidates.find(
        ({ sourceId }) => sourceId === analysis.selectedMaterializationSourceId,
      );
      if (!selectedSource) {
        throw new SearchDiscoveryServiceError(
          "analysis_rejected",
          "Search selected an unavailable materialization source.",
        );
      }
      const reusableDefinitions = await dependencies.loadReusableDefinitions({
        scope: input.scope,
        requestedConcept: input.requestedConcept,
      });
      const proposed = await analyzeMaterialization(dependencies.client, {
        requestedConcept: input.requestedConcept,
        locationId: input.areaId,
        locationName: area.name,
        locationDescription: area.description,
        worldContext: {
          searchOutcomeGrade: resolution.outcomeGrade,
          contextCompilationId: context.compilationId,
        },
        sourceCandidates: [selectedSource],
        reusableDefinitions,
      });
      const sourceFactIds = context.authoritativeHiddenFacts
        .filter(({ claim }) => claim === "materialization_source")
        .map(({ factId }) => factId)
        .slice(0, 16);
      if (proposed.data.decision === "reject") {
        await dependencies.materialization.commitProposal({
          scope: input.scope,
          requestId: request.request_id,
          idempotencyKey: `${input.idempotencyKey}:materialization`,
          actorId: input.actorId,
          locationId: input.areaId,
          proposal: proposed.data,
          preconditionFactIds: sourceFactIds,
        });
        throw new SearchDiscoveryServiceError(
          "materialization_rejected",
          proposed.data.rejectionReason || "Materialization was rejected by authoritative policy.",
        );
      }
      const committed = await dependencies.materialization.commitProposal({
        scope: input.scope,
        requestId: request.request_id,
        idempotencyKey: `${input.idempotencyKey}:materialization`,
        actorId: input.actorId,
        locationId: input.areaId,
        proposal: proposed.data,
        preconditionFactIds: sourceFactIds,
      });
      if (committed.kind !== "materialized") {
        throw new SearchDiscoveryServiceError(
          "unsupported_outcome",
          "Search materialization did not produce an entity.",
        );
      }
      discoveredEntityId = committed.entityId;
      materialized = true;
    }

    const operationPreconditions = [
      ...context.playerKnownFacts,
      ...context.authoritativeHiddenFacts,
    ]
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .map(({ factId }) => factId)
      .slice(0, 16);
    const operations: UniversalWorldOperation[] = [];
    if (discoveredEntityId) {
      operations.push({
        type: "set_relation",
        sourceRef: { kind: "existing", entityId: input.actorId },
        targetRef: { kind: "existing", entityId: discoveredEntityId },
        relationType: "observed",
        parameters: {
          visibility: "player_known",
          outcomeGrade: resolution.outcomeGrade,
          searchAreaId: input.areaId,
        },
        preconditionFactIds: operationPreconditions,
      });
    }
    operations.push({
      type: "create_information_asset",
      holderRef: { kind: "existing", entityId: input.actorId },
      ...(discoveredEntityId
        ? { subjectRef: { kind: "existing" as const, entityId: discoveredEntityId } }
        : {}),
      content: outcomeFact,
      confidenceBasisPoints:
        resolution.outcomeGrade === "complete_success"
          ? 10_000
          : resolution.outcomeGrade === "success_with_consequence"
            ? 8_500
            : resolution.outcomeGrade === "partial_success"
              ? 6_000
              : resolution.outcomeGrade === "failure_with_progress"
                ? 4_500
                : 2_000,
      truthStatus: discoveredEntityId ? "observation" : "inference",
      preconditionFactIds: operationPreconditions,
    });

    const receipt = await dependencies.executor.execute({
      scope: input.scope,
      authority: "player",
      actorId: input.actorId,
      idempotencyKey: `${input.idempotencyKey}:discovery-result`,
      declaredFactIds: operationPreconditions,
      branch: { operations },
      playerVisibleFacts: [outcomeFact],
      hiddenFacts: analysis.assumptions,
    });
    const informationResult = receipt.operationResults.find(
      (result) => result.type === "create_information_asset",
    );
    if (typeof informationResult?.informationId === "string") {
      informationIds.push(informationResult.informationId);
    }

    if (discoveredEntityId) {
      await dependencies.context.markSalient({
        scope: input.scope,
        viewpointId: input.actorId,
        entityId: discoveredEntityId,
        score: 8_000,
        reasons: ["recent_event", "explicit_reference"],
        sourceEventId: receipt.eventId,
      });
    }

    return SearchDiscoveryResultSchema.parse({
      eventId: receipt.eventId,
      outcomeGrade: resolution.outcomeGrade,
      discoveredEntityId,
      materialized,
      informationIds,
      playerVisibleFacts: [outcomeFact],
      narrationConstraints: [
        "Do not claim ownership, control, following, trust, capture, or acquisition unless separately committed.",
        ...(discoveredEntityId
          ? ["Describe only the discovered entity and committed observation."]
          : ["Do not narrate a concrete entity as present."]),
      ],
    });
  }

  return { execute };
}

export type SearchDiscoveryService = ReturnType<typeof createSearchDiscoveryService>;
