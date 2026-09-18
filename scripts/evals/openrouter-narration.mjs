import { mkdir, writeFile } from "node:fs/promises";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is required.");

const models = (process.env.NARRATION_MODELS || "qwen/qwen3.7-flash,poolside/laguna-s-2.1,bytedance-seed/seed-2.0-mini")
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
    committed: [
      "Travel toward the destination was scheduled.",
      "The actor has not arrived yet.",
      "The current ETA is 42 seconds.",
    ],
    forbidden: [/\b(?:arrives?|arrived|reaches? the destination|steps? into the destination)\b/i],
  },
  {
    id: "combat_no_injury",
    committed: [
      "The actor attempted to punch the guard.",
      "The attack failed.",
      "No damage or injury was committed.",
    ],
    forbidden: [/\b(?:blood|bleed|broken|fractur|injur|unconscious|collapse|dead|dies?|killed)\b/i],
  },
  {
    id: "purchase_committed",
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
      "Write one short newspaper-style paragraph for the public city feed. Attribute uncertainty plainly.",
    committed: [
      "A storefront window was reported broken overnight.",
      "Police responded after the report.",
      "No offender identity is public evidence.",
    ],
    forbidden: [
      /\b(?:the suspect was|the attacker was|identified as|arrested the offender|named the offender)\b/i,
    ],
  },
];

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
            "You are Nocturne's player-facing prose layer. Use only supplied committed/public facts. Never invent state changes, causes, identities, outcomes, injuries, travel progress, ownership changes, or hidden facts. Return only the narration prose, with no JSON, labels, Markdown, or commentary. Keep it concise and natural.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction:
              testCase.instruction ||
              "Narrate the committed event in second person as concise immersive game prose.",
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
  const forbiddenMatches = testCase.forbidden
    .filter((pattern) => pattern.test(narration))
    .map((pattern) => String(pattern));
  return {
    id: testCase.id,
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
