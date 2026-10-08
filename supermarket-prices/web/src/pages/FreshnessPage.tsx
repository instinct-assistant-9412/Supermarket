import { Empty, ErrorBox, Loading } from "../components/ui";
import { chainColor, formatAge } from "../format";
import { useApp, useAsync } from "../state";

const LABEL = { fresh: "עדכני", stale: "ישן", never: "אין נתונים" } as const;

export function FreshnessPage() {
  const { api } = useApp();
  const fresh = useAsync(() => api.freshness(), []);
  const review = useAsync(() => api.review(), []);
  const chains = fresh.data ?? [];
  const stale = chains.filter((c) => c.status !== "fresh").length;

  return (
    <section className="page">
      <div className="card-head">
        <h1>טריות הנתונים</h1>
        <button type="button" className="btn ghost" onClick={() => { fresh.reload(); review.reload(); }}>רענון</button>
      </div>
      {fresh.loading && <Loading />}
      {fresh.error && <ErrorBox message={fresh.error} onRetry={fresh.reload} />}
      {!fresh.loading && !fresh.error && chains.length === 0 && <Empty title="עדיין לא נקלטו נתונים">הריצו קליטה ראשונה (ראו README).</Empty>}
      {chains.length > 0 && (
        <>
          <p className={`banner ${stale ? "warn-banner" : "ok-banner"}`} role="status">
            {stale === 0 ? "כל הרשתות עודכנו בזמן" : `${stale} מתוך ${chains.length} רשתות עם נתונים ישנים או חסרים`}
          </p>
          <ul className="fresh-grid">
            {chains.map((c) => (
              <li key={c.chainId} className="card fresh-card">
                <div className="fresh-top">
                  <span className="dot big" style={{ background: chainColor(c.chainId) }} />
                  <strong>{c.chainName ?? c.chainId}</strong>
                  <span className={`status ${c.status}`}>{LABEL[c.status]}</span>
                </div>
                <div className="fresh-age">{formatAge(c.ageHours)}</div>
                <dl>
                  <div><dt>סניפים</dt><dd>{c.stores.toLocaleString("he-IL")}</dd></div>
                  <div><dt>מחירים נוכחיים</dt><dd>{c.currentPrices.toLocaleString("he-IL")}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="card">
        <h2>התאמות לבדיקה ידנית</h2>
        {review.loading && <Loading />}
        {review.data && review.data.length === 0 && <p className="muted">אין התאמות שממתינות לבדיקה.</p>}
        {review.data && review.data.length > 0 && (
          <ul className="review-list">
            {review.data.slice(0, 20).map((r) => (
              <li key={`${r.chainId}-${r.itemCode}`}>
                <span>{r.rawName}</span>
                <span className="muted small">← {r.productName}{r.matchScore !== null ? ` (${Math.round(r.matchScore * 100)}%)` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
