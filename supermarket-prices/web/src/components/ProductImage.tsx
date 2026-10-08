import { useEffect, useRef, useState } from "react";
import { isMockMode } from "../api/client";

type ImageInfo = { url: string | null; sourceUrl?: string; licenseUrl?: string; retryAfter?: number };
const results = new Map<string, Promise<ImageInfo>>();
let queue = Promise.resolve();
let next = 0;
function lookup(gtin: string): Promise<ImageInfo> {
  const cached = results.get(gtin);
  if (cached) return cached;
  const job = queue.then(async () => {
    // Shared queue, not one burst per card. Server also rate-limits across users.
    await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
    next = Date.now() + 5100;
    try {
      const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/+$/, "");
      const r = await fetch(`${base}/products/${gtin}/image`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return { url: null };
      const image = await r.json() as ImageInfo;
      if (image.retryAfter) results.delete(gtin); // A later visit can retry, never a polling loop.
      return image;
    } catch { results.delete(gtin); return { url: null }; }
  });
  results.set(gtin, job);
  queue = job.then(() => {});
  return job;
}

export function ProductImage({ gtin, name, large = false }: { gtin: string | null; name: string; large?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    setImage(null); setFailed(false);
    if (visible && gtin && /^\d{13}$/.test(gtin) && !isMockMode()) {
      void lookup(gtin).then((info) => { if (active) setImage(info); });
    }
    return () => { active = false; };
  }, [gtin, visible]);
  const loaded = image?.url && !failed;
  return <div ref={root} className={`product-image${large ? " large" : ""}`}>
    <div className="image-frame">
      {loaded ? <img src={image.url!} alt={name} width={large ? 160 : 80} height={large ? 160 : 80} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> :
        <span className="image-placeholder" role="img" aria-label={`אין תמונה: ${name}`}>
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
          <span>אין תמונה</span>
        </span>}
    </div>
    {loaded && <span className="image-credit"><a href={image.sourceUrl} target="_blank" rel="noreferrer">Open Food Facts</a> · <a href={image.licenseUrl} target="_blank" rel="noreferrer">CC BY-SA</a></span>}
  </div>;
}
