# AI model policy

## Default provider

## Central policy versus user selection

Nocturne requires a central model policy for shared-world fairness, but it does not require one permanent model for every task.

## Task policy

| Task                         | Authority     | User override |
| ---------------------------- | ------------- | ------------- |
| Parse action intent          | Authoritative | No            |
| Normalize generated content  | Authoritative | No            |
| Propose adjudication factors | Authoritative | No            |
| Plan NPC actions             | Authoritative | No            |
| Summarize persistent memory  | Authoritative | No            |
| Brainstorm player content    | Creative      | Yes           |
| Narrate committed event      | Creative      | Yes           |
| Private character assistant  | Creative      | Yes           |

## Structured output

Mechanical AI calls must request strict JSON Schema output and then validate the result with a runtime schema. An invalid response is retried or rejected; prose is never treated as a state mutation.

## Free-router limitation
