# Architecture

## Core boundary

Nocturne uses a hybrid AI and deterministic architecture.

The AI may:

- interpret freeform player intent;
- draft novel content definitions;
- select potentially relevant approved rules;
- propose bounded situational modifiers and consequence options;
- generate dialogue, descriptions, and narration; and
- summarize committed events.

The AI may not:

- grant an unowned capability or item;
- create knowledge that a viewpoint does not possess;
- bypass ownership, access, resource, range, consent, or physical requirements;
- choose or reroll authoritative randomness;
- directly write game state; or
- impose protected permanent consequences without backend authorization.

## Universal content

Preset powers, weapons, skills, vehicles, and modules are examples rather than allowed-content lists. New concepts are composed from:

- unrestricted fictional flavor;
- traits;
- effect bindings;
- modes;
- requirements;
- resource costs;
- limitations;
- risks;
- generated signatures;
- counters;
- relationships; and
- optional typed extension data.

The stable model is `definition -> revision -> instance`.

## AI task lanes

Authoritative tasks use server-controlled model policy:

- action-intent parsing;
- content normalization;
- adjudication proposals;
- NPC planning; and
- persistent-memory summaries.

Player-selectable models are limited to creative tasks such as narration, private assistant conversations, and invention brainstorming. A user-selected model may draft an idea, but the authoritative content-normalization pipeline validates it before persistence.

## Data authority

Railway PostgreSQL is the authoritative store. Game changes are committed as append-only events with derived current-state tables. The web client does not write core game tables directly.

Better Auth uses the same PostgreSQL service with an isolated `auth` schema. Game tables use the `game` schema and system/worker records use the `system` schema.

## Service topology

- Web: presentation, authentication route, and non-authoritative creative interactions.
- API: authenticated commands, validation, resolution, and event commitment.
- Worker: queued AI work, world clocks, NPC planning, and long-running jobs.
- PostgreSQL: authoritative world state, events, auth, and job records.
