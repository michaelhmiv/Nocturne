export function buildTimeline<
  Invention extends { characterId: string; createdAt: string },
  Action extends { createdAt: string },
>(characterId: string | undefined, inventions: Invention[], actions: Action[]) {
  if (!characterId) return [];
  return [
    ...inventions
      .filter((invention) => invention.characterId === characterId)
      .map((value) => ({ kind: "invention" as const, createdAt: value.createdAt, value })),
    ...actions.map((value) => ({ kind: "action" as const, createdAt: value.createdAt, value })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
