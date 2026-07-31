import { analyzeLazySimulation, type AiProviderClient } from "@nocturne/ai-gm";
import type {
  LazySimulationStore,
  UniversalOperationExecutor,
  WorldScope,
} from "@nocturne/database";

export class LazySimulationServiceError extends Error {
  constructor(
    readonly code: "stale_entity" | "invalid_proposal" | "processing_error",
    message: string,
  ) {
    super(message);
    this.name = "LazySimulationServiceError";
  }
}

export function createLazySimulationService(dependencies: {
  client: Pick<AiProviderClient, "generateStructured">;
  store: LazySimulationStore;
  executor: UniversalOperationExecutor;
}) {
  async function simulate(input: {
    scope: WorldScope;
    entityId: string;
    leaseOwner: string;
    forceIfRelevant?: boolean;
    relevantFacts?: string[];
    accessibleLocationIds?: string[];
  }) {
    const claim = await dependencies.store.claim({
      scope: input.scope,
      entityId: input.entityId,
      leaseOwner: input.leaseOwner,
      forceIfRelevant: input.forceIfRelevant,
      relevantFacts: input.relevantFacts,
      accessibleLocationIds: input.accessibleLocationIds,
    });
    if (!claim) return null;

    try {
      const analyzed = await analyzeLazySimulation(dependencies.client, claim.request);
      const proposal = analyzed.data;
      if (proposal.decision === "no_change") {
        return dependencies.store.completeNoChange({
          scope: input.scope,
          claim,
          leaseOwner: input.leaseOwner,
          proposal,
          nextSimulationSeconds: proposal.nextSimulationSeconds,
        });
      }
      const operations = proposal.operations.map((operation) => {
        if (
          "expectedVersion" in operation &&
          operation.expectedVersion === undefined
        ) {
          return { ...operation, expectedVersion: claim.entityVersion };
        }
        return operation;
      });
      const receipt = await dependencies.executor.execute({
        scope: input.scope,
        authority: "world_simulation",
        idempotencyKey: claim.idempotencyKey,
        declaredFactIds: [],
        branch: {
          operations: operations.map((operation) => ({
            ...operation,
            preconditionFactIds: [],
          })),
        },
        playerVisibleFacts: [],
        hiddenFacts: [proposal.summary, ...proposal.assumptions],
      });
      return dependencies.store.completeCommitted({
        scope: input.scope,
        claim,
        leaseOwner: input.leaseOwner,
        proposal,
        receiptId: receipt.receiptId,
        eventId: receipt.eventId,
        nextSimulationSeconds: proposal.nextSimulationSeconds,
      });
    } catch (error) {
      const code =
        error instanceof Error && /stale/i.test(error.message)
          ? "stale_entity"
          : error instanceof Error && /proposal|operation/i.test(error.message)
            ? "invalid_proposal"
            : "processing_error";
      await dependencies.store.fail({
        claim,
        leaseOwner: input.leaseOwner,
        errorCode: code,
      }).catch(() => {});
      throw new LazySimulationServiceError(
        code,
        error instanceof Error ? error.message : "Lazy simulation failed.",
      );
    }
  }

  return { simulate };
}

export type LazySimulationService = ReturnType<typeof createLazySimulationService>;
