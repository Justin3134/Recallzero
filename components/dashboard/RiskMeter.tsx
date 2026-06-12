"use client";

function riskColor(score: number) {
  if (score >= 66) return "#EF4444";
  if (score >= 33) return "#EAB308";
  return "#22C55E";
}

function riskLabel(score: number) {
  if (score >= 66) return "High exposure";
  if (score >= 33) return "Elevated";
  return "Stable";
}

export function RiskMeter({
  score,
  sparkline,
}: {
  score: number;
  sparkline: number[];
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = riskColor(clamped);
  const r = 64;
  const circumference = 2 * Math.PI * r;
  // Gauge spans 270 degrees.
  const arcFraction = 0.75;
  const arcLength = circumference * arcFraction;
  const filled = arcLength * (clamped / 100);

  const max = Math.max(...sparkline, 1);
  const points = sparkline
    .map((v, i) => {
      const x = (i / Math.max(sparkline.length - 1, 1)) * 100;
      const y = 28 - (v / max) * 24;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="170" height="170" viewBox="0 0 170 170">
          <g transform="rotate(135 85 85)">
            <circle
              cx="85"
              cy="85"
              r={r}
              fill="none"
              stroke="#27272a"
              strokeWidth="11"
              strokeDasharray={`${arcLength} ${circumference}`}
              strokeLinecap="round"
            />
            <circle
              cx="85"
              cy="85"
              r={r}
              fill="none"
              stroke={color}
              strokeWidth="11"
              strokeDasharray={`${filled} ${circumference}`}
              strokeLinecap="round"
              style={{
                transition: "stroke-dasharray 1s ease, stroke 1s ease",
                filter: `drop-shadow(0 0 8px ${color}66)`,
              }}
            />
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-extrabold tracking-tight" style={{ color }}>
            {Math.round(clamped)}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1">
            {riskLabel(clamped)}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-1 mb-2">
        Your regulatory risk this week
      </p>
      <svg width="100%" height="32" viewBox="0 0 100 32" preserveAspectRatio="none" className="max-w-45">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.8"
        />
      </svg>
    </div>
  );
}
