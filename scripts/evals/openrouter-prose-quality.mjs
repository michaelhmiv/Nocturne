import { readFile, writeFile } from "node:fs/promises";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is required.");

const judgeModel = process.env.PROSE_JUDGE_MODEL || "openai/gpt-5.6-luna";
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const inputPath = "artifacts/narration-evaluation/results.json";
const outputPath = "artifacts/narration-evaluation/quality-judgments.json";
const summaryPath = "artifacts/narration-evaluation/quality-summary.json";

const rows = JSON.parse(await readFile(inputPath, "utf8"));
const validRows = rows.filter((row) => !row.error);

const groups = new Map();
for (const row of validRows) {
  const key = `${row.repetition}:${row.id}`;
  const group = groups.get(key) || [];
  group.push(row);
  groups.set(key, group);
}

const headers = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const scoreSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "candidateId",
          "fidelity",
          "naturalness",
          "immersion",
          "concision",
          "styleFit",
          "contradiction",
          "inventedConcreteFacts",
          "overall",
          "notes",
        ],
        properties: {
          candidateId: { type: "string" },
          fidelity: { type: "integer", minimum: 0, maximum: 5 },
          naturalness: { type: "integer", minimum: 0, maximum: 5 },
          immersion: { type: "integer", minimum: 0, maximum: 5 },
          concision: { type: "integer", minimum: 0, maximum: 5 },
          styleFit: { type: "integer", minimum: 0, maximum: 5 },
          contradiction: { type: "boolean" },
          inventedConcreteFacts: {
            type: "array",
            items: { type: "string" },
          },
          overall: { type: "integer", minimum: 0, maximum: 5 },
          notes: { type: "string" },
        },
      },
    },
  },
};

async function judgeGroup(group, groupIndex) {
  const rotation = groupIndex % group.length;
  const ordered = [...group.slice(rotation), ...group.slice(0, rotation)].map((row, index) => ({
    candidateId: `candidate_${index}`,
    model: row.model,
    narration: row.narration,
    original: row,
  }));

  const committed = group[0].committed;
  const instruction = group[0].instruction;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: judgeModel,
      max_tokens: 1800,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "nocturne_prose_quality",
          strict: true,
          schema: scoreSchema,
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are evaluating player-facing prose for a persistent text MMO. Score each candidate independently, not relative to the others. FIDELITY is the highest priority. The committed facts are a closed world: adding a concrete action mechanism, NPC reaction, movement method, body sensation, object property, scenery, payment method, causal explanation, possession state, location detail, or other event detail not explicitly supported counts as invention even when plausible. Connective phrasing and non-factual rhythm are allowed. Naturalness means fluent human prose. Immersion means vivid/engaging without fabricating facts. Concision rewards economical prose. StyleFit evaluates the requested narration/newspaper/dialogue style. Overall must heavily penalize invented concrete facts or contradictions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction,
            committedFacts: committed,
            candidates: ordered.map(({ candidateId, narration }) => ({ candidateId, narration })),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Judge HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }
  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Judge returned no content.");
  const decoded = JSON.parse(content);
  const byId = new Map(ordered.map((item) => [item.candidateId, item]));
  return decoded.scores.map((score) => {
    const mapped = byId.get(score.candidateId);
    if (!mapped) throw new Error(`Unknown judge candidate ${score.candidateId}`);
    return {
      model: mapped.model,
      repetition: mapped.original.repetition,
      id: mapped.original.id,
      narration: mapped.original.narration,
      latencyMs: mapped.original.latencyMs,
      usage: mapped.original.usage,
      ...score,
    };
  });
}

const judgments = [];
let groupIndex = 0;
for (const group of groups.values()) {
  judgments.push(...(await judgeGroup(group, groupIndex)));
  groupIndex += 1;
  await writeFile(outputPath, JSON.stringify(judgments, null, 2));
}

const models = [...new Set(judgments.map((row) => row.model))];
const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};

const summary = models.map((model) => {
  const modelRows = judgments.filter((row) => row.model === model);
  const latencies = modelRows.map((row) => row.latencyMs).filter(Number.isFinite);
  const costs = modelRows
    .map((row) => Number(row.usage?.cost))
    .filter((value) => Number.isFinite(value));
  const noInvention = modelRows.filter(
    (row) => !row.contradiction && row.inventedConcreteFacts.length === 0,
  ).length;
  return {
    model,
    samples: modelRows.length,
    fidelity: average(modelRows.map((row) => row.fidelity)),
    naturalness: average(modelRows.map((row) => row.naturalness)),
    immersion: average(modelRows.map((row) => row.immersion)),
    concision: average(modelRows.map((row) => row.concision)),
    styleFit: average(modelRows.map((row) => row.styleFit)),
    overall: average(modelRows.map((row) => row.overall)),
    contradictionRate:
      modelRows.filter((row) => row.contradiction).length / Math.max(1, modelRows.length),
    noInventionRate: noInvention / Math.max(1, modelRows.length),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    reportedCost: costs.reduce((sum, value) => sum + value, 0),
  };
});

await writeFile(summaryPath, JSON.stringify({ judgeModel, summary }, null, 2));
console.log(JSON.stringify({ judgeModel, summary }, null, 2));
