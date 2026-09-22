import { describe, expect, it } from "vitest";
import { inventedSuccess, primitiveForKind } from "./engine-intent.js";

describe("engine intent constitution", () => {
  it("maps every world-action kind onto a sandbox primitive", () => {
    expect(primitiveForKind("move")).toBe("travel");
    expect(primitiveForKind("search")).toBe("search");
    expect(primitiveForKind("transfer")).toBe("transfer");
    expect(primitiveForKind("combat")).toBe("damage");
    expect(primitiveForKind("question")).toBe("perceive");
  });

  it("treats mutations on unresolved binds as invented success", () => {
    expect(
      inventedSuccess({ status: "need_source", operations: [{ type: "move_entity" } as never] }),
    ).toBe(true);
    expect(inventedSuccess({ status: "need_source", operations: [] })).toBe(false);
    expect(
      inventedSuccess({ status: "bound", operations: [{ type: "move_entity" } as never] }),
    ).toBe(false);
  });
});
