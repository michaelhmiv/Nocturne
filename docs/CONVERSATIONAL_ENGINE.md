# Conversational engine

## Product contract

Nocturne is the AI GM for a persistent multiplayer comic-book world. All play, including character creation and invention, enters through one natural-language conversation. There are no player-selected Invent/Act modes, per-verb workflows, or canned next-step coaching. Novel input is mapped to general mechanics rather than rejected because it lacks bespoke code.

The API is the product. The browser and CLI are thin clients of the same conversational API; neither classifies intent, calculates probability, selects authoritative actors/targets/methods, validates operations, or mutates world state. The dashboard is a read-only projection of player-safe API state.

The detection-only alley scan and separate normalize/install workflow are legacy implementation constraints, not product architecture. Historical PR documents describing them do not define the conversational contract.

## One message path

Every player message follows one server-owned path:

1. **Message.** The client sends a conversation ID, raw text, and an idempotency key. Authentication and the conversation determine the user and active character; pre-character conversation is valid. Idempotency is scoped by authenticated user and conversation. The backend hashes the immutable request identity (authenticated user, conversation, normalized raw text, and protocol version) when the key is first accepted. Reusing that key with different immutable request fields is rejected; later server-state changes do not change the stored request hash or block a retry.
2. **Context.** The backend loads current authoritative state and builds the smallest relevant fact set. It labels every fact with identity, provenance, and visibility. The model may receive relevant hidden facts for authoritative adjudication, but unrelated world secrets are excluded.
3. **LLM proposals.** A server-selected model first receives only the player-known fact projection and proposes intent, meaningful checks, apparent probabilities, and visible factors. A separate authoritative pass receives that frozen viewpoint proposal plus the relevant authoritative context and may propose hidden adjustments, reactions, and allowlisted state operations. The authoritative pass cannot rewrite the apparent probability or visible reasoning. Neither pass rolls or writes state.
4. **Backend validation.** Runtime schemas and domain checks reject fabricated or inaccessible fact IDs, uncited factors, invalid probability ranges, hidden facts in visible reasoning, unauthorized entities, stale location/ownership/resource assumptions, excessive work, and non-allowlisted operations. Validation is repeated against fresh state immediately before commitment.
5. **Roll.** For each meaningful uncertain check, the backend derives server-owned randomness from secret and stable event inputs. The LLM never sees, chooses, or rerolls the seed. Ordered compound checks refresh context between committed steps and stop or branch when an earlier result makes later steps impossible. Messages with no meaningful uncertainty do not receive a decorative roll.
6. **Atomic commit.** In one database transaction, the backend appends the event/audit records and applies all validated state changes for that resolved step: character/content/instance creation, movement, resources, conditions, relationships, knowledge, latent reactions, or timed work. Failure rolls back the complete step. The message record tracks the committed step sequence. Retrying the same scoped key resumes or returns that sequence; it never duplicates costs or entities. If a later compound step fails, earlier committed fictional consequences remain and the response reports that committed prefix.
7. **Safe narration.** Only after mechanics commit does a creative model narrate the committed, player-visible result. It receives player-safe facts, outcome constraints, and no prose-form hidden truth. Narration cannot add mechanics or knowledge. If narration fails, committed mechanics remain authoritative and the API returns a factual player-safe fallback. Conversation history links narration to its committed event.

Provider failures before the first commitment are system failures, not fictional outcomes. Failures after an earlier compound step committed preserve and return that committed prefix and can resume under the same idempotency record. A validation failure commits no part of the step it rejected.

## Facts, provenance, and visibility

Adjudication uses backend-issued facts, not freeform assertions. A context fact has at least:

- an opaque, versioned `factId` cited by proposals and factors;
- a bounded claim/value suitable for mechanical use;
- source entity, definition revision, event, relationship, or information-asset references;
- provenance describing whether it is authoritative state, observation, inference, report, or derived context;
- the world time or event at which it became valid and, where relevant, its confidence; and
- visibility of either **player-known** or **authoritative-hidden** for the current viewpoint.

Player-known means the active character has legitimately observed, inferred, or been told the fact; it does not mean every player knows it. Authoritative-hidden facts may support authoritative resolution and latent reactions but must never appear in player-visible reasoning, API projections, conversation history, logs exposed to players, or narration. The backend, not the model or client, decides visibility and performs one shared redaction pass for every client.

A proposal must cite supplied fact IDs for every mechanical factor and proposed operation precondition. Unknown, stale, duplicated-with-conflicting-value, or visibility-invalid citations fail closed. Full citations, model/run metadata, accepted probability, seed material reference, roll, and operations remain in the authoritative audit; the player-safe record contains only permitted facts and reasoning.

