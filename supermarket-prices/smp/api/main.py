from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import services
from ..config import settings
from ..db import get_session


def require_key(x_api_key: str | None = Header(default=None)):
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(401, "invalid or missing X-API-Key")


app = FastAPI(title="Supermarket Prices API", version="0.1.0", dependencies=[Depends(require_key)])


class BasketItem(BaseModel):
    gtin: str = Field(description="Barcode (EAN/GTIN)")
    qty: float = 1


class BasketRequest(BaseModel):
    items: list[BasketItem] = Field(min_length=1, max_length=100)
    city: str | None = None
    lat: float | None = None
    lon: float | None = None
    radius_km: float | None = Field(default=None, gt=0, le=100)
    chain_ids: list[str] | None = None
    allow_missing: bool = False
    top: int = Field(default=5, ge=1, le=50)


@app.get("/health")
def health(s: Session = Depends(get_session)):
    s.execute(text("SELECT 1"))
    return {"ok": True}


@app.get("/chains")
def chains(s: Session = Depends(get_session)):
    return [dict(r) for r in s.execute(text("SELECT chain_id, name, scraper_name FROM chains ORDER BY name")).mappings()]


@app.get("/stores")
def stores(city: str | None = None, chain_id: str | None = None, limit: int = Query(200, le=1000), s: Session = Depends(get_session)):
    return services.list_stores(s, city, chain_id, limit)


@app.get("/products/search")
def products_search(q: str = Query(min_length=2), limit: int = Query(20, le=100), s: Session = Depends(get_session)):
    return services.search_products(s, q, limit)


@app.get("/products/{gtin}/prices")
def product_prices(gtin: str, city: str | None = None, lat: float | None = None, lon: float | None = None,
                   radius_km: float | None = None, s: Session = Depends(get_session)):
    r = services.product_prices(s, gtin, city, lat, lon, radius_km)
    if not r["product"]:
        raise HTTPException(404, "unknown barcode")
    return r


@app.get("/products/{gtin}/history")
def product_history(gtin: str, chain_id: str | None = None, store_id: int | None = None, days: int = Query(90, le=730),
                    s: Session = Depends(get_session)):
    return services.price_history(s, gtin, chain_id, store_id, days)


@app.get("/price-drops")
def price_drops(days: int = Query(7, le=90), min_pct: float = Query(10, ge=1, le=99), city: str | None = None,
                gtin: str | None = None, limit: int = Query(50, le=500), s: Session = Depends(get_session)):
    return services.price_drops(s, days, min_pct, city, gtin, limit)


@app.post("/basket/cheapest")
def basket_cheapest(req: BasketRequest, s: Session = Depends(get_session)):
    if not (req.city or (req.lat is not None and req.lon is not None and req.radius_km)):
        raise HTTPException(422, "provide city, or lat+lon+radius_km")
    return services.cheapest_basket(s, [i.model_dump() for i in req.items], req.city, req.lat, req.lon, req.radius_km,
                                    req.chain_ids, req.allow_missing, req.top)


@app.get("/quality/freshness")
def freshness(s: Session = Depends(get_session)):
    return services.data_freshness(s)
