# Authoritative State Operations

Status: accepted for implementation

## Purpose

State operations are the only normal gameplay mechanism allowed to mutate the shared world. AI planners may propose operations, but only the authoritative executor may allocate IDs, authorize targets, lock rows, resolve symbolic references, enforce invariants, and commit state.

## Operation envelope

Every operation includes:

- a stable operation order;
- a typed operation payload;
- current fact preconditions;
- optional expected entity versions and expected locations;
- symbolic references to entities created earlier in the same branch;
- visibility classification for resulting facts;
- a reason suitable for the event audit trail.

The selected operation branch is executed atomically. No operation in a rejected or unselected branch may affect state.

## Supported operation families

The universal executor must support at least:

- `create_definition`
- `create_revision`
- `create_instance`
- `retire_entity`
- `move_entity`
- `transfer_possession`
- `transfer_ownership`
- `set_controller`
- `set_relation`
- `remove_relation`
- `set_access`
- `set_condition`
- `adjust_condition`
- `adjust_resource`
- `set_state_value`
- `remove_state_value`
- `create_information_asset`
- `invalidate_information_asset`
- `schedule_timed_work`
- `cancel_timed_work`
- `apply_area_effect`
- `remove_area_effect`

An operation type must not be advertised by contracts unless the executor implements it.

## Symbolic references

AI output never supplies authoritative UUIDs for new records. It may declare local symbols:

```json
{
  "type": "create_instance",
  "symbol": "found_dog",
  "definitionRef": "domestic_dog"
}
```

Later operations may reference `found_dog`. The executor allocates the real ID and returns the symbol map in the mutation receipt.

Symbols are branch-local, unique, bounded, and cannot shadow current entity references.

## Authorization sources

Operations may be authorized by:

- direct control over the actor;
- ownership, possession, custody, or delegated access;
- a resolved action branch that authorizes a bounded effect on another entity;
- an authoritative scheduled action;
- a world-simulation policy;
- an administrative repair scope.

Visibility alone never grants mutation authority.

## Transaction protocol

1. Validate the operation branch and declared facts.
2. Resolve existing references and symbolic dependencies.
3. Determine all affected rows and acquire locks in stable order.
4. Reload facts, locations, lifecycle states, relations, quantities, and versions.
5. Reject stale or unmet preconditions.
6. Validate world and shard consistency.
7. Allocate IDs.
8. Apply operations in order.
9. Increment entity versions for material mutations.
10. Insert the event and operation results.
11. Insert the immutable mutation receipt.
12. Commit.

A failure rolls back the event, entities, relations, schedules, resources, and knowledge together.

## Idempotency

The executor is keyed by a world-scoped idempotency key. On replay:

- an exact prior request returns the original receipt;
- a conflicting payload using the same key is rejected;
- no new IDs are allocated;
- no versions are incremented;
- no schedule is duplicated.

## Mutation receipt

The receipt contains:

- event ID;
- world and shard;
- source actor, intent, plan, and step where applicable;
- operation results in order;
- allocated symbol-to-ID mappings;
- previous and resulting versions;
- changed locations;
- created, updated, and removed relations;
- resource and condition changes;
- scheduled work IDs;
- created or invalidated knowledge assets;
- player-visible committed facts;
- authoritative hidden committed facts;
- narration constraints.

Narrators consume this receipt rather than the original AI proposal.

## Physical rules

- `move_entity` changes one immediate physical location.
- An entity cannot be moved to itself or create a containment cycle.
- Destinations must be location-capable or container-capable entities.
- Carried and contained entities derive effective location through containment.
- Movement of a carrier does not require rewriting every contained entity's immediate location.
- Cohort travel validates each participant and commits the cohort under one event.

## Relation rules

Relations use normalized mechanical families and bounded parameters. Repeated `set_relation` operations are idempotent updates, not duplicate rows. Exclusive relation families, such as immediate containment, must be enforced by the executor.

## Entity lifecycle

Retirement never deletes event history. Dead, destroyed, merged, or retired entities remain addressable for history and knowledge. Attempts to perform incompatible actions are rejected based on lifecycle state.

## Administrative repair

Administrative actions use the same operation engine with elevated scope. Where possible they create compensating events rather than silently rewriting historical events. The receipt must identify the operator and repair reason.
