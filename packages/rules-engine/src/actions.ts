import type { SkillName } from "./skills.js";

// Action verbs are intentionally broad. Domain-specific resolvers decide whether
// an action is an opposed contest, a deterministic state transition, or a timed task.
export const ACTION_TYPES = [
  "detect",
  "move",
  "search",
  "talk",
  "attack",
  "steal",
  "sneak",
  "lockpick",
  "hack",
  "heal",
  "consume",
  "craft",
  "drive",
  "bribe",
  "persuade",
  "threaten",
  "disguise",
  "forge",
  "plant",
  "observe",
  "arrest",
  "buy",
  "sell",
  "hide",
  "work",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/** Map contest-driven action types to their primary skill.
 * Deterministic actions such as routine consumption intentionally have no skill.
 */
export const ACTION_SKILL: Partial<Record<ActionType, SkillName>> = {
  detect: "investigation",
  move: "athletics",
  search: "investigation",
  talk: "persuasion",
  attack: "combat",
  steal: "stealth",
  sneak: "stealth",
  lockpick: "mechanics",
  hack: "hacking",
  heal: "medicine",
  craft: "engineering",
  drive: "driving",
  bribe: "persuasion",
  persuade: "persuasion",
  threaten: "persuasion",
  disguise: "stealth",
  forge: "electronics",
  plant: "stealth",
  observe: "investigation",
  arrest: "combat",
  buy: "persuasion",
  sell: "persuasion",
  hide: "stealth",
  work: "athletics",
};

/** Default operator competence for action types where hard to derive yet. */
export const DEFAULT_OPERATOR_COMPETENCE = 1;
