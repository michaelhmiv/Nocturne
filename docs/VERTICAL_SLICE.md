# First vertical slice

The first playable path proves Nocturne's conversational AI-GM and persistent-world architecture end to end. It is not a surveillance or detection feature demo.

## Acceptance flow

Using only the single natural-language conversation:

1. The authenticated player starts without a character and describes who they want to play in ordinary dialogue. No character form or mode selector is used.
2. The GM may ask only for information needed to make the character coherent; it infers and proposes character creation from the conversation.
3. The backend validates ownership and the proposed definition/instance operations, then atomically commits the character, active-character selection, starting location, and event/history records.
4. The player describes an unusual invention in ordinary language. The concept must not depend on a preset catalog or a surveillance-specific mechanic.
5. The player-known viewpoint pass maps the concept to meaningful fact-cited checks and freezes exact apparent probabilities and visible reasoning. The separate authoritative pass receives that proposal plus relevant hidden facts and may add hidden adjustments, reactions, costs/time, and allowlisted universal-content operations without rewriting the apparent assessment.
6. The backend validates fact IDs, visibility, probability bounds, authorization, location, resources, time, and operations; it rolls with server-owned randomness and atomically commits the resulting definition/revision/instance, costs, consequences, knowledge, and events. If the result authorizes timed work instead of immediate acquisition, that explicit work persists with scope and interruption rules and performs no autonomous follow-up choices.
7. When the acquisition result permits it, the player immediately uses the invention in the same conversation. There is no normalize/install button, Invent/Act switch, client-supplied method/target workflow, or per-verb endpoint.
8. The action runs through the same message -> context -> structured LLM proposal -> backend validation -> server roll -> atomic commit -> safe narration path. Ordered checks refresh context between steps.
9. The response shows the character's exact apparent probability and player-known cited factors, the player-safe roll/outcome, costs, consequences, information gained, state changes, and event identity. It does not reveal authoritative-hidden facts, hidden probability adjustments, latent reactions, or another character's undiscovered location.
10. The player refreshes the client. Conversation, character, content definition/revision/instance, location, knowledge, costs, consequences, and events are unchanged and visible through player-safe API projections.
11. The API, worker, and web service are restarted. The same state and history remain, and replaying a prior idempotency key returns the original result without duplicate characters, inventions, costs, or events.

## Required boundaries

- The browser and CLI exercise the same conversational API and contain no adjudication logic. Deleting either client removes no game capability.
- The dashboard is read-only. Player commands enter only through validated conversation. Other committed changes may come from another player, validated NPC/world events, area effects, or explicitly authorized timed work; none originate from a client-side dashboard mutation.
- Apparent probability is based only on the character's known information. Relevant hidden facts may change authoritative resolution or trigger a separate hidden reaction, but neither their content nor their adjustment is disclosed.
- Facts cited by a proposal have backend-issued IDs, provenance, source references, validity, and viewpoint visibility. Fabricated, stale, or visibility-invalid citations fail closed.
- Location is authoritative. Residence/access is not presence. Offline characters remain where they are and can be affected by world events, but they take no invented autonomous actions.
- Novel concepts map to general mechanics. A missing bespoke action type is not a reason to return a generic `invalid_request`.
- Narration follows commitment, preserves the result, adds no state or knowledge, and has a safe factual fallback. The GM gives no canned next-step suggestions.

This slice must pass before broad combat, economy, map expansion, or frontend redesign. Historical surveillance-array and rear-alley detection flows are regression examples at most; they are not the vertical-slice definition.
