import { useMemo, useState } from "react";
import { chainColor, formatDate, formatPrice, type Series } from "../format";

interface Props {
  series: Series[];
  chainNames: Record<string, string>;
  now?: number;
  height?: number;
}

const W = 640;
const PAD = { l: 8, r: 52, t: 12, b: 26 };

/** גרף קווי מדרגות ב-SVG, בלי ספריות. ציר המחיר מימין (RTL), הזמן זורם משמאל לימין כמו בכל גרף. */
export function PriceChart({ series, chainNames, now = Date.now(), height = 260 }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const visible = series.filter((s) => !hidden.has(s.chainId));

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const tMax = Math.max(now, ...(all.length ? all.map((p) => p.t) : [now]));
    // לפחות שבוע בציר, כדי שנקודה בודדת (קליטה ראשונה) לא תיראה כתאריך אחד חוזר
    const tMin = Math.min(all.length ? Math.min(...all.map((p) => p.t)) : tMax, tMax - 7 * 86400_000);
    const shown = visible.flatMap((s) => s.points.map((p) => p.price));
    const lo = shown.length ? Math.min(...shown) : 0;
    const hi = shown.length ? Math.max(...shown) : 1;
    const pad = (hi - lo || hi * 0.1 || 1) * 0.15;
    return { tMin, tMax, lo: Math.max(0, lo - pad), hi: hi + pad };
  }, [series, visible, now]);

  const x = (t: number) => PAD.l + ((t - geo.tMin) / (geo.tMax - geo.tMin || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => height - PAD.b - ((v - geo.lo) / (geo.hi - geo.lo || 1)) * (height - PAD.t - PAD.b);

  const path = (s: Series) => {
    let d = "";
    s.points.forEach((p, i) => {
      d += i === 0 ? `M${x(p.t)},${y(p.price)}` : `H${x(p.t)}V${y(p.price)}`;
    });
    return d + `H${x(geo.tMax)}`;
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => geo.lo + (geo.hi - geo.lo) * f);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => geo.tMin + (geo.tMax - geo.tMin) * f);

  // ערך בכל סדרה בזמן ה-hover
  const hoverT = hover === null ? null : geo.tMin + hover * (geo.tMax - geo.tMin);
  const valueAt = (s: Series, t: number) => {
    let v: number | null = null;
    for (const p of s.points) if (p.t <= t) v = p.price;
    return v;
  };

  if (series.every((s) => s.points.length === 0)) return <p className="muted">אין היסטוריית מחירים לטווח שנבחר.</p>;

  return (
    <div className="chart">
      <div className="chart-legend" role="group" aria-label="רשתות בגרף">
        {series.map((s) => {
          const off = hidden.has(s.chainId);
          return (
            <button
              key={s.chainId}
              type="button"
              className={`legend-chip${off ? " off" : ""}`}
              aria-pressed={!off}
              onClick={() => setHidden((h) => { const n = new Set(h); if (off) n.delete(s.chainId); else n.add(s.chainId); return n; })}
            >
              <span className="dot" style={{ background: chainColor(s.chainId) }} />
              {chainNames[s.chainId] ?? s.chainId}
            </button>
          );
        })}
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="גרף היסטוריית מחירים לפי רשת"
        className="chart-svg"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const vx = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.min(1, Math.max(0, (vx - PAD.l) / (W - PAD.l - PAD.r))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={W - PAD.r + 6} y={y(v) + 4} className="axis">{v.toFixed(1)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={height - 6} className="axis" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>
            {formatDate(new Date(t).toISOString())}
          </text>
        ))}
        {visible.map((s) => (
          <path key={s.chainId} d={path(s)} fill="none" stroke={chainColor(s.chainId)} strokeWidth={2.4} strokeLinejoin="round" />
        ))}
        {hoverT !== null && (
          <g>
            <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.t} y2={height - PAD.b} className="cursor" />
            {visible.map((s) => {
              const v = valueAt(s, hoverT);
              return v === null ? null : <circle key={s.chainId} cx={x(hoverT)} cy={y(v)} r={4.5} fill={chainColor(s.chainId)} stroke="#fff" strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      <div className="chart-readout" aria-live="polite">
        {hoverT === null ? (
          <span className="muted">העבירו עכבר או אצבע על הגרף לראות מחירים בתאריך</span>
        ) : (
          <>
            <strong>{formatDate(new Date(hoverT).toISOString())}</strong>
            {visible.map((s) => {
              const v = valueAt(s, hoverT);
              return v === null ? null : (
                <span key={s.chainId} className="readout-item">
                  <span className="dot" style={{ background: chainColor(s.chainId) }} />
                  {chainNames[s.chainId] ?? s.chainId} {formatPrice(v)}
                </span>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
