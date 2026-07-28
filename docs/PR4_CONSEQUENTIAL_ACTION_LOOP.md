# PR #4: Consequential action loop

This branch completes the Nocturne v0.1 vertical slice.

## End-to-end command

`Scan the alley behind my building for suspicious movement.`

The command passes through:

1. authenticated actor and installed-method lookup;
2. viewpoint-limited context assembly;
3. authoritative intent parsing;
4. backend score derivation;
5. server-generated seeded uncertainty;
6. strict state-operation construction and validation;
7. atomic event, information, resource, and resolution persistence; and
8. creative narration constrained to the committed event.

The model never receives hidden target truth during intent parsing, never chooses the seed, and never commits operations. If narration fails, the mechanical event remains valid and a deterministic fallback is returned.
