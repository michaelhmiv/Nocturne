import { mkdir, writeFile } from "node:fs/promises";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is required.");

const models = (
  process.env.NARRATION_MODELS ||
  "qwen/qwen3.7-flash,poolside/laguna-xs-2.1,poolside/laguna-s-2.1,bytedance-seed/seed-2.0-mini"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const repetitions = Number(process.env.NARRATION_REPETITIONS || 2);
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const directory = "artifacts/narration-evaluation";
await mkdir(directory, { recursive: true });

const cases = [
  {
    id: "routine_pushup",
    instruction:
      "Narrate exactly one completed push-up in second person. Do not invent standing up, travel, additional movements, or the actor\u0027s final posture.",
    committed: [
      "The actor attempted one push-up.",
      "The action completed successfully.",
      "Exactly one push-up was completed.",
    ],
    forbidden: [
      /\b(?:injur|hurt|pain|collapse|unconscious|dead|death)\b/i,
      /\b(?:walk|drive|arriv|travel|leave|left the)\b/i,
    ],
  },
  {
    id: "failed_locked_door",
    instruction:
      "Narrate the committed event in second person as concise, grounded immersive game prose.",
    committed: [
      "The actor attempted to open a locked door.",
      "The attempt failed.",
      "The door remains closed and locked.",
    ],
    forbidden: [
      /\b(?:door opens?|opened the door|steps? through|enters?)\b/i,
      /\b(?:lock breaks?|broke the lock)\b/i,
    ],
  },
  {
    id: "travel_started",
    instruction:
      "Narrate the committed travel state in second person. Do not invent a vehicle, transport service, scenery, route details, or arrival.",
    committed: [
      "Travel toward the destination was scheduled.",
      "The actor has not arrived yet.",
      "The current ETA is 42 seconds.",
    ],
    forbidden: [/\b(?:arrives?|arrived|reaches? the destination|steps? into the destination)\b/i],
  },
  {
    id: "combat_no_injury",
    instruction:
      "Narrate the committed event in second person. Do not invent why the attack failed or any reaction by the guard.",
    committed: [
      "The actor attempted to punch the guard.",
      "The attack failed.",
      "No damage or injury was committed.",
    ],
    forbidden: [/\b(?:blood|bleed|broken|fractur|injur|unconscious|collapse|dead|dies?|killed)\b/i],
  },
  {
    id: "purchase_committed",
    instruction:
      "Narrate the completed purchase in second person. Do not invent payment method, vendor behavior, handoff mechanics, or physical object details.",
    committed: [
      "A purchase completed successfully.",
      "Ownership of the toolbox transferred to the actor.",
      "The committed price was $5.00.",
    ],
    forbidden: [/\b(?:stole|steal|free|gift|refund|returned the money)\b/i],
  },
  {
    id: "public_news_copy",
    instruction:
      "Write one short newspaper-style paragraph for the public city feed. Attribute uncertainty plainly. Do not convert absence of public evidence into a claim that police have not identified anyone privately.",
    committed: [
      "A storefront window was reported broken overnight.",
      "Police responded after the report.",
      "No offender identity is public evidence.",
    ],
    forbidden: [
      /\b(?:the suspect was|the attacker was|identified as|arrested the offender|named the offender)\b/i,
    ],
  },
  {
    id: "search_found_not_possessed",
    instruction:
      "Narrate the search discovery in second person. Discovery does not imply pickup, possession, or ownership.",
    committed: [
      "The actor searched the garage for a crowbar.",
      "A steel crowbar was discovered beneath the workbench.",
      "The crowbar remains beneath the workbench.",
      "No ownership or possession transfer occurred.",
    ],
    forbidden: [
      /\b(?:your crowbar|now yours|pick(?:ed)? up|in your hands?|inventory|take possession)\b/i,
    ],
  },
  {
    id: "partial_search",
    instruction:
      "Narrate the partial search result in second person without claiming the missing person was found.",
    committed: [
      "The actor searched the alley for the missing courier.",
      "Fresh tire tracks were discovered.",
      "The courier was not located.",
      "The search produced partial progress only.",
    ],
    forbidden: [/\b(?:found the courier|located the courier|courier appears|courier is here)\b/i],
  },
  {
    id: "committed_injury",
    instruction:
      "Narrate only the exact committed injury in second person. Do not add additional injuries, unconsciousness, or medical consequences.",
    committed: [
      "The guard struck the actor once.",
      "The actor suffered a bruised left cheek.",
      "The actor remains conscious.",
      "No other injury was committed.",
    ],
    forbidden: [/\b(?:fractur|broken|unconscious|collapse|blood|bleed|concussion|hospital)\b/i],
  },
  {
    id: "committed_arrest",
    instruction:
      "Narrate the committed custody state in second person. Do not imply conviction, sentencing, or guilt.",
    committed: [
      "Police arrested the actor.",
      "The actor is now in police custody.",
      "No conviction or sentence has occurred.",
    ],
    forbidden: [/\b(?:convicted|sentenced|guilty|prison term|years in prison)\b/i],
  },
  {
    id: "dialogue_fact",
    instruction:
      "Render the committed dialogue exchange concisely in second person. Do not invent agreement, purchase, attitude, or additional conversation.",
    committed: [
      "The actor asked when the store closes.",
      "The clerk said the store closes at 9 PM.",
      "No purchase or agreement occurred.",
    ],
    forbidden: [/\b(?:buy|purchase|agreed|smiled|laughed|angry|friendly|rude)\b/i],
  },
  {
    id: "property_damage",
    instruction:
      "Narrate the committed property damage in second person. Do not add injuries, alarms, witnesses, police response, or additional damage.",
    committed: [
      "The actor threw one brick at a storefront window.",
      "The storefront window shattered.",
      "No person was injured.",
      "No other property damage was committed.",
    ],
    forbidden: [/\b(?:alarm|police|witness|sirens?|injur|bleed|door|wall|car)\b/i],
  },
  {
    id: "fire_news_uncertain",
    instruction:
      "Write one short newspaper-style paragraph from the public facts. Preserve uncertainty and do not invent a cause, victim, suspect, or damage estimate.",
    committed: [
      "A warehouse fire was reported this morning.",
      "Firefighters responded.",
      "The cause is not publicly determined.",
      "No injuries are publicly confirmed.",
    ],
    forbidden: [/\b(?:caused by|arson|electrical|injured|dead|killed|damage estimate|\$[0-9])\b/i],
  },
];

function findForbiddenClaims(testCase, narration) {
  // A truthful statement that the actor has NOT arrived is not an arrival.
  // Strip only that negated claim; any additional positive arrival still fails.
  const evaluatedText =
    testCase.id === "travel_started"
      ? narration.replace(/\\b(?:not|never)\\s+(?:yet\\s+)?arrived\\b/gi, "still en route")
      : narration;
  return testCase.forbidden
    .filter((pattern) => pattern.test(evaluatedText))
    .map((pattern) => String(pattern));
}

const travelFixture = cases.find(({ id }) => id === "travel_started");
if (
  !travelFixture ||
  findForbiddenClaims(travelFixture, "The actor has not arrived yet.").length !== 0 ||
  findForbiddenClaims(travelFixture, "The actor has not arrived, but then arrived.").length === 0 ||
  findForbiddenClaims(travelFixture, "The actor arrived at the destination.").length === 0
) {
  throw new Error("Narration evaluation must distinguish denial from a positive arrival claim.");
}

const headers = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function request(model, testCase) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      reasoning: { enabled: false },
      max_tokens: 220,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "You are Nocturne's player-facing prose layer. Treat supplied committed/public facts as a closed world: every concrete event, action mechanism, movement mode, location, object property, body reaction, NPC reaction, sensory detail, payment method, possession state, cause, identity, injury, and consequence must be explicitly supported by those facts. You may add connective phrasing, rhythm, and tone only when it does not imply a new concrete fact. Never infer why an action succeeded or failed. Never turn missing public evidence into a stronger private-state claim. Return only the prose, with no JSON, labels, Markdown, or commentary. Prefer 1-2 compact sentences.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction:
              testCase.instruction ||
              "Narrate the committed event in second person as concise, grounded immersive game prose.",
            committedFacts: testCase.committed,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const latencyMs = performance.now() - started;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  const payload = JSON.parse(text);
  const narration = payload.choices?.[0]?.message?.content?.trim();
  if (!narration) throw new Error("Provider returned no narration content.");
  const forbiddenMatches = findForbiddenClaims(testCase, narration);
  return {
    id: testCase.id,
    instruction:
      testCase.instruction ||
      "Narrate the committed event in second person as concise, grounded immersive game prose.",
    committed: testCase.committed,
    narration,
    latencyMs,
    forbiddenMatches,
    requestedModel: model,
    actualModel: payload.model || model,
    requestId: payload.id || null,
    usage: payload.usage || null,
  };
}

