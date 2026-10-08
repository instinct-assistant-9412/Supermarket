import { ProductImage } from "../components/ProductImage";
import { useMemo, useState } from "react";
import { PriceChart } from "../components/PriceChart";
import { Empty, ErrorBox, Loading, ModeToggle, Qty } from "../components/ui";
import { buildChainSeries, chainColor, currentPrices, formatDate, formatPrice } from "../format";
import { useApp, useAsync } from "../state";

const RANGES = [
  { label: "30 יום", days: 30 },
  { label: "90 יום", days: 90 },
  { label: "הכל", days: 0 },
] as const;

export function ProductPage({ refId }: { refId: string }) {
  const { api, add, online, setOnline } = useApp();
  const [range, setRange] = useState<number>(90);
  const [qty, setQty] = useState(1);
  const hist = useAsync(() => api.history(refId), [refId]);
  const stores = useAsync(() => api.stores(), []);

  const storeMap = useMemo(() => new Map((stores.data ?? []).map((s) => [s.storeKey, s])), [stores.data]);
  const chainNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of stores.data ?? []) if (s.chainName) m[s.chainId] = s.chainName;
    return m;
  }, [stores.data]);

  const isOnline = (storeKey: string) => storeMap.get(storeKey)?.isOnline === true;

  const data = hist.data;
  const current = useMemo(() => (data ? currentPrices(data.points).filter((c) => isOnline(c.storeKey) === online) : []), [data, online, storeMap]);
  const byChain = useMemo(() => {
    const m = new Map<string, typeof current>();
    for (const c of current) m.set(c.chainId, [...(m.get(c.chainId) ?? []), c].sort((a, b) => a.price - b.price));
    return [...m.entries()].sort((a, b) => a[1][0]!.price - b[1][0]!.price);
  }, [current]);
  const cheapest = byChain[0]?.[1][0]?.price;
  const priciest = Math.max(0, ...current.map((c) => c.price));

  const series = useMemo(() => {
    if (!data) return [];
    const cutoff = range ? Date.now() - range * 86400_000 : 0;
    // נקודות לפני הטווח נשארות כדי שהקו יתחיל מהמחיר הנכון; מקצצים רק את ציר הזמן
    return buildChainSeries(data.points, (p) => isOnline(p.storeKey) === online).map((s) => {
      if (!cutoff) return s;
      const before = [...s.points].reverse().find((p) => p.t < cutoff);
      const inside = s.points.filter((p) => p.t >= cutoff);
      return { ...s, points: before ? [{ t: cutoff, price: before.price }, ...inside] : inside };
    });
  }, [data, online, range, storeMap]);

  if (hist.loading) return <Loading />;
  if (hist.error || !data) return <ErrorBox message={hist.error ?? "המוצר לא נמצא"} onRetry={hist.reload} />;
  const p = data.product;

  return (
    <section className="page">
      <a href="#/" className="back">← חזרה לחיפוש</a>
      <header className="product-head">
        <div className="product-identity">
          <ProductImage gtin={p.gtin} name={p.name} large />
          <div>
          <h1>{p.name}</h1>
          <p className="muted small">{p.gtin ? `ברקוד ${p.gtin}` : "ללא ברקוד (קוד פנימי של רשת)"}</p>
        </div>
        </div>
        <div className="add-row">
          <Qty value={qty} onChange={(n) => setQty(Math.max(1, n))} label={p.name} />
          <button type="button" className="btn primary" onClick={() => { add(p, qty); setQty(1); }}>
            הוספה לסל
          </button>
        </div>
      </header>

      <ModeToggle online={online} onChange={setOnline} />

      <div className="grid-2">
        <div className="card">
          <h2>מחיר נוכחי לפי רשת</h2>
          {byChain.length === 0 ? (
            <Empty title="אין מחירים לסוג החנות שנבחר">בדקו את טריות הנתונים ואת תוצאות קליטת חנויות האונליין.</Empty>
          ) : (
            <ul className="chain-list">
              {byChain.map(([chainId, rows], idx) => {
                const best = rows[0]!;
                return (
                  <li key={chainId}>
                    <details open={idx === 0}>
                      <summary>
                        <span className="dot" style={{ background: chainColor(chainId) }} />
                        <span className="chain-name">{chainNames[chainId] ?? chainId}</span>
                        {best.price === cheapest && <span className="badge good">הכי זול</span>}
                        <span className="chain-price">{formatPrice(best.price)}</span>
                      </summary>
                      <ul className="store-list">
                        {rows.map((r) => (
                          <li key={r.storeKey}>
                            <span className="store-name">{storeMap.get(r.storeKey)?.storeName ?? `סניף ${r.storeKey}`}</span>
                            <span className="muted small">מאז {formatDate(r.since)}</span>
                            <span className="bar" aria-hidden><span style={{ width: `${(r.price / (priciest || 1)) * 100}%`, background: chainColor(chainId) }} /></span>
                            <span className="store-price">{formatPrice(r.price)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>היסטוריית מחיר</h2>
            <div className="segmented small" role="radiogroup" aria-label="טווח זמן">
              {RANGES.map((r) => (
                <button key={r.days} type="button" role="radio" aria-checked={range === r.days} className={range === r.days ? "on" : ""} onClick={() => setRange(r.days)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <PriceChart series={series} chainNames={chainNames} />
          <p className="muted small">בכל רשת מוצג המחיר הזול ביותר מבין הסניפים שלה.</p>
        </div>
      </div>
    </section>
  );
}
