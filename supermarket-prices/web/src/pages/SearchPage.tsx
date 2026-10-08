import { ProductImage } from "../components/ProductImage";
import { useEffect, useState } from "react";
import { productHref } from "../router";
import { formatPrice } from "../format";
import { useApp, useAsync } from "../state";
import { Empty, ErrorBox, Loading } from "../components/ui";

const SUGGESTIONS = ["חלב", "אורז", "שמן זית", "קפה", "ביצים", "לחם"];

export function SearchPage() {
  const { api, add, items } = useApp();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { data, error, loading, reload } = useAsync(() => (q ? api.search(q) : Promise.resolve([])), [q]);
  const inBasket = new Set(items.map((i) => i.id));

  return (
    <section className="page">
      <div className="hero">
        <h1>כמה זה באמת עולה?</h1>
        <p>חיפוש מוצר בכל הרשתות, מחיר נוכחי והיסטוריה, וסל קניות שמראה איפה הכי זול.</p>
        <div className="searchbox">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="חיפוש מוצר, למשל: חלב תנובה 3%"
            aria-label="חיפוש מוצר"
            autoFocus
            enterKeyHint="search"
          />
        </div>
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setText(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {!q && <Empty title="התחילו להקליד">החיפוש סובל שגיאות כתיב ושמות חלקיים.</Empty>}
      {q && loading && <Loading />}
      {q && error && <ErrorBox message={error} onRetry={reload} />}
      {q && data && !loading && data.length === 0 && <Empty title={`לא נמצאו מוצרים עבור "${q}"`}>נסו מילה קצרה יותר או שם כללי.</Empty>}
      {q && data && data.length > 0 && (
        <ul className="results" aria-label="תוצאות חיפוש">
          {data.map((p) => (
            <li key={p.id} className="card product-card">
              <div className="product-link">
                <ProductImage gtin={p.gtin} name={p.name} />
                <span className="product-copy"><a className="product-name" href={productHref(p.id)}>{p.name}</a>
                <span className="muted small">
                  {p.gtin ? `ברקוד ${p.gtin} · ` : ""}
                  {p.chains} רשתות
                </span></span>
              </div>
              <div className="price-range">
                <span className="price-min">{formatPrice(p.minPrice)}</span>
                {p.maxPrice !== null && p.maxPrice !== p.minPrice && <span className="muted small">עד {formatPrice(p.maxPrice)}</span>}
              </div>
              <button type="button" className={`btn small${inBasket.has(p.id) ? " done" : " primary"}`} onClick={() => add(p)} aria-label={`הוספה לסל: ${p.name}`}>
                {inBasket.has(p.id) ? "בסל ✓ +1" : "הוספה לסל"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
