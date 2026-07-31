const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";

const completedPersistentJobs = new Map<string, Record<string, unknown>>();

function issueMessage(issue: unknown): string | null {
  if (!issue || typeof issue !== "object") return null;
  const value = issue as Record<string, unknown>;
  const path = Array.isArray(value.path) ? value.path.join(".") : "";
  const message = typeof value.message === "string" ? value.message : "";
  if (!message) return null;
  return path ? `${path}: ${message}` : message;
}

function playerFacingError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback || "Game request failed.";
  const value = payload as Record<string, unknown>;
  const code = String(value.error || "");
  const message = typeof value.message === "string" ? value.message : "";
  const issues = Array.isArray(value.issues)
    ? value.issues.map(issueMessage).filter((issue): issue is string => Boolean(issue))
    : [];

  if (issues.length) return issues.slice(0, 3).join(" · ");
  if (["timeout", "rate_limited", "provider_failure", "malformed_response", "validation"].includes(code)) {
    return "Nocturne could not resolve this turn yet. No in-world failure was committed.";
  }
  if (code.startsWith("ai_")) return message || "The AI provider could not resolve this turn.";
  if (code === "legacy_action_route_disabled") {
    return "The game client is stale. Refresh the page and retry through the persistent-world runtime.";
  }
  if (code === "forbidden") return message || "You do not have access to that part of the world.";
  if (code === "idempotency_conflict") return "That action key was already used for a different request.";
  if (code === "not_found") return message || "That part of the world could not be found.";
  return message || code || fallback || "Game request failed.";
}

async function requestJson(path: string, init: RequestInit | undefined, guest: boolean) {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (guest) headers.set("x-nocturne-guest-mode", "1");

  const response = await fetch(`/api/game/${path}`, { ...init, headers });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) throw new Error(playerFacingError(payload, text));
  return payload;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function persistentResultAsLegacyJob(
  rawText: string,
  resultValue: unknown,
): Record<string, unknown> {
  const result = object(resultValue);
  if (!result || typeof result.requestId !== "string" || typeof result.state !== "string") {
    throw new Error("Persistent-world runtime returned an invalid action result.");
  }
  const plan = object(result.plan);
  const planSteps = Array.isArray(plan?.steps) ? plan.steps.map(object).filter(Boolean) : [];
  const eventIds = Array.isArray(result.eventIds)
    ? result.eventIds.filter((value): value is string => typeof value === "string")
    : [];
  const steps = planSteps.length
    ? planSteps.map((step, index) => {
        const status = String(step!.status || "pending");
        const outcomeGrade =
          typeof step!.outcomeGrade === "string"
            ? step!.outcomeGrade
            : status === "completed"
              ? "complete_success"
              : status === "waiting"
                ? "waiting"
                : "pending";
        return {
          stepId: String(step!.stepId || `${result.requestId}:${index + 1}`),
          order: Number(step!.order || index + 1),
          rawText,
          actionType: String(step!.kind || "interact"),
          objective: String(step!.description || rawText),
          dependsOnPreviousSuccess: index > 0,
          status: "completed",
          outcomeGrade,
          ...(eventIds[index] ? { eventId: eventIds[index] } : {}),
          narration:
            typeof step!.waitingReason === "string"
              ? step!.waitingReason
              : typeof result.narration === "string"
                ? result.narration
                : "",
        };
      })
    : [
        {
          stepId: `${result.requestId}:1`,
          order: 1,
          rawText,
          actionType: "clarification",
          objective: rawText,
          dependsOnPreviousSuccess: false,
          status: "completed",
          outcomeGrade: "clarification_required",
          narration: typeof result.prompt === "string" ? result.prompt : "Clarification is required.",
        },
      ];
  const grades = steps.map((step) => String(step.outcomeGrade));
  const overallStatus =
    result.state !== "completed" || grades.includes("no_effect") || grades.includes("waiting")
      ? "partial_success"
      : grades.every((grade) => ["failure", "catastrophic_reversal"].includes(grade))
        ? "failure"
        : grades.some((grade) => ["failure", "catastrophic_reversal"].includes(grade))
          ? "partial_success"
          : "complete_success";
  const narration =
    typeof result.narration === "string"
      ? result.narration
      : typeof result.prompt === "string"
        ? result.prompt
        : "The persistent-world action was processed.";
  const legacyResult = {
    planId: typeof plan?.planId === "string" ? plan.planId : result.requestId,
    rawText,
    summary:
      result.state === "waiting_for_clarification"
        ? "Clarification required"
        : result.state === "waiting"
          ? "Action remains in progress"
          : "Persistent-world action resolved",
    overallStatus,
    steps,
    narration,
    finalState: {
      locationId: null,
      actorStatus: typeof plan?.status === "string" ? plan.status : result.state,
      pendingTravelTo: null,
    },
    idempotentReplay: false,
  };
  return {
    jobId: result.requestId,
    kind: "action_resolution",
    status: "completed",
    attempts: 1,
    maxAttempts: 1,
    result: legacyResult,
    errorCode: null,
  };
}

export async function gameFetch<T>(
  path: string,
  init?: RequestInit,
  guest = guestMode,
): Promise<T> {
  if (path === "ai-jobs/actions" && (init?.method || "GET").toUpperCase() === "POST") {
    const input = object(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);
    const rawText = typeof input?.rawText === "string" ? input.rawText : "";
    const actorId = typeof input?.actorId === "string" ? input.actorId : undefined;
    const persistent = await requestJson(
      "persistent-world/actions",
      {
        ...init,
        body: JSON.stringify({ command: rawText, ...(actorId ? { actorId } : {}) }),
      },
      guest,
    );
    const job = persistentResultAsLegacyJob(rawText, persistent);
    completedPersistentJobs.set(String(job.jobId), job);
    return job as T;
  }

  const completedJobMatch = path.match(/^ai-jobs\/([0-9a-f-]{36})$/i);
  if (completedJobMatch) {
    const job = completedPersistentJobs.get(completedJobMatch[1]!);
    if (job) return job as T;
  }

  return (await requestJson(path, init, guest)) as T;
}
