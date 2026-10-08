import { isMockMode } from "./api/client";
import { useRoute } from "./router";
import { useApp } from "./state";
import { BasketPage } from "./pages/BasketPage";
import { FreshnessPage } from "./pages/FreshnessPage";
import { ProductPage } from "./pages/ProductPage";
import { SearchPage } from "./pages/SearchPage";

const NAV = [
  { href: "#/", name: "search", label: "חיפוש", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" },
  { href: "#/basket", name: "basket", label: "סל", icon: "M3 5h2l2.2 10h10.6L20 8H6.2M9 20h.01M17 20h.01" },
  { href: "#/freshness", name: "freshness", label: "טריות נתונים", icon: "M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
] as const;

export function App() {
  const route = useRoute();
  const { items } = useApp();
  const active = route.name === "product" ? "search" : route.name;
  const count = items.reduce((n, i) => n + i.qty, 0);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand"><span className="logo">₪</span>מחירי סופר</a>
        <nav className="nav-top" aria-label="ניווט ראשי">
          {NAV.map((n) => (
            <a key={n.name} href={n.href} className={active === n.name ? "active" : ""} aria-current={active === n.name ? "page" : undefined}>
              {n.label}
              {n.name === "basket" && count > 0 && <span className="count">{count}</span>}
            </a>
          ))}
        </nav>
        {isMockMode() && <span className="mock-pill">נתוני דמו</span>}
      </header>
      <main>
        {route.name === "search" && <SearchPage />}
        {route.name === "product" && <ProductPage key={route.ref} refId={route.ref} />}
        {route.name === "basket" && <BasketPage />}
        {route.name === "freshness" && <FreshnessPage />}
      </main>
      <nav className="nav-bottom" aria-label="ניווט תחתון">
        {NAV.map((n) => (
          <a key={n.name} href={n.href} className={active === n.name ? "active" : ""}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path d={n.icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{n.label}</span>
            {n.name === "basket" && count > 0 && <span className="count">{count}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}
