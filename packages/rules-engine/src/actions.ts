import type { SkillName } from "./skills.js";

// ponytail: each action type maps to a skill and a contest derivation.
// Reuse the existing DetectionContext/DerivedContest pattern.
// Add more as they're needed.

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

/** Map action types to their primary skill. */
export const ACTION_SKILL: Record<ActionType, SkillName> = {
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
