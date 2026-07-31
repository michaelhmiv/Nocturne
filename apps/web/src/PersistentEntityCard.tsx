import type { PersistentSceneEntity } from "../../../packages/contracts/src/persistent-scene.js";

const presenceLabel: Record<PersistentSceneEntity["presence"], string> = {
  nearby: "Nearby",
  accompanying: "Accompanying you",
  carried: "With you",
  known_elsewhere: "Known elsewhere",
};

export function PersistentEntityCard({ entity }: { entity: PersistentSceneEntity }) {
  const name = entity.aliases[0] || entity.name;
  return (
    <article className="persistent-entity-card" data-entity-id={entity.entityId}>
      <div className="persistent-entity-card__header">
        <div>
          <strong>{name}</strong>
          {name !== entity.name ? <span className="persistent-entity-card__canonical">{entity.name}</span> : null}
        </div>
        <span className="persistent-entity-card__presence">{presenceLabel[entity.presence]}</span>
      </div>
      <dl className="persistent-entity-card__facts">
        <div>
          <dt>Location</dt>
          <dd>{entity.locationName || "Unknown"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{entity.statusSummary || entity.lifecycleStatus.replaceAll("_", " ")}</dd>
        </div>
        {entity.relationshipLabels.length ? (
          <div>
            <dt>Relationship</dt>
            <dd>{entity.relationshipLabels.map((label) => label.replaceAll("_", " ")).join(", ")}</dd>
          </div>
        ) : null}
        {entity.lastObservedAt ? (
          <div>
            <dt>Last observed</dt>
            <dd>{new Date(entity.lastObservedAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}
