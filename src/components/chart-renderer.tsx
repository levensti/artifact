"use client";

import {
  formatValue,
  niceTicks,
  type NormalizedChart,
} from "@/lib/diagram/chart-spec";

/**
 * Native, theme-aware renderers for the ```chart fence. The model supplies
 * only the data (see chart-spec.ts); everything visual lives here, drawn
 * with plain HTML/SVG and the app's CSS variables — no chart library, no
 * model-controlled styling, identical look in light and dark.
 */

/** Series swatches cycle through the app palette. */
function seriesColor(i: number): string {
  return `var(--chart-${(i % 5) + 1})`;
}

export default function ChartRenderer({ chart }: { chart: NormalizedChart }) {
  return (
    <figure className="m-0">
      {chart.title && (
        <figcaption className="mb-2 text-[0.8125rem] font-medium text-foreground">
          {chart.title}
        </figcaption>
      )}
      {chart.type === "bar" ? (
        <BarChart chart={chart} />
      ) : chart.type === "line" ? (
        <LineChart chart={chart} />
      ) : (
        <DonutChart chart={chart} />
      )}
      <SeriesLegend chart={chart} />
    </figure>
  );
}

/** Swatch + name per series; pie carries its own label list instead. */
function SeriesLegend({ chart }: { chart: NormalizedChart }) {
  if (chart.type === "pie") return null;
  if (chart.series.length < 2 && !chart.series.some((s) => s.name)) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
      {chart.series.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-[2px]"
            style={{ background: seriesColor(i) }}
          />
          {s.name ?? `Series ${i + 1}`}
        </span>
      ))}
    </div>
  );
}

/**
 * Horizontal bars: rows give long category labels a full text line and spend
 * the side panel's scarce width on the value axis only once. Values sit in a
 * right-aligned column so figures line up like a table.
 */
function BarChart({ chart }: { chart: NormalizedChart }) {
  const all = chart.series.flatMap((s) => s.values);
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all);
  const range = max - min || 1;
  const pos = (v: number) => ((v - min) / range) * 100;
  const zero = pos(0);

  return (
    <div className="flex flex-col gap-1.5">
      {chart.labels.map((label, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-2"
        >
          <div
            className="truncate text-xs text-muted-foreground"
            title={label}
          >
            {label}
          </div>
          <div className="flex flex-col gap-px">
            {chart.series.map((s, si) => {
              const v = s.values[i];
              const left = Math.min(pos(v), zero);
              // A floor keeps zero/near-zero values visible as a sliver.
              const width = Math.max(Math.abs(pos(v) - zero), 0.75);
              return (
                <div key={si} className="flex items-center gap-1.5">
                  <div className="relative h-[11px] flex-1 overflow-hidden rounded-[3px] bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]">
                    {min < 0 && (
                      <div
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-border"
                        style={{ left: `${zero}%` }}
                      />
                    )}
                    <div
                      className="absolute inset-y-0 rounded-[2px]"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: seriesColor(si),
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-[0.6875rem] text-muted-foreground tabular-nums">
                    {formatValue(v, chart.unit)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Categorical-x line chart with nice-number gridlines, thinned x labels. */
function LineChart({ chart }: { chart: NormalizedChart }) {
  const W = 480;
  const H = 210;
  const PAD = { left: 48, right: 12, top: 10, bottom: 26 };

  const all = chart.series.flatMap((s) => s.values);
  const dMin = Math.min(0, ...all);
  const dMax = Math.max(...all);
  const ticks = niceTicks(dMin, dMax === dMin ? dMin + 1 : dMax, 4);
  const yMin = Math.min(dMin, ticks[0] ?? dMin);
  const yMax = Math.max(
    dMax === dMin ? dMin + 1 : dMax,
    ticks[ticks.length - 1] ?? dMax,
  );

  const n = chart.labels.length;
  const x = (i: number) =>
    PAD.left + (n === 1 ? 0 : (i * (W - PAD.left - PAD.right)) / (n - 1));
  const y = (v: number) =>
    PAD.top + (H - PAD.top - PAD.bottom) * (1 - (v - yMin) / (yMax - yMin));

  // Thin x labels to at most ~6, always keeping the first and last.
  const labelStep = Math.ceil(n / 6);
  const showLabel = (i: number) =>
    i === n - 1 || (i % labelStep === 0 && n - 1 - i >= labelStep / 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={chart.title ?? "line chart"}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--border)"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 7}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill="var(--muted-foreground)"
          >
            {formatValue(t, chart.unit)}
          </text>
        </g>
      ))}
      {chart.labels.map(
        (label, i) =>
          showLabel(i) && (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {label.length > 12 ? `${label.slice(0, 11)}…` : label}
            </text>
          ),
      )}
      {chart.series.map((s, si) => (
        <g key={si}>
          <polyline
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={seriesColor(si)}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {s.values.map((v, i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={2.5}
              fill={seriesColor(si)}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Donut with a side legend (labels never sit on slices — too cramped). */
function DonutChart({ chart }: { chart: NormalizedChart }) {
  const values = chart.series[0].values;
  const total = values.reduce((a, b) => a + b, 0);
  const R = 38;
  const C = 2 * Math.PI * R;

  const slices = values.map((v, i) => ({
    frac: v / total,
    offset: values.slice(0, i).reduce((a, b) => a + b, 0) / total,
  }));

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <svg
        viewBox="0 0 100 100"
        className="h-28 w-28 shrink-0"
        role="img"
        aria-label={chart.title ?? "pie chart"}
      >
        {slices.map((s, i) => (
          <circle
            key={i}
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke={seriesColor(i)}
            strokeWidth={17}
            strokeDasharray={`${s.frac * C} ${C}`}
            strokeDashoffset={-s.offset * C}
            transform="rotate(-90 50 50)"
          />
        ))}
      </svg>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
        {chart.labels.map((label, i) => (
          <li key={i} className="flex items-baseline gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 self-center rounded-[3px]"
              style={{ background: seriesColor(i) }}
            />
            <span className="text-muted-foreground">{label}</span>
            <span className="text-foreground tabular-nums">
              {formatValue(values[i], chart.unit)}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
              ({Math.round((values[i] / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
