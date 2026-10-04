"""MCP server so agents (Claude, Cursor, custom) can query prices.

Run:  smp mcp            (stdio - for local agents)
      smp mcp --http     (streamable HTTP on :8001 - for remote agents; put auth in front of it!)
Claude Desktop config: {"mcpServers": {"prices": {"command": "smp", "args": ["mcp"], "env": {"DATABASE_URL": "..."}}}}
"""
import json
from datetime import date, datetime
from decimal import Decimal

from mcp.server.fastmcp import FastMCP

from . import services
from .db import session_scope

mcp = FastMCP("israeli-supermarket-prices")


def _j(obj) -> str:
    def default(o):
        if isinstance(o, Decimal):
            return float(o)
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        raise TypeError(type(o))
    return json.dumps(obj, default=default, ensure_ascii=False)


@mcp.tool()
def search_products(query: str, limit: int = 10) -> str:
    """Find products by Hebrew name or barcode. Returns barcode (gtin), name, manufacturer, number of chains carrying it."""
    with session_scope() as s:
        return _j(services.search_products(s, query, limit))


@mcp.tool()
def get_product_prices(gtin: str, city: str | None = None) -> str:
    """Current prices of one product (by barcode) across stores/chains, cheapest first. Optional city filter (Hebrew name)."""
    with session_scope() as s:
        return _j(services.product_prices(s, gtin, city=city, limit=50))


@mcp.tool()
def cheapest_basket(gtins_with_qty: dict[str, float], city: str, top: int = 3) -> str:
    """Cheapest single store for a shopping basket in a city. gtins_with_qty maps barcode -> quantity."""
    items = [{"gtin": g, "qty": q} for g, q in gtins_with_qty.items()]
    with session_scope() as s:
        return _j(services.cheapest_basket(s, items, city=city, top=top))


@mcp.tool()
def price_history(gtin: str, days: int = 90, chain_id: str | None = None) -> str:
    """Price changes over time for a barcode (optionally one chain)."""
    with session_scope() as s:
        return _j(services.price_history(s, gtin, chain_id=chain_id, days=days))


@mcp.tool()
def recent_price_drops(days: int = 7, min_pct: float = 10, city: str | None = None) -> str:
    """Biggest recent price drops (percent), optionally in one city."""
    with session_scope() as s:
        return _j(services.price_drops(s, days, min_pct, city))


@mcp.tool()
def data_freshness() -> str:
    """Per-chain data quality: last update, coverage, issues. Check this before trusting a price."""
    with session_scope() as s:
        return _j(services.data_freshness(s))


def run(http: bool = False):
    if http:
        mcp.settings.port = 8001
        mcp.run(transport="streamable-http")
    else:
        mcp.run()
