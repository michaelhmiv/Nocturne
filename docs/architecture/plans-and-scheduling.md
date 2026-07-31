# Durable Plans and Scheduling

Status: accepted for implementation

## Purpose

A compound command may cross travel, waiting, crafting, sleep, dialogue, checks, and changing shared-world state. The plan must therefore be a durable database object rather than an in-memory sequence.

## Plan states

Plans use:

- `planned`
- `running`
- `waiting_for_time`
- `waiting_for_world_event`
- `waiting_for_clarification`
- `blocked`
- `completed`
- `partially_completed`
- `failed`
- `cancelled`
- `superseded`

Steps use:

- `pending`
- `ready`
- `running`
- `waiting`
- `completed`
- `failed`
- `cancelled`
- `superseded`

## Dependencies

Dependencies are explicit and are not limited to the immediately preceding step. Supported dependency conditions include:

- prior step completed;
- prior step succeeded to an accepted grade;
- actor arrived at a destination;
- entity is present;
- entity or resource was acquired;
- time elapsed;
- event occurred;
- clarification supplied;
- access relation exists.

## Exclusive actor plan

An actor may have one exclusive physical plan. Background work may coexist only where the domain policy marks it compatible.

A conflicting command must explicitly:

- continue the current plan;
- pause it;
- cancel it;
- supersede it;
- or run as compatible background work.

No plan is silently abandoned or allowed to continue after a conflicting command without a persisted decision.

## Scheduling

Timed work is represented by authoritative scheduled records linked to the source event, plan, step, subjects, expected versions, resolution policy, and due time.

The worker never directly updates gameplay fields. It claims due work and invokes an authoritative resolver that revalidates state, commits a normal event and mutation receipt, and resumes dependent plans.

## Resumption protocol

Before a waiting step resumes:

1. Verify the plan is active and not superseded.
2. Reload actor lifecycle and control.
3. Recompile context.
4. Re-resolve references where required.
5. Validate entity versions, locations, access, possession, and presence.
6. Reauthorize the step against current shared-world state.
7. Execute, replan, request clarification, block, or terminate.

A plan never blindly replays an old target after time has passed.

## Idempotency

Every plan and step has stable idempotency keys. Scheduled delivery, worker restart, API retry, and client polling cannot execute the same step twice.

## Example

For `Walk into the street and attack him`:

1. A movement step is created and schedules travel.
2. The movement step waits for arrival.
3. The attack step remains blocked by an arrival dependency.
4. Arrival commits an event through the authoritative scheduler.
5. The plan resumes.
6. The target is re-resolved and presence is checked.
7. The attack proceeds only if still valid.

The attack is not permanently skipped merely because travel was pending.

## Failure and cancellation

Scheduled and plan failures distinguish stale state, supersession, cancellation, missing targets, invalid destinations, actor incapacity, domain rejection, and transient infrastructure failure. Only transient infrastructure failures are automatically retried.

Cancellation itself is an event. Partially completed effects remain authoritative unless a compensating action reverses them.
