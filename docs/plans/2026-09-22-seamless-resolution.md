# Seamless category resolution

Player language is mapped to a category + selector, then bound against the
world. Clarification is allowed only when two materialized instances would
mutate different entities. Missing grocery-like nouns are category
destinations, not form errors.

## Ladder

1. Lexicon (`packages/contracts/src/category-resolution.ts`) maps paraphrases
   onto one category. Grocery / bodega / corner store / deli share
   `place.retail.food`. Pharmacy and cafe are separate rows, not special-case
   handlers.
2. `mayClarify` forbids prompts for `category` and `not_found`.
3. `resolveCategory` binds a known instance, or asks the actor to leave an
   interior only when no match exists yet.
4. The API seeds Foundry Row sidewalk + Row Bodega so the grocery sentence has
   somewhere to land (`0042_foundry_row_retail_block.sql`).
5. Movement planning accepts that bound UUID as `destinationId` instead of
   waiting for clarification.

## Acceptance

`go to the nearest grocery store` compiles to a move toward Row Bodega.
`head to the bodega` and `walk to the supermarket` reuse the same path.
