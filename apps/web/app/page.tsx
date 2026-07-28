const foundations = [
  "Universal player-created content",
  "Authoritative event ledger",
  "AI game-master policy",
  "Railway PostgreSQL",
  "Better Auth",
  "OpenRouter model routing",
];

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">NOCTURNE FOUNDATION</p>
      <h1>The world accepts what players invent.</h1>
      <p className="lede">
        The AI interprets and narrates. The backend validates causality, resolves uncertainty, and
        commits the shared world.
      </p>
      <section>
        <h2>Initial architecture</h2>
        <ul>
          {foundations.map((foundation) => (
            <li key={foundation}>{foundation}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
