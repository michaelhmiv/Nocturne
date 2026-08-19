# ChatGPT-Primary Game Client Architecture

Status: adopted product direction as of 2026-08-19.

## Decision

ChatGPT, connected through Nocturne's authenticated MCP server, is the primary conversational gameplay client.

The Nocturne website remains a first-class companion surface for visual and non-conversational workflows such as account management, character selection and management, map navigation, property/world inspection, and other interfaces that are materially better represented visually. The website does not need to maintain a second AI conversation runtime that duplicates ChatGPT gameplay.

This does not move world authority into ChatGPT. The Nocturne backend remains authoritative for identity, location, inventory, ownership, money, condition, relationships, time, schedules, discoveries, geography, and every durable world mutation.

## Runtime boundary

The intended loop is:

1. ChatGPT reads the selected character and authoritative player-visible scene when context is needed.
2. The player's natural-language intent is forwarded through `submit_action` without converting it into a fixed action catalog or inventing backend IDs.
3. The Nocturne action runtime interprets the request, resolves references and prerequisites, evaluates affordances, plans execution, and validates typed consequences against authoritative state.
4. Immediate actions return committed results. Timed actions create durable plans/schedules and progress according to wall-clock semantics.
5. ChatGPT uses player-visible scene/dashboard/action-history projections to explain the outcome and continue play.
6. When a scheduled action or travel is still pending, ChatGPT may use the dashboard-change wait surface instead of fabricating completion.
7. Clarifications remain linked to the original action request and resume that request rather than becoming unrelated actions.

ChatGPT may narrate and reason over authoritative results, but narration is not itself world truth. Durable facts must come from committed backend state/events.

## LLM-grounded realism

Plugin-first does not mean catalog-first.

Nocturne should continue leaning on the LLM for open-ended semantic judgment and realistic consequence proposals where exhaustive tables are impossible. The model can infer plausible physical, social, economic, and environmental outcomes from authoritative facts and bounded assumptions. The server validates and commits typed operations.

Examples include aggregate building damage, approximate repair cost ranges, social reactions, likely environmental effects, and progressively materialized details. The system should prefer defensible qualitative or bounded estimates over false precision when exact details are not yet authoritative.

Hard-coded tables remain appropriate for true invariants, schemas, safety bounds, resource ontologies, deterministic rules, and data that genuinely benefits from canonical lookup. They should not be used to enumerate every possible player action or world consequence.

## Player-facing MCP surface

Player-facing tools should be concise and task-oriented. The normal gameplay surface should prioritize:

- account/character discovery and selection;
- starter-world and residence onboarding;
- authoritative scene/state reads;
- natural-language action submission;
- timed-action/travel continuation;
- player-visible action history;
- domain reads that materially help gameplay, such as owned/available vehicles.

Tool descriptions should describe what the tool does and when it should be used. They should not describe normal gameplay as a test harness.

### Natural-language action rule

`submit_action` is the canonical conversational write path. It accepts player intent as natural language. ChatGPT should not pre-classify the action, choose internal handlers, fabricate target UUIDs, or decompose the request into hidden backend operations unless the backend explicitly exposes a player-visible choice that requires selection.

This preserves Nocturne's core design goal: support arbitrary plausible actions rather than only a finite command catalog.

## Diagnostic and certification surface

Operational and forensic tools remain essential for development, certification, and support, but they are not the normal player loop.

Examples include:

- deployment/provider/worker/queue health;
- operator action-plan-step-schedule-event-mutation traces;
- direct authoritative entity inspection;
- deterministic route-engine inspection used to diagnose travel topology.

These capabilities should be clearly identified as diagnostic and, where practical, separated from the normal player-facing tool set by scope, server mode, or another explicit capability boundary. A normal gameplay session should not be instructed to inspect operator traces after every action.

## Website role

The web application should focus investment on surfaces that complement ChatGPT rather than duplicating it:

- sign-in, account linking, connection/revocation, and OAuth consent;
- character management;
- interactive map and geographic exploration;
- residences, properties, businesses, assets, and other visual world-management views;
- player dashboard/history views where persistent visual reference is useful;
- settings and account administration.

A web-based conversational composer may remain temporarily for development/certification if useful, but it is not the target production AI interaction model and should not drive architecture decisions.

## Projection requirements

Because ChatGPT is the main conversational client, player-visible projections are part of the gameplay API contract, not secondary debugging output.

Scene/dashboard/action-history responses must provide enough grounded information for ChatGPT to continue the game without guessing. At minimum, the projections must reliably expose relevant location, current plans and schedules, active effects/conditions, recent committed outcomes, unresolved clarification state, and references necessary for subsequent player choices.

Hidden simulation internals and operator-only evidence should remain separate from player-visible projections.

## Certification gate

Every release that changes gameplay semantics or the MCP boundary should preserve end-to-end certification through the real public MCP contract, not only API-unit tests.

The regression suite must continue covering at least:

1. claimed missing inventory fails without mutation/version drift;
2. nonexistent weapons cannot be fabricated or used;
3. prerequisite failures are resolved before secondary target ambiguity;
4. intrinsic anatomy is not treated as inventory;
5. dialogue claims do not become authoritative ownership/state;
6. clarification resumes the originating request;
7. failed movement terminalizes request/plan/step state cleanly;
8. explicit durations retain real wall-clock semantics;
9. starter residences are connected to the travel graph;
10. successful searches persist/materialize discoveries appropriately;
11. current-location deixis resolves from authoritative location;
12. unique vehicle selection reaches the actual economic/ownership check;
13. newly materialized authoritative entities are inspectable;
14. idempotent replay returns the original committed records;
15. idempotency-key reuse with conflicting intent is rejected.

Certification should verify both the player-facing result and the corresponding authoritative request/plan/step/schedule/event/version/state behavior.

## Near-term implementation sequence

1. Make the MCP action corpus a required CI surface and verify the actual public `submit_action` argument contract.
2. Rewrite MCP server instructions and player-facing tool names/descriptions as production gameplay contracts rather than test-harness instructions.
3. Give diagnostic/operator tools an explicit capability boundary so normal ChatGPT gameplay is not polluted by certification tools.
4. Build a table-driven end-to-end MCP regression harness for the preserved production failures above.
5. Run that harness against production after each gameplay release and correlate failures with authoritative traces.
6. Continue action/consequence/world development only from a green MCP-first baseline.

## Non-goals

This decision does not:

- make ChatGPT authoritative over world state;
- remove the website or interactive map;
- replace deterministic validation with narration;
- require a finite action catalog;
- require exact tables for every possible consequence;
- eliminate developer/operator observability;
- prevent future native clients from using the same authoritative APIs.
