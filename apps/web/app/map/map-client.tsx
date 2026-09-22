"use client";

import { useEffect, useState } from "react";
import type { PlayerDashboard } from "../../../../packages/contracts/src/index.js";
import { authClient } from "../../lib/auth-client";
import { gameFetch } from "../game-fetch";

const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";
const RADIUS = 1600;
const SCALE = 180 / RADIUS;

export default function MapClient() {
  const { data: session, isPending } = authClient.useSession();
  const [dashboard, setDashboard] = useState<PlayerDashboard | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = await gameFetch<PlayerDashboard>("persistent-world/dashboard?historyLimit=1");
      setDashboard(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Map could not be loaded.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!isPending && (session || guestMode)) void refresh();
  }, [isPending, session?.user.id]);

  if (isPending) return <main className="nocturne-map-page">Opening your world map…</main>;
  if (!session && !guestMode) {
    return <main className="nocturne-map-page">Sign in to see your character's map.</main>;
  }

  const point = dashboard?.scene.location.coordinates;
  const places = point ? dashboard?.scene.discoverablePlaces || [] : [];
  const selected = places.find((place) => place.sourceKey === selectedKey) || null;
  const metresEast = (longitude: number) =>
    (longitude - point!.longitude) * 111_320 * Math.cos((point!.latitude * Math.PI) / 180);
  const metresNorth = (latitude: number) => (latitude - point!.latitude) * 111_320;

  return (
    <main className="nocturne-map-page">
      <header className="nocturne-map-header">
        <div>
          <p className="nocturne-map-eyebrow">THE WORLD AROUND YOU</p>
          <h1>Local map</h1>
          <p>{dashboard?.scene.location.name || "Current location unavailable"}</p>
        </div>
        <button disabled={refreshing} onClick={() => void refresh()} type="button">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && <p role="alert">{error}</p>}
      {!point ? (
        <section className="nocturne-map-empty">
          <h2>Location is not yet mapped</h2>
          <p>
            This character's current place has no verified coordinates. Nocturne will not place you
            at an unrelated starter location or invent nearby streets.
          </p>
        </section>
      ) : (
        <div className="nocturne-map-layout">
          <section className="nocturne-map-plot" aria-label="Local geographic overview">
            <svg
              role="img"
              aria-label="Spatial overview showing actual position and source-backed nearby places within 1.6 kilometres"
              viewBox="0 0 800 600"
              preserveAspectRatio="xMidYMid meet"
            >
              <circle cx="400" cy="300" r="180" fill="none" stroke="currentColor" opacity="0.3" />
              <circle cx="400" cy="300" r="90" fill="none" stroke="currentColor" opacity="0.3" />
              <line x1="400" y1="112" x2="400" y2="488" stroke="currentColor" opacity="0.2" />
              <line x1="212" y1="300" x2="588" y2="300" stroke="currentColor" opacity="0.2" />
              <text x="405" y="108" fill="currentColor">
                N
              </text>
              {places.map((place) => {
                const x = 400 + metresEast(place.longitude) * SCALE;
                const y = 300 - metresNorth(place.latitude) * SCALE;
                return (
                  <g key={place.sourceKey}>
                    <circle
                      cx={x}
                      cy={y}
                      r={place.sourceKey === selectedKey ? 9 : 6}
                      fill={place.sourceKey === selectedKey ? "#f0c777" : "#b6d3a6"}
                    >
                      <title>
                        {place.name} · {place.distanceMeters} m
                      </title>
                    </circle>
                  </g>
                );
              })}
              <circle cx="400" cy="300" r="9" fill="#8dd3ed" stroke="#0a1019" strokeWidth="3">
                <title>Your character</title>
              </circle>
              <text x="416" y="290" fill="currentColor">
                You
              </text>
              <text x="218" y="511" fill="currentColor">
                1.6 km radius · geographic points, not street routes
              </text>
            </svg>
            <p>
              This view plots verified coordinates and public imported points only. It does not
              depict roads, travel times, or other players' private whereabouts.
            </p>
          </section>
          <aside className="nocturne-map-places" aria-label="Nearby places">
            <h2>Nearby places</h2>
            {places.length === 0 && <p>No imported nearby points are currently available.</p>}
            {places.map((place) => (
              <button
                aria-pressed={selected?.sourceKey === place.sourceKey}
                className={selected?.sourceKey === place.sourceKey ? "is-selected" : ""}
                key={place.sourceKey}
                onClick={() => setSelectedKey(place.sourceKey)}
                type="button"
              >
                <strong>{place.name}</strong>
                <span>
                  {place.family.replaceAll(".", " ")} · {place.distanceMeters} m
                </span>
              </button>
            ))}
            {selected && (
              <section className="nocturne-map-detail">
                <h3>{selected.name}</h3>
                <p>{selected.distanceMeters} metres from your current point.</p>
                <p>
                  Choosing a marker is informational; travel must be validated by the world engine.
                </p>
              </section>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
