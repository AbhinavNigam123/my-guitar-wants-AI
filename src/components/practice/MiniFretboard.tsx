"use client";

/** Compact 6-string fretboard diagram for chord shapes / scale tones. */
export default function MiniFretboard({
  positions,
  width = 56,
  height = 48,
  accent = "#ca8a04",
  dimAccent = "rgba(202,138,4,0.45)",
}: {
  positions: { string: number; fret: number; isChordTone?: boolean }[];
  width?: number;
  height?: number;
  accent?: string;
  dimAccent?: string;
}) {
  const frets = positions.map(p => p.fret);
  const lowest = frets.length ? Math.min(...frets) : 0;
  const highest = frets.length ? Math.max(...frets) : 3;
  const minFret = lowest <= 1 ? 0 : lowest;
  const fretCount = Math.min(5, Math.max(3, highest - minFret + 1));
  const left = 6;
  const right = 5;
  const top = 10;
  const bottom = 4;
  const usableW = width - left - right;
  const usableH = height - top - bottom;
  const stringGap = usableW / 5;
  const fretGap = usableH / fretCount;

  return (
    <div style={{
      flexShrink: 0, width, height, borderRadius: 3, overflow: "hidden",
      background: "rgba(0,0,0,0.15)",
    }}>
      <svg width={width} height={height}>
        {/* Conventional chord-box orientation: strings vertical, frets horizontal. */}
        {Array.from({ length: 6 }, (_, i) => (
          <line
            key={`s${i}`}
            x1={left + i * stringGap} y1={top}
            x2={left + i * stringGap} y2={top + usableH}
            stroke="var(--ss-tab-strings)" strokeWidth={i === 0 || i === 5 ? 1.2 : 0.8}
          />
        ))}
        {Array.from({ length: fretCount + 1 }, (_, i) => (
          <line
            key={`f${i}`}
            x1={left} y1={top + i * fretGap}
            x2={left + usableW} y2={top + i * fretGap}
            stroke="var(--ss-tab-measure)" strokeWidth={i === 0 && minFret === 0 ? 2.5 : 0.8}
          />
        ))}
        {minFret > 0 && (
          <text x={1} y={top + fretGap * 0.7} fill="var(--ss-text-muted)" fontSize={7} fontWeight={700}>{minFret}</text>
        )}
        {positions.map((p, i) => {
          // Standard diagrams run low E on the left to high E on the right.
          const sx = left + (6 - p.string) * stringGap;
          const firstDisplayedFret = minFret === 0 ? 1 : minFret;
          const sy = p.fret === 0
            ? top - 5
            : top + (p.fret - firstDisplayedFret + 0.5) * fretGap;
          const fill = p.isChordTone === false ? dimAccent : accent;
          if (p.fret === 0) {
            return <circle key={i} cx={sx} cy={sy} r={2.3} fill="none" stroke={fill} strokeWidth={1.2} />;
          }
          return <circle key={i} cx={sx} cy={sy} r={p.isChordTone === false ? 2.4 : 3.2} fill={fill} />;
        })}
      </svg>
    </div>
  );
}
