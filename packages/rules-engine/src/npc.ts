import type { OutcomeGrade } from "@nocturne/contracts";

/** Minimal NPC dialogue from stored schedule/persona. No LLM required. */
export function npcDialogue(input: {
  npcName: string;
  schedule?: Record<string, string>;
  rawText: string;
  outcome: OutcomeGrade;
}): { speaker: string; line: string; disposition: "friendly" | "neutral" | "hostile" | "wary" } {
  const hour = new Date().getUTCHours();
  const period = hour >= 20 || hour < 6 ? "night" : hour < 12 ? "morning" : "day";
  const place = input.schedule?.[period] || input.schedule?.default || "here";

  if (input.outcome === "catastrophic_reversal" || input.outcome === "failure") {
    return {
      speaker: input.npcName,
      line: `${input.npcName} brushes you off. "Not interested. I'm busy at ${place}."`,
      disposition: "wary",
    };
  }
  if (input.outcome === "complete_success" || input.outcome === "success_with_consequence") {
    return {
      speaker: input.npcName,
      line: `${input.npcName} leans in. "Keep your voice down. Around ${place}, eyes are everywhere. What do you need?"`,
      disposition: "friendly",
    };
  }
  return {
    speaker: input.npcName,
    line: `${input.npcName} eyes you. "You look new. ${place} isn't a tourist spot."`,
    disposition: "neutral",
  };
}
