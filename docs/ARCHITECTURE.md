# Architecture

## Product and core boundary

Nocturne is an AI GM for a persistent multiplayer comic-book world. Character creation and all play use one natural-language conversation. There are no Invent/Act modes or client-directed game workflows, and the GM does not append canned next-step coaching. The dashboard is a read-only, player-safe view of committed world state.

Nocturne uses a hybrid AI and deterministic architecture:

> The AI interprets and proposes. The backend validates, rolls, commits, and redacts. The AI then narrates only committed player-safe results.

The authoritative path is:

`message -> authoritative/viewpoint context -> structured LLM proposal -> backend validation -> server roll -> atomic commit -> safe narration`

See [Conversational engine](CONVERSATIONAL_ENGINE.md) for the complete contract, probability scale, fact and visibility rules, and client boundary.

The AI may:

- infer intent from ordinary conversation, including character creation, dialogue, questions, inventions, actions, and out-of-character discussion;
- draft novel content definitions;
- decompose an action into only its meaningful uncertain checks;
- propose exact, fact-cited apparent and authoritative probabilities, stakes, outcomes, and allowlisted operations;
- select potentially relevant approved rules;
- generate dialogue, descriptions, and narration constrained to committed events; and
- summarize committed events.

The AI may not:

- grant an unowned capability or item;
- create knowledge that a viewpoint does not possess;
- bypass ownership, access, resource, time, location, range, consent, or physical requirements;
- fabricate context facts or cite facts the backend did not supply;
- choose, see, or reroll authoritative randomness;
- directly write game state;
- expose authoritative-hidden facts or adjustments; or
- impose protected permanent consequences without backend authorization.

## Conversation and adjudication authority

The API receives a conversation ID, raw message, and idempotency key scoped to that authenticated user and conversation. Reusing a key with a different canonical request is rejected. It selects the user's active character when one exists, assembles current facts, and runs two isolated server-controlled model passes: a viewpoint pass sees only player-known facts and freezes apparent probabilities and visible reasoning; an authoritative pass sees that frozen proposal plus relevant hidden facts and may add hidden adjustments, reactions, and allowlisted operations. The backend validates against fresh state, resolves uncertainty, and atomically commits each resolved step. Narration occurs after commitment and cannot alter mechanics; a player-safe factual fallback is used if narration fails.

Every mechanical factor cites an opaque, versioned backend fact ID. Facts carry source references, provenance, validity time, confidence where relevant, and viewpoint visibility. **Player-known** facts may appear in the character's reasoning and narration. **Authoritative-hidden** facts may affect authoritative resolution or latent reactions but never player-safe API data. Full audit and player-safe history are separate projections of the same resolution.

Probability uses the versioned `nocturne-probability-v1` integer-basis-point scale defined in [Conversational engine](CONVERSATIONAL_ENGINE.md). The apparent probability is produced without hidden context, is the character's exact assessment from known information, and is player-visible. The authoritative probability may include relevant cited hidden facts and is used for the server roll but remains undisclosed. Hidden safeguards may instead resolve as separate hidden reactions. The backend validates bounds, band membership, citations, authorization, operations, and seed derivation; the model never resolves its own proposal.

The model proposes only bounded operation families. The backend allowlist covers the minimum general state changes needed for characters/entities, content instances, movement, relationships/access, conditions/resources, information, timed work, and area effects. New fictional verbs use these general mechanics rather than per-verb action classes.

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

The stable model is `definition -> revision -> instance`. Content normalization remains reusable backend machinery, but normalize/install endpoints are not player workflow steps. Conversation orchestrates attempt, cost/time, creation or acquisition, placement, and use through the universal action pipeline.

## Location, presence, and timed work

`entity_instances.location_id` is the single authoritative current physical location. Existing `located_within` relationships define place containment. Ownership, residence, tenancy, and access are separate from presence and never imply that a character is physically there. Movement is validated, event-backed, and atomic.

Area effects derive occupants from authoritative location and recursive containment at committed world time. Disconnecting does not move, pause, hide, or protect a character: offline characters remain present and can be observed or affected. They do not autonomously act while absent.

The only offline activity is explicit timed work committed in advance through conversation, with objective, scope/location, timing, reserved costs, and interruption rules. A worker may advance that work but may not invent follow-up choices. Completion or interruption is another validated atomic event.

## AI task lanes

Authoritative tasks use server-controlled model policy:

- conversational intent and adjudication proposals;
- content normalization;
- fact-cited probability proposals;
- NPC planning;
- persistent-memory summaries; and
- player-safe context selection where model assistance is used.

Player-selectable models are limited to creative tasks such as narration, private assistant conversations, and invention brainstorming. A user-selected model may draft an idea, but authoritative validation and persistence always remain server-controlled.

## Data authority

Railway PostgreSQL is the authoritative store. Game changes are committed as append-only events with derived current-state tables. Mechanical operations for a resolved step commit atomically and idempotently. The web client does not write core game tables directly.

Better Auth uses the same PostgreSQL service with an isolated `auth` schema. Game tables use the `game` schema and system/worker records use the `system` schema.

## Service and client topology

- **API (the product):** authenticated conversation commands, active-character selection, context assembly, model policy, proposal validation, resolution, atomic event commitment, redaction, and player-safe read projections.
- **Worker:** world clocks, explicitly authorized timed work, queued AI work, NPC planning, and long-running jobs. It does not invent offline player-character actions.
- **PostgreSQL:** authoritative world state, facts/knowledge, events, conversations, auth, and job records.
- **Web:** authentication, conversation transport/rendering, and a read-only dashboard. It contains no intent classification, probability, adjudication, or state-transition logic.
- **CLI:** interactive/scripted transport to the same API. It contains no game logic and must produce the same results as the web client for the same message and identity.

The former detection-only alley scan, surveillance-system walkthrough, separate installation click, and browser Invent/Act mode are transitional implementation artifacts. They are superseded by this architecture and do not constrain the product contract.
