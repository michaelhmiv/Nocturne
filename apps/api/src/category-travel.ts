import { frameFromUtterance, type IntentFrame } from "@nocturne/contracts";

export function categoryTravelFrame(command: string): IntentFrame | null {
  const frame = frameFromUtterance(command);
  if (!frame || frame.primitive !== "travel" || !frame.category) return null;
  return frame;
}

export function isCategoryTravelCommand(command: string) {
  return Boolean(categoryTravelFrame(command));
}

export function missingCityDestinationPrompt(frame: IntentFrame) {
  return `No matching ${frame.category} exists in the loaded city source near you.`;
}
