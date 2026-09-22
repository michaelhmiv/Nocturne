import { findStockSlot, type CategoryFamily, type StockSlot } from "@nocturne/contracts";

const TAKE_VERB = /\b(grab|take|pick up|pick-up)\b/i;
const CITY_STOCK_SOURCE =
  /\bfrom\s+(?:the\s+|a\s+|an\s+)?(?:mechanic|garage|hardware(?:\s+store)?|store|shop|supermarket|grocery|bodega|pharmacy|restaurant|bar)\b/i;

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
  // City-stock materialization is for an explicit source request, not ordinary
  // possession transfer of an already-existing item in the current scene.
  // "Pick up the wrench" must reach Jev and the authoritative transfer executor.
  if (!CITY_STOCK_SOURCE.test(command)) return null;
  return findStockSlot(command);
}

export function isCityTakeCommand(command: string) {
  return Boolean(matchCityTake(command));
}
