import { useEffect, useState } from "react";

export type Route = { name: "search" } | { name: "product"; ref: string } | { name: "basket" } | { name: "freshness" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  const p = path.match(/^\/product\/(.+)$/);
  if (p) return { name: "product", ref: decodeURIComponent(p[1]!) };
  if (path === "/basket") return { name: "basket" };
  if (path === "/freshness") return { name: "freshness" };
  return { name: "search" };
}

export const productHref = (ref: string | number) => `#/product/${encodeURIComponent(String(ref))}`;

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
