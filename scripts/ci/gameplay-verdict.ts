/** Fail-closed player-outcome gate. A 200, request ID or generated prose is not a successful turn. */
type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const failureText =
  /(?:\bdo not accomplish\b|\bdid not accomplish\b|\bno matching source\b|\bcannot be transferred\b|\bno (?:\w+\s+){0,5}was acquired\b|\bno effect\b|\bnot able to\b)/i;

export type GameplayExpectation = "observation" | "consumption";

export function gameplayOutcomeDefects(
  result: Json,
  dashboard: Json,
  expectation: GameplayExpectation,
): string[] {
  const defects: string[] = [];
  if (result.state !== "completed") {
    defects.push("turn_not_completed");
    return defects;
  }
  const narration = result.narration;
  if (typeof narration !== "string" || !narration.trim()) {
    defects.push("missing_narration");
  } else if (failureText.test(narration)) {
    defects.push("objective_not_accomplished");
  }
  const ids = array(result.eventIds).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0) defects.push("missing_committed_event");
  const plan = record(result.plan);
  if (
    array(plan.steps).some((step) => {
      const s = record(step);
      return (
        ["failed", "cancelled"].includes(String(s.status)) ||
        ["failure", "no_effect"].includes(String(s.outcomeGrade))
      );
    })
  )
    defects.push("step_did_not_succeed");

  const effects = record(dashboard.effects);
  const events = array(effects.events).map(record);
  const linked = events.filter((event) => ids.includes(String(event.eventId)));
  if (ids.length > 0 && linked.length !== ids.length) {
    defects.push("committed_event_missing_from_player_history");
  }
  if (
    expectation === "consumption" &&
    !linked.some((event) =>
      array(event.effects).some((effect) => {
        const e = record(effect);
        return (
          (e.type === "quantity_changed" &&
            e.change === "consumed" &&
            typeof e.delta === "number" &&
            e.delta < 0) ||
          (e.type === "resource_changed" && typeof e.delta === "number" && e.delta !== 0)
        );
      }),
    )
  )
    defects.push("consumption_has_no_verified_effect");
  return defects;
}
