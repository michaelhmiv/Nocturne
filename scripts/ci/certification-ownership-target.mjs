// Choose a real persistent entity for the narration-versus-ownership invariant.
// Starter apartments are deliberately sparse; a chair is not guaranteed to exist.
export function selectOwnershipClaimTarget(entities, residenceId) {
  const candidates = Array.isArray(entities) ? entities : [];
  const fixtures = candidates.filter(
    (entity) =>
      entity &&
      typeof entity.entityId === "string" &&
      typeof entity.name === "string" &&
      entity.name.trim(),
  );
  const fixture =
    fixtures.find((entity) => /chair/i.test(entity.name)) ||
    fixtures.find((entity) => /table|desk/i.test(entity.name));
  if (fixture) {
    return { entityId: fixture.entityId, spokenName: fixture.name };
  }
  if (typeof residenceId === "string" && residenceId.trim()) {
    return { entityId: residenceId, spokenName: "my current apartment" };
  }
  return null;
}
