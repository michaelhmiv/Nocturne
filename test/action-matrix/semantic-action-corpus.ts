import type {
  ActionResolutionMode,
  SemanticActionFrame,
  WorldActionKind,
} from "@nocturne/contracts";

export type SemanticActionCorpusCase = {
  id: string;
  prompt: string;
  kind: WorldActionKind;
  expectedMode: ActionResolutionMode;
  targetRole?: "person" | "object";
  targetKey?: string;
  objectKey?: string;
  toolKey?: string;
  frameOverrides?: Partial<SemanticActionFrame>;
};

export const SEMANTIC_ACTION_CORPUS: SemanticActionCorpusCase[] = [
  {
    id: "routine-pushup",
    prompt: "Do one push up.",
    kind: "interact",
    expectedMode: "automatic_success",
  },
  {
    id: "routine-stand",
    prompt: "Stand up.",
    kind: "interact",
    expectedMode: "automatic_success",
  },
  {
    id: "routine-breathe",
    prompt: "Take a normal breath.",
    kind: "interact",
    expectedMode: "automatic_success",
  },
  {
    id: "ordinary-object",
    prompt: "Open the unlocked drawer.",
    kind: "interact",
    expectedMode: "automatic_success",
    targetRole: "object",
    objectKey: "objectId",
  },
  {
    id: "demanding-exercise",
    prompt: "Do 100 push-ups until failure.",
    kind: "interact",
    expectedMode: "unopposed_check",
  },
  {
    id: "technical-lock",
    prompt: "Pick the difficult lock carefully.",
    kind: "interact",
    expectedMode: "unopposed_check",
    targetRole: "object",
    objectKey: "objectId",
  },
  {
    id: "repair-device",
    prompt: "Repair the damaged radio.",
    kind: "interact",
    expectedMode: "unopposed_check",
    targetRole: "object",
    objectKey: "objectId",
  },
  {
    id: "combat-punch",
    prompt: "Punch the guard.",
    kind: "combat",
    expectedMode: "opposed_contest",
    targetRole: "person",
    targetKey: "targetId",
  },
  {
    id: "combat-restrain",
    prompt: "Restrain the fleeing suspect.",
    kind: "combat",
    expectedMode: "opposed_contest",
    targetRole: "person",
    targetKey: "targetId",
  },
  {
    id: "relationship-persuasion",
    prompt: "Persuade the landlord to give me another day.",
    kind: "relationship",
    expectedMode: "opposed_contest",
    targetRole: "person",
    targetKey: "targetId",
  },
  {
    id: "conversation-greeting",
    prompt: "Say hello.",
    kind: "dialogue",
    expectedMode: "conversation",
  },
  {
    id: "conversation-question",
    prompt: "Ask what time the store closes.",
    kind: "question",
    expectedMode: "conversation",
  },
  {
    id: "consensual-transfer",
    prompt: "Give my wrench to the mechanic.",
    kind: "transfer",
    expectedMode: "transaction",
    targetRole: "person",
    targetKey: "recipientId",
    objectKey: "objectId",
  },
  {
    id: "timed-exercise",
    prompt: "Exercise for 30 minutes.",
    kind: "interact",
    expectedMode: "timed_task",
  },
  {
    id: "timed-repair",
    prompt: "Repair the engine for two hours.",
    kind: "interact",
    expectedMode: "timed_task",
    targetRole: "object",
    objectKey: "objectId",
  },
  {
    id: "movement",
    prompt: "Walk to city hall.",
    kind: "move",
    expectedMode: "movement",
    targetRole: "object",
    targetKey: "destinationId",
  },
  {
    id: "impossible-teleport",
    prompt: "Teleport across town.",
    kind: "interact",
    expectedMode: "automatic_failure",
  },
  {
    id: "impossible-wall",
    prompt: "Walk through the solid wall.",
    kind: "interact",
    expectedMode: "automatic_failure",
  },
  {
    id: "impossible-building-lift",
    prompt: "Lift the skyscraper.",
    kind: "interact",
    expectedMode: "automatic_failure",
  },
  {
    id: "ambiguous-target",
    prompt: "Use it on him.",
    kind: "interact",
    expectedMode: "clarification_required",
    frameOverrides: {
      ambiguities: ["The object and target are not uniquely identified."],
    },
  },
  {
    id: "destructive-object",
    prompt: "Smash the window.",
    kind: "interact",
    expectedMode: "unopposed_check",
    targetRole: "object",
    objectKey: "objectId",
  },
  {
    id: "illegal-hacking",
    prompt: "Hack the secured terminal.",
    kind: "interact",
    expectedMode: "unopposed_check",
    targetRole: "object",
    objectKey: "objectId",
  },
  {
    id: "precision-action",
    prompt: "Carefully cut the wire without touching the live conductor.",
    kind: "interact",
    expectedMode: "unopposed_check",
    targetRole: "object",
    objectKey: "objectId",
  },
  {
    id: "dangerous-climb",
    prompt: "Climb onto the roof ledge.",
    kind: "interact",
    expectedMode: "unopposed_check",
    targetRole: "object",
    targetKey: "locationId",
  },
  {
    id: "routine-wave",
    prompt: "Wave.",
    kind: "interact",
    expectedMode: "automatic_success",
  },
  {
    id: "routine-nod",
    prompt: "Nod.",
    kind: "interact",
    expectedMode: "automatic_success",
  },
  {
    id: "routine-kneel",
    prompt: "Kneel down.",
    kind: "interact",
    expectedMode: "automatic_success",
  },
  {
    id: "routine-stretch",
    prompt: "Stretch my arms.",
    kind: "interact",
    expectedMode: "automatic_success",
  },
  {
    id: "threaten-target",
    prompt: "Threaten the witness into silence.",
    kind: "relationship",
    expectedMode: "opposed_contest",
    targetRole: "person",
    targetKey: "targetId",
  },
  {
    id: "question-person",
    prompt: "Ask the clerk where the records are kept.",
    kind: "question",
    expectedMode: "conversation",
    targetRole: "person",
    targetKey: "targetId",
  },
];
