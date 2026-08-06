"use client";

import Header from "@/components/layout/Header";

// Mock data for the metrics skeleton
const STAT_CARDS = [
  { label: "Sessions Played", value: "24", unit: "sessions", color: "#238c35" },
  { label: "Best Accuracy",   value: "94",  unit: "%",        color: "#5376f0" },
  { label: "Total Practice",  value: "3h 12m", unit: "time",  color: "#d79f36" },
];

const RECENT_SESSIONS = [
  { song: "Smoke on the Water", artist: "Deep Purple",  date: "Jun 14, 2026", accuracy: 87, tempo: 110 },
  { song: "Nothing Else Matters", artist: "Metallica",   date: "Jun 13, 2026", accuracy: 72, tempo: 84  },
  { song: "Wonderwall",          artist: "Oasis",        date: "Jun 12, 2026", accuracy: 94, tempo: 87  },
  { song: "Stairway to Heaven",  artist: "Led Zeppelin", date: "Jun 11, 2026", accuracy: 61, tempo: 72  },
  { song: "Hotel California",    artist: "Eagles",       date: "Jun 10, 2026", accuracy: 78, tempo: 75  },
];

function StatCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 180,
      background: "#202022",
      borderRadius: 6,
      padding: "20px 24px",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", color: "#8a8b8c", marginBottom: 8 }}>
        {label}
      </p>
      <p style={{ fontSize: 36, fontWeight: 700, color, lineHeight: 1, marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
      <p style={{ fontSize: 12, color: "#6d6d6d" }}>{unit}</p>
    </div>
  );
}

function AccuracyBadge({ pct }: { pct: number }) {
  const color = pct >= 80 ? "#238c35" : pct >= 60 ? "#d79f36" : "#cf4343";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 10,
      background: `${color}18`,
      border: `1px solid ${color}30`,
      color,
      fontSize: 12,
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums",
    }}>
      {pct}%
    </span>
  );
}

export default function MetricsPage() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#1c1d1f", color: "white", paddingTop: 80 }}>
      <Header />

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
        {/* Page title */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontFamily: "Georgia, serif",
            fontSize: 32,
            fontWeight: 300,
            color: "#d6d6d6",
            margin: 0,
            lineHeight: 1.2,
          }}>
            Practice Metrics
          </h1>
          <p style={{ fontSize: 14, color: "#8a8b8c", marginTop: 6, fontWeight: 300 }}>
            Your practice history and performance overview
          </p>
        </div>

        {/* 3 stat cards */}
        <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
          {STAT_CARDS.map(card => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>

        {/* Placeholder chart area */}
        <div style={{
          background: "#202022",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.06)",
          padding: 24,
          marginBottom: 32,
          height: 240,
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Subtle grid pattern */}
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />

          {/* Placeholder axis lines */}
          <div style={{ position: "absolute", bottom: 40, left: 60, right: 24, borderBottom: "1px solid rgba(255,255,255,0.08)" }} />
          <div style={{ position: "absolute", top: 24, bottom: 40, left: 60, borderLeft: "1px solid rgba(255,255,255,0.08)" }} />

          {/* Centered text */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <p style={{ fontSize: 13, color: "#6d6d6d" }}>Practice history chart — coming soon</p>
            <p style={{ fontSize: 11, color: "#3f3f46" }}>Accuracy over time, per song</p>
          </div>
        </div>

        {/* Recent sessions table */}
        <div style={{ background: "#202022", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto auto",
            gap: 16,
            padding: "10px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            {["Song", "Date", "Accuracy", "Tempo"].map(col => (
              <span key={col} style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.4px", color: "#6d6d6d" }}>
                {col}
              </span>
            ))}
          </div>

          {/* Table rows */}
          {RECENT_SESSIONS.map((session, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr auto auto",
                gap: 16,
                padding: "12px 20px",
                borderBottom: i < RECENT_SESSIONS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                alignItems: "center",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <div>
                <p style={{ fontSize: 13, color: "#d6d6d6", fontWeight: 400, margin: 0 }}>{session.song}</p>
                <p style={{ fontSize: 11, color: "#8a8b8c", margin: 0, marginTop: 2 }}>{session.artist}</p>
              </div>
              <span style={{ fontSize: 12, color: "#8a8b8c" }}>{session.date}</span>
              <AccuracyBadge pct={session.accuracy} />
              <span style={{ fontSize: 12, color: "#8a8b8c", fontVariantNumeric: "tabular-nums" }}>
                {session.tempo} BPM
              </span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
