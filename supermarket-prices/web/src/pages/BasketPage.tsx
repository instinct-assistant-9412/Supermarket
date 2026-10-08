import { useEffect, useMemo, useState } from "react";
import type { BasketResponse } from "../api/types";
import { Empty, ErrorBox, Loading, ModeToggle, Qty } from "../components/ui";
import { chainColor, formatPrice } from "../format";
import { productHref } from "../router";
import { toBasketInput, useApp, useAsync } from "../state";

export function BasketPage() {
  const { api, items, setQty, remove, clear, online, setOnline } = useApp();
  const [area, setArea] = useState("");
  const [areaQ, setAreaQ] = useState("");
  const [partial, setPartial] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAreaQ(area.trim()), 300);
    return () => clearTimeout(t);
  }, [area]);

  const key = JSON.stringify([items.map((i) => [i.id, i.qty]), areaQ, online, partial]);
  const res = useAsync<BasketResponse | null>(
    () => (items.length ? api.basket(items.map(toBasketInput), { online, text: areaQ || undefined }, !partial) : Promise.resolve(null)),
    [key],
  );

  const productNames = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);
  const stores = res.data?.stores ?? [];
  const best = stores[0];
  const worstComplete = Math.max(0, ...stores.filter((s) => s.missingProductIds.length === 0).map((s) => s.total));

  const perChain = useMemo(() => {
    const m = new Map<string, (typeof stores)[number]>();
    for (const s of stores) {
      if (s.missingProductIds.length) continue;
      const cur = m.get(s.chainId);
      if (!cur || s.total < cur.total) m.set(s.chainId, s);
    }
    return [...m.values()].sort((a, b) => a.total - b.total);
  }, [stores]);

  if (items.length === 0) {
    return (
      <section className="page">
        <h1>סל קניות</h1>
        <Empty title="הסל ריק">
          <a className="btn primary" href="#/">חיפוש מוצרים להוספה</a>
        </Empty>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="card-head">
        <h1>סל קניות</h1>
        <button type="button" className="btn ghost" onClick={clear}>ריקון הסל</button>
      </div>

      <div className="grid-2 basket-grid">
        <div className="card">
          <h2>המוצרים ({items.length})</h2>
          <ul className="basket-items">
            {items.map((i) => (
              <li key={i.id}>
                <a href={productHref(i.id)} className="basket-name">{i.name}</a>
                <Qty value={i.qty} onChange={(n) => setQty(i.id, n)} label={i.name} />
                <button type="button" className="icon-btn" aria-label={`הסרה: ${i.name}`} onClick={() => remove(i.id)}>✕</button>
              </li>
            ))}
          </ul>
          <div className="filters">
            <ModeToggle online={online} onChange={setOnline} />
            {!online && (
              <label className="field">
                <span>עיר או שכונה (אופציונלי)</span>
                <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="למשל: ראש העין" />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
              הצגת חנויות שחסרים בהן מוצרים
            </label>
          </div>
        </div>

        <div className="card results-card">
          <h2>איפה הכי זול</h2>
          {res.loading && <Loading label="מחשב סל..." />}
          {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
          {!res.loading && !res.error && res.data && (
            <>
              {res.data.resolved.some((r) => !r.product) && (
                <p className="warn">חלק מהמוצרים לא נמצאו ולא נכללו: {res.data.resolved.filter((r) => !r.product).map((r) => r.input.query ?? r.input.gtin).join(", ")}</p>
              )}
              {!best ? (
                <Empty title="אין חנות שמחזיקה את כל המוצרים">
                  נסו להסיר מוצר, לבטל את סינון האזור, או להציג גם חנויות עם כיסוי חלקי.
                </Empty>
              ) : (
                <>
                  <div className="winner">
                    <span className="badge good">הסל הזול ביותר</span>
                    <strong className="winner-total">{formatPrice(best.total)}</strong>
                    <span>{best.chainName} · {best.storeName}</span>
                    {worstComplete > best.total && best.missingProductIds.length === 0 && (
                      <span className="saving">חיסכון של {formatPrice(worstComplete - best.total)} לעומת החנות היקרה ביותר</span>
                    )}
                  </div>

                  {perChain.length > 1 && (
                    <>
                      <h3>הזול ביותר בכל רשת</h3>
                      <ul className="bars">
                        {perChain.map((s) => (
                          <li key={s.chainId}>
                            <span className="bar-label">{s.chainName ?? s.chainId}</span>
                            <span className="bar-track"><span style={{ width: `${(s.total / (worstComplete || s.total)) * 100}%`, background: chainColor(s.chainId) }} /></span>
                            <span className="bar-value">{formatPrice(s.total)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <h3>כל החנויות</h3>
                  <ul className="store-results">
                    {stores.map((s, idx) => (
                      <li key={s.storeKey} className={idx === 0 ? "first" : ""}>
                        <span className="dot" style={{ background: chainColor(s.chainId) }} />
                        <span className="store-info">
                          <strong>{s.storeName ?? `סניף ${s.storeKey}`}</strong>
                          <span className="muted small">{s.chainName}{s.city && !s.isOnline ? ` · ${s.city}` : ""}</span>
                          {s.missingProductIds.length > 0 && (
                            <span className="warn small">חסר: {s.missingProductIds.map((id) => productNames.get(id) ?? `#${id}`).join(", ")}</span>
                          )}
                        </span>
                        <span className="store-price">{formatPrice(s.total)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
