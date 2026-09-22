import { findStockSlot, type CategoryFamily, type StockSlot } from "@nocturne/contracts";

const TAKE_VERB = /\b(grab|take|pick up|pick-up)\b/i;

export type CityTakeMatch = {
  slot: StockSlot;
  placeFamily: CategoryFamily;
};

export function hasExplicitTakeVerb(command: string) {
  const lowered = command.toLowerCase();
  if (/\btake me\b/.test(lowered)) return false;
  return TAKE_VERB.test(lowered);
}

export function matchCityTake(command: string): CityTakeMatch | null {
  if (/\[fake:/i.test(command)) return null;
  if (!hasExplicitTakeVerb(command)) return null;
  return findStockSlot(command);
}

export function isCityTakeCommand(command: string) {
  return Boolean(matchCityTake(command));
}
