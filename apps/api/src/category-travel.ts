import {
  frameFromUtterance,
  hasExplicitTravelVerb,
  type IntentFrame,
} from "@nocturne/contracts";

export function categoryTravelFrame(command: string): IntentFrame | null {
  if (!hasExplicitTravelVerb(command)) return null;
  const frame = frameFromUtterance(command);
  if (!frame || frame.primitive !== "travel" || !frame.category) return null;
  return frame;
}

export function isCategoryTravelCommand(command: string) {
  return Boolean(categoryTravelFrame(command));
}

export function isScenePerceiveCommand(command: string) {
  return /\b(look around|what'?s around|what is around|where am i|what is this place|what do i see|survey the (street|block|area)|look here)\b/i.test(
    command,
  );
}

export function missingCityDestinationPrompt(frame: IntentFrame) {
  return `No matching ${frame.category} exists in the loaded city source near you.`;
}