const rows = [];
for (const model of models) {
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const testCase of cases) {
      try {
        rows.push({ model, repetition, ...(await request(model, testCase)) });
      } catch (error) {
        rows.push({
          model,
          repetition,
          id: testCase.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

const valid = rows.filter((row) => !row.error);
const percentile = (values, p) => {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index];
};
const summary = models.map((model) => {
  const modelRows = rows.filter((row) => row.model === model);
  const modelValid = modelRows.filter((row) => !row.error);
  const latencies = modelValid.map((row) => row.latencyMs).sort((a, b) => a - b);
  const hallucinationCount = modelValid.filter((row) => row.forbiddenMatches?.length).length;
  const costRows = modelValid.filter((row) => Number.isFinite(Number(row.usage?.cost)));
  return {
    model,
    cases: modelRows.length,
    valid: modelValid.length,
    errors: modelRows.length - modelValid.length,
    forbiddenClaimViolations: hallucinationCount,
    safeNarrations: modelValid.length - hallucinationCount,
    safeNarrationRate:
      modelRows.length > 0 ? (modelValid.length - hallucinationCount) / modelRows.length : 0,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    reportedCostRows: costRows.length,
    reportedCost:
      costRows.length > 0
        ? costRows.reduce((sum, row) => sum + Number(row.usage.cost || 0), 0)
        : null,
  };
});

await writeFile(`${directory}/results.json`, JSON.stringify(rows, null, 2));
await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (!summary.some((row) => row.valid > 0)) {
  throw new Error("No narration model returned a valid response.");
}

for (const row of summary) {
  const failures = [];
  if (row.errors > 0) failures.push(`${row.errors} provider/response errors`);
  if (row.safeNarrationRate < 0.9)
    failures.push(`safeNarrationRate ${row.safeNarrationRate.toFixed(3)} < 0.900`);
  if (row.p95Ms !== null && row.p95Ms > 1000)
    failures.push(`p95 ${row.p95Ms.toFixed(1)}ms > 1000ms`);
  if (failures.length) {
    throw new Error(`Narration quality gate failed for ${row.model}: ${failures.join("; ")}`);
  }
}
