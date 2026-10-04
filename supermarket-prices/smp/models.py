"""DB schema (SQLAlchemy 2.0). PostgreSQL only (uses ON CONFLICT, JSONB, pg_trgm).

Key idea: three layers
  chain_items  = what a chain calls an item (their code, their name)   [raw layer]
  products     = canonical product, identified by GTIN                 [normalized layer]
  prices_*     = price per (store, chain_item)                         [facts]
"""
from datetime import datetime

from sqlalchemy import (BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric,
                        String, Text, UniqueConstraint, func)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Chain(Base):
    __tablename__ = "chains"
    id: Mapped[int] = mapped_column(primary_key=True)
    chain_id: Mapped[str] = mapped_column(String(20), unique=True)  # gov.il ChainId (13 digits)
    name: Mapped[str | None] = mapped_column(String(200))
    scraper_name: Mapped[str | None] = mapped_column(String(80))  # e.g. SHUFERSAL


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(primary_key=True)
    chain_pk: Mapped[int] = mapped_column(ForeignKey("chains.id"))
    sub_chain_id: Mapped[str] = mapped_column(String(20), default="0")
    store_code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(300))
    address: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(120), index=True)
    city_norm: Mapped[str | None] = mapped_column(String(120), index=True)
    zip_code: Mapped[str | None] = mapped_column(String(20))
    store_type: Mapped[str | None] = mapped_column(String(40))
    lat: Mapped[float | None] = mapped_column(Numeric(9, 6))  # filled by a geocoding job (not in source data)
    lon: Mapped[float | None] = mapped_column(Numeric(9, 6))
    __table_args__ = (UniqueConstraint("chain_pk", "sub_chain_id", "store_code"),)


class Product(Base):
    """Canonical product. gtin is NULL for products created only from fuzzy matching."""
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    gtin: Mapped[str | None] = mapped_column(String(14), unique=True)
    name: Mapped[str] = mapped_column(String(400))
    name_norm: Mapped[str] = mapped_column(String(400))
    manufacturer: Mapped[str | None] = mapped_column(String(200))
    size_value: Mapped[float | None] = mapped_column(Numeric(12, 3))
    size_unit: Mapped[str | None] = mapped_column(String(10))  # g | ml | unit
    category: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("ix_products_name_trgm", "name_norm", postgresql_using="gin",
                            postgresql_ops={"name_norm": "gin_trgm_ops"}),)


class ChainItem(Base):
    __tablename__ = "chain_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    chain_pk: Mapped[int] = mapped_column(ForeignKey("chains.id"))
    item_code: Mapped[str] = mapped_column(String(40))
    item_type: Mapped[str | None] = mapped_column(String(5))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), index=True)
    gtin: Mapped[str | None] = mapped_column(String(14), index=True)
    name_raw: Mapped[str] = mapped_column(String(400))
    name_norm: Mapped[str] = mapped_column(String(400))
    manufacturer: Mapped[str | None] = mapped_column(String(200))
    is_weighted: Mapped[bool] = mapped_column(Boolean, default=False)
    unit_of_measure: Mapped[str | None] = mapped_column(String(40))
    quantity: Mapped[float | None] = mapped_column(Numeric(12, 3))
    match_method: Mapped[str] = mapped_column(String(20), default="none")  # gtin | fuzzy | manual | none
    match_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("chain_pk", "item_code"),)


class PriceCurrent(Base):
    __tablename__ = "prices_current"
    store_pk: Mapped[int] = mapped_column(ForeignKey("stores.id"), primary_key=True)
    chain_item_pk: Mapped[int] = mapped_column(ForeignKey("chain_items.id"), primary_key=True)
    price: Mapped[float] = mapped_column(Numeric(10, 2))
    unit_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    price_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # per source
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # last file that contained it
    __table_args__ = (Index("ix_prices_current_item", "chain_item_pk"),)


class PriceHistory(Base):
    """Append-only; a row is written only when the price CHANGES (keeps the table small).
    Candidate for monthly partitioning once it passes ~100M rows."""
    __tablename__ = "price_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_pk: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    chain_item_pk: Mapped[int] = mapped_column(ForeignKey("chain_items.id"))
    price: Mapped[float] = mapped_column(Numeric(10, 2))
    unit_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_price_history_lookup", "chain_item_pk", "store_pk", "valid_from"),
                      Index("ix_price_history_time", "valid_from"))


class IngestFile(Base):
    __tablename__ = "ingest_files"
    id: Mapped[int] = mapped_column(primary_key=True)
    chain_pk: Mapped[int | None] = mapped_column(ForeignKey("chains.id"))
    store_pk: Mapped[int | None] = mapped_column(ForeignKey("stores.id"))
    file_name: Mapped[str] = mapped_column(String(300))
    file_type: Mapped[str] = mapped_column(String(20))  # stores | price | pricefull | promo | promofull
    file_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sha256: Mapped[str] = mapped_column(String(64))
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="ok")  # ok | error | skipped
    error: Mapped[str | None] = mapped_column(Text)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("file_name", "sha256"),
                      Index("ix_ingest_files_chain_ts", "chain_pk", "file_ts"))


class MatchCandidate(Base):
    """Fuzzy matches that were NOT auto-applied; review queue (CLI/admin UI later)."""
    __tablename__ = "match_candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    chain_item_pk: Mapped[int] = mapped_column(ForeignKey("chain_items.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    score: Mapped[float] = mapped_column(Numeric(4, 3))
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | accepted | rejected
    __table_args__ = (UniqueConstraint("chain_item_pk", "product_id"),)


class QualityReport(Base):
    __tablename__ = "quality_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    chain_pk: Mapped[int] = mapped_column(ForeignKey("chains.id"))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ok: Mapped[bool] = mapped_column(Boolean)
    metrics: Mapped[dict] = mapped_column(JSONB)
    issues: Mapped[list] = mapped_column(JSONB)


def init_db(engine) -> None:
    from sqlalchemy import text
    with engine.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    Base.metadata.create_all(engine)
