# Player dashboard and effect history

## Governing invariant

Every committed mechanic that is visible to the player must be represented consistently in three places:

1. the action result or immediate turn presentation;
2. the character's current player-safe dashboard state;
3. the chronological event/effect history.

All three representations must derive from the same authoritative event or mutation receipt. The dashboard and effect projection may summarize committed records, but they may not independently adjudicate effects, invent state changes, or reinterpret an uncommitted AI proposal.

## Player-safe effect projection

`GET /v1/persistent-world/effects` returns a selected-character, world-scoped projection of recent committed events. Supported normalized effects include:

- resource changes;
- condition application, update, and removal;
- item or consumable quantity changes;
- resolved risks;
- location changes;
- relationship changes;
- explicit player-visible committed facts.

An event may legitimately have no normalized mechanical effects. Dialogue and narrative-only events must not manufacture changes merely to populate the dashboard.

The event ledger remains authoritative. The effect feed is rebuildable from event payloads, universal-operation results, mutation receipts, and player-visible facts.

## Canonical dashboard

`GET /v1/persistent-world/dashboard` combines:

- the controlled character's current authoritative condition and player-safe state;
- tracked resources and active conditions;
- inventory, skills, faction standing, cash, heat, warrant, and status;
- current location hierarchy;
- nearby, accompanying, carried, and known-elsewhere entities;
- active plans and scheduled work;
- recent normalized effects;
- resource-history series keyed to authoritative event IDs.

The dashboard must not expose raw hidden state, private NPC facts, AI prompts, semantic-analysis payloads, unresolved probabilities, hidden simulation reasoning, or operator-only context.

## Operator inspector

`GET /v1/operator/world/entities/:entityId` and
`GET /v1/operator/world/dashboard/:actorId` are restricted to owner/operator world roles. They may expose authoritative state, versions, provenance, relations, request-stage traces, plans, schedules, simulation runs, and context inclusion reasons for diagnosis.

The browser inspector is read-only. Repairs continue through the existing version-checked operator repair endpoint and must create audited authoritative operations or compensating events. Arbitrary JSON editing is prohibited.

## Required certification

A dashboard-affecting mechanic is incomplete until tests establish:

- the authoritative event or receipt contains the mechanical change;
- normalization preserves the event ID, effect key, delta, and resulting value when available;
- current dashboard state agrees with the event result;
- history references the same event ID;
- idempotent replay does not duplicate history or apply the change twice;
- no-effect events remain no-effect;
- player routes reject an uncontrolled or non-selected actor;
- operator routes reject non-operator roles;
- player-facing dashboard views remain usable on mobile layouts;
- hidden and operator-only fields do not enter player-safe contracts.

These checks run as part of the required capability and workspace certification gates, not as advisory coverage.

Consumption certification must cover quantity, resource deltas, conditions, and resolved risks. Movement certification must cover scheduled state and authoritative arrival. Commerce, combat, relationships, inventory, legal heat, and other mechanics must add equivalent effect assertions when their authoritative handlers expose those operations.
