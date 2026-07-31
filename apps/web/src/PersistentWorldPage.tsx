"use client";

import "./persistent-world.css";
import { PersistentWorldPanel } from "./PersistentWorldPanel.js";

export function PersistentWorldPage({
  apiBaseUrl,
  accessToken,
}: {
  apiBaseUrl: string;
  accessToken?: string;
}) {
  return <PersistentWorldPanel apiBaseUrl={apiBaseUrl} accessToken={accessToken} />;
}
