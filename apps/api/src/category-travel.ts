import { frameFromUtterance, hasExplicitTravelVerb, type IntentFrame } from "@nocturne/contracts";

/** City travel intercepts only explicit go/walk/drive verbs, never give/hand. */
export function categoryTravelFrame(command: string): IntentFrame | null {
  if (!hasExplicitTravelVerb(command)) return null;
  const frame = frameFromUtterance(command);
  if (!frame || frame.primitive !== "travel" || !frame.category) return null;
  return frame;
}

export function isCategoryTravelCommand(command: string) {
  return Boolean(categoryTravelFrame(command));
}

const SCENE_PERCEIVE =
  /^\s*(please\s+)?(look around|what'?s around(?: me)?|what is around(?: me)?|where am i|what is this place|what do i see|survey the (?:street|block|area)|look here)\s*[.?!]*\s*$/i;

export function isScenePerceiveCommand(command: string) {
  if (/\[fake:/i.test(command)) return false;
  return SCENE_PERCEIVE.test(command);
}

export function missingCityDestinationPrompt(frame: IntentFrame) {
  return `No matching ${frame.category} exists in the loaded city source near you.`;
}
