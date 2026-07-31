import { describe, expect, it } from "vitest";
import { buildActionPlanPrompt, deterministicActionPlanFallback } from "./action-planner.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const locationId = "20000000-0000-4000-8000-000000000001";

describe("ordered action planning", () => {
  it("instructs the model to keep consumption and travel independent", () => {
    const prompt = buildActionPlanPrompt(
      {
        actorId,
        rawText: "Eat 5 bowls of oatmeal and then walk to the gas station",
        targetLocationId: locationId,
      },
      { currentLocationName: "Foundry Row" },
    );
    expect(prompt).toContain("multiple sequential verbs");
    expect(prompt).toContain("dependsOnPreviousSuccess=false");
    expect(prompt).toContain("There is no item or food catalogue");
  });

  it("decomposes the regression command into consume then move", () => {
    const plan = deterministicActionPlanFallback(
      {
        actorId,
        rawText: "Eat 5 bowls of oatmeal and then walk to the gas station",
        targetLocationId: locationId,
      },
      "",
      locationId,
    );
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps.map((step) => step.actionType)).toEqual(["consume", "move"]);
    expect(plan.steps[1]?.dependsOnPreviousSuccess).toBe(false);
    expect(plan.steps[0]?.rawText).toContain("5 bowls");
    expect(plan.steps[1]?.rawText).toContain("gas station");
  });

  it("marks an enter step dependent on a preceding unlock step", () => {
    const plan = deterministicActionPlanFallback(
      {
        actorId,
        rawText: "Unlock the service door, then enter the building",
        targetLocationId: locationId,
      },
      "",
      locationId,
    );
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1]?.dependsOnPreviousSuccess).toBe(true);
  });
});
