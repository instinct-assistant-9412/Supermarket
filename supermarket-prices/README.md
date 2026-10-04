# supermarket-prices — שלד להשוואת מחירי סופרמרקטים (שלב 1)

שכבת נרמול + API + שרת MCP מעל נתוני "שקיפות מחירים" של רשתות השיווק בישראל.
את ההורדה מהרשתות עושה ספריית הקוד הפתוח `il-supermarket-scraper`; כאן נמצא מה שמעליה:
התאמת מוצרים בין רשתות לפי ברקוד, Postgres עם היסטוריית מחירים, בדיקות טריות/איכות, ו-API חי.

> ⚠️ **רישיון:** הסקרייפר ברישיון מותאם שאוסר שימוש מסחרי ללא אישור כתוב מהמחבר (ספי ארליך). אם הפרויקט מיועד להכנסה — קודם לקבל אישור, או לכתוב downloader משלך. פירוט בבלופרינט. הקוד בריפו הזה (מה שנכתב כאן) לא תלוי בסקרייפר חוץ מ-`smp/ingest/scrape.py`.

## הרצה מהירה (בלי סקרייפר, עם נתוני דוגמה)

```bash
cp .env.example .env
docker compose up -d db                  # Postgres 16 (כולל pg_trgm)
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
smp init-db
smp ingest --path sample_data            # 2 רשתות, 3 סניפים, יומיים של מחירים
smp quality                              # דוח טריות/איכות
smp api                                  # http://localhost:8000/docs
```

דוגמאות (הברקודים בנתוני הדוגמה נוצרים ע"י `scripts/make_sample_data.py`; קחו אותם מ-`/products/search?q=חלב`):

```bash
curl 'localhost:8000/products/search?q=חלב'
curl 'localhost:8000/products/<GTIN>/prices?city=ראש העין'
curl -X POST localhost:8000/basket/cheapest -H 'content-type: application/json' \
  -d '{"items":[{"gtin":"<GTIN>","qty":2}],"city":"ראש העין"}'
curl 'localhost:8000/price-drops?days=7&min_pct=10'
curl 'localhost:8000/quality/freshness'
```

## נתונים אמיתיים

```bash
pip install -e ".[scrape]"               # Python 3.10–3.12 בלבד (דרישת הסקרייפר)
smp scrape --list                        # שמות הרשתות בגרסה המותקנת (משתנים בין גרסאות!)
smp scrape --chains SHUFERSAL RAMI_LEVY --limit 20   # מריצים מכתובת IP ישראלית
smp ingest                               # קורא את DUMPS_DIR
smp quality
```
או דרך Docker: `docker compose --profile worker run --rm worker smp scrape ...`

מומלץ להפעיל `scrape → ingest → quality` ב-cron כל שעה-שעתיים.

## MCP

```bash
smp mcp                # stdio — לסוכנים מקומיים (Claude Desktop / Cursor)
smp mcp --http         # streamable HTTP בפורט 8001 (חובה לשים אימות לפניו!)
```
כלים: `search_products`, `get_product_prices`, `cheapest_basket`, `price_history`, `recent_price_drops`, `data_freshness`.

## מבנה

```
smp/models.py            סכמת DB (chains, stores, products, chain_items, prices_current, price_history, ingest_files, ...)
smp/normalize/barcode.py נרמול GTIN: checksum, ריפוד, זיהוי קודים פנימיים/שקיל
smp/normalize/names.py   נרמול שמות בעברית, חילוץ גודל, התאמה מטושטשת (למוצרים בלי ברקוד)
smp/ingest/parse.py      פרסור XML של PriceFull/Price/Stores (סובלני: gz, קידודים, שמות תגיות)
smp/ingest/loader.py     טעינה ל-DB; היסטוריה נכתבת רק בשינוי מחיר; idempotent
smp/ingest/scrape.py     עטיפה דקה ל-il-supermarket-scraper
smp/quality.py           בדיקות טריות, כיסוי סניפים, ירידה בגודל קבצים, קפיצות מחיר
smp/services.py          לוגיקת השאילתות (משותפת ל-API ול-MCP)
smp/api/main.py          FastAPI
smp/mcp_server.py        MCP
tests/                   יחידה + אינטגרציה מול Postgres אמיתי
```

בדיקות: `pytest` (יחידה). אינטגרציה: `TEST_DATABASE_URL=postgresql+psycopg2://smp:smp@localhost:5432/smp_test pytest` (ה-DB נמחק ונוצר מחדש — השתמשו ב-DB חד-פעמי!).

## מה נבדק ומה עדיין דורש בדיקה חיה

נבדק (נתוני דוגמה + Postgres אמיתי): פרסור, נרמול ברקוד, התאמה בין רשתות, היסטוריה, ירידות מחיר, סל זול, בדיקות איכות, ה-API וה-MCP.

**דורש בדיקה מול נתונים אמיתיים — לא נבדק:**
1. **מבנה התיקיות/שמות הקבצים** שהסקרייפר כותב ל-`dumps/` (ה-loader סורק רקורסיבית `*.xml/*.gz`, ומתעלם מ-`status`).
2. **ChainId / StoreId / SubChainId** בכל רשת — חלק מהרשתות שומרות את מספר הסניף בשם הקובץ בלבד או עם אפסים מובילים. `KNOWN_CHAINS` ב-`smp/chains.py` מכיל מזהים לפי זיכרון — לאמת מול קבצים אמיתיים.
3. **שמות תגיות וקידודים** (windows-1255, utf-16, `Products/Product` מול `Items/Item`) — הרחיבו `FIELD_SYNONYMS` ב-`parse.py`.
4. **פורמט תאריכים** של `PriceUpdateDate` (הקוד מניח שעון ישראל).
5. **איכות ההתאמה לפי ברקוד** — כמה פריטים מקבלים GTIN תקף בכל רשת (הדוח `gtin_share` ב-`smp quality` יראה את זה), ופריטי "שקיל"/קוד פנימי.
6. **סף ההתאמה המטושטשת** (`NameIndex.AUTO/REVIEW`) — לדגום ידנית 100 התאמות לפני שסומכים עליהן. התאמות בינוניות נכנסות ל-`match_candidates` לבדיקה.
7. **`pg_trgm`** (חיפוש מוצרים): נבדק רק עם תחליף; באימג' הרשמי של Postgres הוא זמין, תריצו `smp init-db` ובדקו `/products/search`.
8. **ביצועים בנפח מלא** (מיליוני שורות לרשת): הטעינה בנויה ב-bulk upsert, אבל לא נמדדה. `price_drops` סורק היסטוריה — בקנה מידה מומלץ טבלה מחושבת בלילה.
9. **מיקום סניפים:** בקבצים יש רק עיר/כתובת. `lat/lon` ריקים עד שתוסיפו job של geocoding; עד אז "אזור" = עיר.
10. **מבצעים (Promo/PromoFull)** — לא נטענים (שלב 2). מחירי הסל לא כוללים מבצעים/מועדון.

## הערות
- אין migrations: `smp init-db` מריץ `create_all`. כשהסכמה מתייצבת — להוסיף Alembic.
- `API_KEY` ריק = אין אימות. לפני חשיפה לאינטרנט — להגדיר.
