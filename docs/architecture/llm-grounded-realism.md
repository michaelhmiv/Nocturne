# LLM-Grounded Realism Doctrine

Nocturne must not depend on exhaustive catalogs or lookup tables for every physical, social, economic, or environmental outcome. The language model is responsible for proposing realistic interpretations and consequences from the authoritative context available at execution time.

The model is not the authority. It proposes a bounded, inspectable outcome that the server validates and commits.

## Core rule

Player intent is interpreted by the model, resolved against authoritative world state, and converted into structured operations. Narration is generated only after those operations are validated and committed.

The system should prefer contextual estimates over hard-coded enumeration when the exact outcome is not already represented in authoritative state.

Examples include:

- estimating how many windows are likely broken after a blast;
- estimating repair cost from building size, condition, materials, location, and severity;
- estimating how many occupants are affected;
- estimating business revenue from occupancy, foot traffic, pricing, competition, and operating condition;
- estimating construction duration from project scope, labor, materials, access, weather, and financing;
- estimating injuries from force, anatomy, environment, protection, and actor condition.

## Structured proposal requirement

Every model-estimated consequence must return:

- a concise outcome summary;
- explicit assumptions;
- the authoritative facts used;
- uncertainty or confidence;
- an estimated range where precision is not justified;
- proposed world operations;
- affected entity references;
- follow-up simulation or inspection needs;
- narration constraints.

The proposal must distinguish:

- known facts;
- reasonable inference;
- uncertain estimates;
- deliberately unresolved details.

## No false precision

The model should not invent exact counts merely because a schema permits a number.

When the available context supports only a qualitative conclusion, the model should use bounded descriptions such as:

- isolated;
- several;
- a substantial portion;
- a majority;
- nearly all;

A later inspection, repair estimate, insurance assessment, or player investigation may refine those estimates and commit more precise state.

## Server validation

The server validates proposals against:

- entity existence and version;
- location and containment;
- ownership and possession;
- physical dimensions and capacity;
- available resources;
- legal and economic state;
- route and access constraints;
- allowed operation types;
- bounded numeric ranges;
- contradictions with committed facts;
- idempotency and transaction invariants.

A proposal that contradicts authoritative state is rejected or revised. The server must never silently convert invalid operations into successful narration.

## Progressive materialization

Not every detail needs to exist before it becomes relevant.

A building may initially have a known footprint, floor count, use, condition, and occupancy estimate. When damage occurs, the model may propose aggregate damage such as "most street-facing windows are broken" without materializing every pane.

Individual windows should be promoted to persistent entities only when their identity matters, such as when:

- a player climbs through one;
- evidence is attached to one;
- a repair contract addresses specific openings;
- a room's security depends on it;
- repeated damage requires separate condition tracking.

This hybrid approach applies to fixtures, rooms, inventory, crowds, businesses, construction materials, and other high-volume world details.

## Reconciliation and refinement

Estimated state must be refinable without erasing history.

A later authoritative inspection can replace an estimate with a more precise assessment while preserving:

- the original estimate;
- the confidence at the time;
- the facts available when it was made;
- the event that refined it;
- any financial or gameplay decisions already based on the estimate.

## Economic realism

Economic outcomes should be inferred from the actual world context rather than fixed rewards.

Property, business, repair, construction, and operating estimates should consider relevant inputs such as:

- physical size;
- location;
- condition;
- occupancy;
- demand;
- competition;
- access;
- labor and material availability;
- financing;
- local reputation and safety;
- elapsed real-world time.

The model may estimate missing market values, but must expose its assumptions and range. Persistent cash transfers, debt, ownership, construction progress, and property changes remain server-authoritative.

## Design consequence

Nocturne should maintain small, typed ontologies for universal concepts and operations, not exhaustive content catalogs.

The preferred pattern is:

1. provide the model with authoritative context;
2. request a structured, assumption-bearing proposal;
3. validate the proposal against general invariants;
4. commit typed operations atomically;
5. narrate the committed result;
6. refine estimates later when new evidence becomes available.

This doctrine applies to the action engine, damage, injuries, property development, construction, businesses, NPC behavior, discovery, and the NYC-derived physical world.