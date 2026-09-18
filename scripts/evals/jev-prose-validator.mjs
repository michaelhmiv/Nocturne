import { readFile, writeFile } from "node:fs/promises";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is required.");

const model = process.env.PROSE_VALIDATOR_MODEL || "~typesafe/jev-latest";
const endpoint = "https://openrouter.ai/api/alpha/decisions";
const resultsPath = "artifacts/narration-evaluation/results.json";
const judgmentsPath = "artifacts/narration-evaluation/quality-judgments.json";
const outputPath = "artifacts/narration-evaluation/jev-fidelity-validation.json";
const summaryPath = "artifacts/narration-evaluation/jev-fidelity-summary.json";

const generations = JSON.parse(await readFile(resultsPath, "utf8"));
const judgments = JSON.parse(await readFile(judgmentsPath, "utf8"));

const generationMap = new Map(
  generations
    .filter((row) => !row.error)
    .map((row) => [`${row.model}:${row.repetition}:${row.id}`, row]),
);

const rows = [];

async function validate(row) {
  const generation = generationMap.get(`${row.model}:${row.repetition}:${row.id}`);
  if (!generation) throw new Error(`Missing generation row for ${row.model} ${row.id}`);

  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      state: {
        instruction: generation.instruction,
        committedFacts: generation.committed,
        narration: generation.narration,
      },
      questions: {
        unsupported_fact: {
          type: "noul",
          instructions:
            "Does the narration introduce any concrete fact, event, action mechanism, movement method, body reaction, NPC reaction, sensory detail, object property, payment method, possession state, cause, identity, injury, consequence, location detail, or private-state claim that is not explicitly supported by the committed facts? Ordinary connective phrasing that implies no new concrete fact is allowed. Answer true if there is at least one unsupported concrete fact.",
          criteria: {
            true: "At least one concrete detail is unsupported by the committed facts.",
            false: "Every concrete detail is supported; only connective phrasing or non-factual tone was added.",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Jev validator HTTP ${response.status}: ${text.slice(0, 800)}`);
  const payload = JSON.parse(text);
  const answer = payload.answers?.unsupported_fact;
  if (!answer || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    throw new Error("Jev validator returned malformed unsupported_fact answer.");
  }

  const judgeUnsafe =
    row.contradiction === true ||
    (Array.isArray(row.inventedConcreteFacts) && row.inventedConcreteFacts.length > 0);

  return {
    model: row.model,
    repetition: row.repetition,
    id: row.id,
    narration: row.narration,
    judgeUnsafe,
    judgeInventedFacts: row.inventedConcreteFacts || [],
    jevUnsupportedProbability: answer.noul,
    jevUnsafeAt50: answer.noul >= 0.5,
    latencyMs: performance.now() - started,
    actualModel: payload.model || model,
    cost: payload.usage?.cost ?? null,
  };
}

for (const row of judgments) {
  rows.push(await validate(row));
}
await writeFile(outputPath, JSON.stringify(rows, null, 2));

function metrics(threshold) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const row of rows) {
    const predicted = row.jevUnsupportedProbability >= threshold;
    if (predicted && row.judgeUnsafe) tp += 1;
    else if (predicted && !row.judgeUnsafe) fp += 1;
    else if (!predicted && !row.judgeUnsafe) tn += 1;
    else fn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const specificity = tn + fp ? tn / (tn + fp) : 1;
  return { threshold, tp, fp, tn, fn, precision, recall, specificity };
}

const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
const percentile = (values, p) =>
  values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))];

const perNarrator = [...new Set(rows.map((row) => row.model))].map((narrator) => {
  const subset = rows.filter((row) => row.model === narrator);
  const unsafe = subset.filter((row) => row.judgeUnsafe).length;
  const caught = subset.filter(
    (row) => row.judgeUnsafe && row.jevUnsupportedProbability >= 0.5,
  ).length;
  const safeRejected = subset.filter(
    (row) => !row.judgeUnsafe && row.jevUnsupportedProbability >= 0.5,
  ).length;
  return {
    narrator,
    samples: subset.length,
    judgeUnsafe: unsafe,
    jevCaughtUnsafeAt50: caught,
    unsafeRecallAt50: unsafe ? caught / unsafe : 1,
    safeRejectedAt50: safeRejected,
  };
});

const costRows = rows.filter((row) => Number.isFinite(Number(row.cost)));
const summary = {
  validatorModel: model,
  samples: rows.length,
  thresholds: [0.25, 0.4, 0.5, 0.6, 0.75].map(metrics),
  p50Ms: percentile(latencies, 0.5),
  p95Ms: percentile(latencies, 0.95),
  reportedCost:
    costRows.length > 0
      ? costRows.reduce((sum, row) => sum + Number(row.cost || 0), 0)
      : null,
  perNarrator,
};

await writeFile(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