## Probability contract

Probability scale **`nocturne-probability-v1`** represents probability as integer basis points (`0..10000`), where 100 basis points is 1%. Prompts, contracts, audit records, and tests must name this version.

| Band           | Allowed basis points | Player meaning                                                          |
| -------------- | -------------------: | ----------------------------------------------------------------------- |
| `impossible`   |                  `0` | Cannot succeed under the current facts; circumstances may still change. |
| `remote`       |             `1..999` | More than zero, below 10%.                                              |
| `unlikely`     |         `1000..3499` | 10% through 34.99%.                                                     |
| `even`         |         `3500..6499` | 35% through 64.99%.                                                     |
| `likely`       |         `6500..8999` | 65% through 89.99%.                                                     |
| `near_certain` |         `9000..9999` | 90% through 99.99%; uncertainty remains.                                |
| `certain`      |              `10000` | Guaranteed by the validated current facts; no roll is needed.           |

The viewpoint model's calibrated judgment supplies the exact basis points and matching band; there is no deterministic backend formula that can prove one fictional situation is exactly `4200` rather than `4300`. The backend makes that judgment authoritative only after validating integer form, range, band membership, cited factors, visibility, and operation authorization. Curated scenario tests and aggregate live-model calibration detect systematic drift; formally valid but unsupported reasoning is rejected, while small semantic differences inside a justified band are model judgment. These ranges are exhaustive and non-overlapping. A future rebalance creates a new version rather than silently changing v1.

Each uncertain check keeps two values:

- **Apparent probability** is the character's exact assessment from player-known facts. It is produced by the viewpoint pass, which never receives authoritative-hidden facts. It and only its player-known factors may be shown to that player.
- **Authoritative probability** is the backend-validated resolution probability using all relevant known and hidden facts. It is used for the roll and retained only in the authoritative audit.

The authoritative pass receives the apparent proposal as immutable input and may differ only when cited authoritative-hidden facts justify the difference. The difference itself, hidden adjustment, and hidden reasoning are not disclosed. The player-safe roll is the exact raw draw for the visible action check and its committed visible outcome. That pair may reveal that the character's assessment was incomplete, but never identifies the hidden fact or adjustment. A hidden safeguard such as an alarm should normally use a separate hidden check/reaction whose draw remains undisclosed until the character legitimately detects its consequence.

## Operations and authority

Model output is a proposal over a bounded backend operation allowlist, not a command language or SQL substitute. The minimum general operation families cover character/entity acquisition, definition/revision/instance creation, movement, relationships and access, conditions and resources, information assets, timed work, and area effects. Adding a new fictional verb does not justify a new operation type when these operations already express its consequences.

Before commit, the backend validates operation count and shape, authenticated control, ownership, consent, access, current location/containment, affected set, resources, time, target existence, and cross-operation consistency. Protected permanent consequences require explicit backend authorization. The model cannot grant unowned capabilities, bypass requirements, or directly write state.

## Location, presence, and time

`entity_instances.location_id` is the single authoritative current physical location. Place containment/ancestry is represented by existing `located_within` relationships. Residence, ownership, tenancy, access, and remote communication are separate relationships and never imply physical presence. Movement changes location atomically, is event-backed, and is validated against fresh state.

Area effects compute their affected set from authoritative location and recursive containment at the event's committed world time. They include characters whose clients are disconnected and exclude adjacent or merely entitled entities. A player receives another character's exact location only through direct observation or a valid information asset.

Logging out does not move, pause, hide, or protect a character. An offline character remains physically present and can be observed or affected, but Nocturne does not invent choices or autonomous actions for that character.

The sole exception is **explicit timed work** already committed through conversation. Its record names the actor, objective, location or permitted remote scope, start time, expected completion, reserved costs/resources, and interruption rules. The worker may advance only that authorized work; it may not choose follow-up actions. World events can interrupt or alter the work through normal validated events, and completion commits atomically before it is narrated.

## Client boundary

The conversational API owns authentication-to-character selection, context, model policy, adjudication, probability, randomness, authorization, persistence, redaction, and player-safe history/state projections.

The CLI may read text, send messages, print API responses, and run scripted assertions. The frontend may authenticate, send text, render the conversation, and render the read-only dashboard. Both consume the same player-safe schemas. Developer-only authoritative inspection, when enabled locally, is a separate privileged API concern—not game logic embedded in a client. Deleting either client must remove no game capability.
