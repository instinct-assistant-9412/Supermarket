# supermarket-prices

מחירי סופרמרקטים בישראל מתוך קבצי השקיפות של הרשתות (חוק שקיפות מחירים), כפרויקט TypeScript עצמאי לחלוטין.
אין תלות בקוד של פרויקט אחר: ה-downloader, ה-parser, הנרמול, ה-API וה-MCP נכתבו כאן מאפס.

**הערך המוסף הוא שכבת הנרמול**, לא ההורדה: חיבור מוצרים בין רשתות לפי ברקוד (GTIN), התאמת שמות בעברית עם fuzzy matching,
היסטוריית מחירים ב-Postgres ובדיקות איכות/טריות לכל רשת. מעל זה: API ושרת MCP לסוכנים. אין אפליקציית צרכן בשלב 1.

> רשימת הרשתות והלינקים הרשמיים: https://www.gov.il/he/departments/legalInfo/cpfta_prices_regulations

## מה יש בפנים

| תיקייה | תפקיד |
|---|---|
| `src/downloader` | הורדה ישירה של קבצי המחירים: שופרסל (טבלת HTML + קישורי blob חתומים) ופורטל `url.publishedprices.co.il` המשותף להרבה רשתות |
| `src/parser` | פענוח gzip + קידודים (UTF-8 עם BOM, UTF-16, windows-1255) ו-XML של מחירים/סניפים עם וריאציות תגיות |
| `src/normalize` | `gtin.ts` (ולידציה ונרמול ל-13 ספרות), `hebrew.ts` (ניקוד, גרשיים, אותיות סופיות, יחידות מידה, גודל), `trigram.ts`, `matcher.ts` |
| `src/db` | `schema.sql` (מוצרים, פריטי רשת, מחירים נוכחיים, היסטוריה, ריצות קליטה) ו-`PgRepository` |
| `src/ingest` | קליטה: התאמה, כתיבת מחירים, היסטוריה רק כששינוי מחיר, בדיקות איכות. `MemoryRepository` לבדיקות |
| `src/quality` | בדיקות איכות לכל קובץ ובדיקת טריות לכל רשת |
| `src/api` | API ב-**Hono** |
| `src/mcp` | שרת MCP עם ה-SDK הרשמי (`@modelcontextprotocol/sdk`) |

**למה Hono ולא Fastify:** קטן, מבוסס Request/Response סטנדרטי (אפשר לבדוק עם `app.request()` בלי להרים שרת), וטיפוסים טובים. אין כאן צורך ב-ecosystem של plugins.

## איך הנרמול עובד

1. **ברקוד קודם.** `ItemType=1` וקוד שעובר בדיקת ספרת ביקורת (GTIN-8/12/13, גם GTIN-14 עם אפס מוביל) נהפך ל-13 ספרות עם אפסים משמאל, וזה המפתח בין רשתות.
   ברקודים שמתחילים ב-2 (משקל/מחיר מוטמע) וקודים פנימיים של רשת לא נחשבים ברקוד.
2. **אין ברקוד** (ירקות, מאפייה, קוד פנימי): דמיון טריגרמות על שם מנורמל. שם מנורמל = בלי ניקוד/גרשיים, אותיות סופיות מאוחדות,
   יחידות מאוחדות (`גר'`/`גרם`, `ל'`/`ליטר`, `קילו`/`קג`), מספר מופרד מיחידה. יש גם שמירת גודל: `200 גרם` לא יתחבר ל-`250 גרם`.
   - דמיון ≥ `FUZZY_AUTO_THRESHOLD` (0.8): חיבור אוטומטי.
   - בין `FUZZY_REVIEW_THRESHOLD` (0.55) ל-0.8: נוצר מוצר חדש ומסומן ב-`needs_review` (נראה ב-`GET /quality/review`).
   - מתחת: מוצר חדש.
3. **היסטוריה:** `price_history` מקבלת שורה רק כשהמחיר חדש או השתנה. `current_prices` שומר את המצב האחרון לכל סניף ומוצר.

## בדיקות איכות

לכל קובץ: קובץ ריק, `ChainId` שלא תואם לרשת (הקובץ נדחה ולא נכתב כלום), אחוז שורות לא תקינות, אחוז ברקודים תקינים נמוך,
קודים כפולים, ירידה חדה במספר מוצרים מול הריצה הקודמת, קובץ ישן. לכל רשת: `fresh` / `stale` / `never` (`GET /quality/freshness`, `npm run quality`).

## הרצה

דרישות: Node 20+, Docker (ל-Postgres).

```bash
cd supermarket-prices
cp .env.example .env            # אופציונלי, יש ברירות מחדל
npm install
docker compose up -d db
npm run migrate                 # יוצר סכמה + pg_trgm
npm run ingest -- --chain rami-levy --max-files 1     # קליטה ראשונה קטנה
npm run ingest                  # כל הרשתות ברשימה (קבצי PriceFull, האחרון לכל סניף)
npm run quality                 # טריות לכל רשת
npm run api                     # http://localhost:3000
npm run mcp                     # שרת MCP ב-stdio
npm test                        # בדיקות
npm run typecheck               # tsc
```

### API

```bash
curl 'localhost:3000/products/search?q=חלב תנובה'
curl 'localhost:3000/products/7290016314779/history?days=90'        # לפי ברקוד / מזהה מוצר / שם
curl -X POST localhost:3000/basket/cheapest -H 'content-type: application/json' -d '{
  "items": [{"gtin":"7290016314779","qty":2}, {"query":"אורז בסמטי","qty":1}],
  "area": {"text":"ראש העין"}, "requireAll": true }'
curl localhost:3000/quality/freshness
curl localhost:3000/quality/review
```

`area.text` מותאם מול עיר/כתובת/שם הסניף. שימו לב: בחלק מהרשתות שדה העיר הוא **קוד ישוב של הלמ"ס** (למשל `3000`), לא שם (ראו "דורש בדיקה חיה").

### MCP

כלים: `search_products`, `price_history`, `cheapest_basket`, `data_freshness`. דוגמת הגדרה ל-Claude Desktop / סוכן אחר:

```json
{ "mcpServers": { "supermarket-prices": {
  "command": "npx", "args": ["tsx", "src/mcp/server.ts"],
  "cwd": "/path/to/supermarket-prices",
  "env": { "DATABASE_URL": "postgres://prices:prices@localhost:5432/prices" } } } }
```

## מה נבדק

- `npm run typecheck` (tsc, strict) עובר. `npm test`: 29 בדיקות עוברות, 1 מדולגת כברירת מחדל (אינטגרציה מול Postgres אמיתי).
- יחידה: GTIN, נרמול עברית, טריגרמות, פענוח XML מקבצים אמיתיים (שופרסל ורמי לוי, כולל UTF-16 לקובץ סניפים), שמות קבצים, חילוץ קישורים מ-HTML של שופרסל, בדיקות איכות.
- E2E עם מקור מדומה: שתי רשתות, ברקוד משותף = מוצר אחד, חיבור fuzzy לפי שם, דילוג על קובץ שכבר נקלט, היסטוריה רק בשינוי מחיר, דחיית קובץ עם ChainId שגוי, ה-API וכלי ה-MCP (ב-transport בזיכרון).
- אינטגרציה מול Postgres אמיתי (`TEST_DATABASE_URL=... npm test`, כולל pg_trgm על עברית): עברה מול Postgres 18 מקומי.
- בדיקה חיה חד-פעמית בזמן הכתיבה: התחברות לפורטל publishedprices עם המשתמש `RamiLevi`, רשימת קבצים, הורדה ופענוח של קובץ PriceFull (13,139 מוצרים) וקובץ סניפים (99 סניפים);
  קליטה מלאה של קובץ אחד ל-Postgres (כ-13 אלף מחירים, כ-40 שניות); רשימת הקבצים של שופרסל (עמוד ראשון).

## דורש בדיקה חיה (לא אומת)

1. **פורטל publishedprices:** רק `RamiLevi` נבדק. שאר שמות המשתמש ב-`src/downloader/registry.ts` (יוחננוף, אושר עד, טיב טעם, חצי חינם, סטופ מרקט, פוליצר, קשת, דור אלון) נכתבו מזיכרון ויש לאמת אחד-אחד.
   סיסמה ריקה; ייתכנו רשתות עם סיסמה, captcha או חסימת קצב.
2. **שופרסל:** האם `catID` 1-4 ממופה כפי שבקוד (`1=Price, 2=PriceFull, 3=Promo, 4=PromoFull, 5=Stores`) ופרמטר `page`. נקודת הקצה `FileObject/UpdateCategory` ענתה פעם אחת עם קישורי Stores ופעם אחת עם קבצי מחירים, ובהמשך נתקעה בזמן הבדיקה. הקישורים החתומים פגים אחרי ~30 דקות, לכן מורידים מיד אחרי הרישום.
3. **רשתות נוספות** (ויקטורי, מגה, סופר-פארם, קרפור, ועוד): לא ממומשות כאן. לכל אחת כנראה צריך מתאם משלה. מתאם = מימוש של `ChainSource` (`listFiles` + `download`).
4. **ChainId / SubChainId / StoreId:** כל רשת מדווחת אחרת (SubChainId `000`/`001`/ריק, StoreId עם אפסים מובילים, כמה ChainId לרשת אחת). המפתח לסניף כאן הוא `chain + subChain + store`. לבדוק שאין כפילות/פיצול סניפים.
5. **שמות תגיות וקידודים:** נצפה בקבצים חיים `ManufactureName` (ולא `ManufacturerName`), `PriceUpdateTime`, UTF-8 עם BOM במחירים, UTF-16LE בקובץ סניפים, קובץ סניפים לא דחוס בפורטל. הפרסר מכיר וריאציות (`Prices/Products/Product`, `ManufacturerName`, windows-1255) אבל לא נבדק מול כל רשת.
6. **שדה העיר:** ברמי לוי הוא קוד ישוב (`3000`). `area.text` עובד כרגע על טקסט (שם/כתובת/עיר), לכן צריך טבלת מיפוי קודי ישוב של הלמ"ס לשמות, אחרת חיפוש "ירושלים" לא ימצא סניפים שהעיר שלהם `3000`.
7. **ספי fuzzy** (0.8 / 0.55) ושמירת הגודל: ערכי פתיחה בלבד. לכוון מול דגימה אמיתית דרך `/quality/review`.
8. **pg_trgm:** נבדק עם Postgres 18 ועברית. ב-`postgres:16` של docker-compose צריך לוודא שההרחבה זמינה (היא חלק מ-contrib שבתמונה הרשמית) ולבדוק ביצועי אינדקס GIN על מיליוני מוצרים. `%` משתמש ב-`pg_trgm.similarity_threshold` של 0.3, כלומר אי אפשר להנמיך את `FUZZY_REVIEW_THRESHOLD` מתחת ל-0.3.
9. **ביצועים:** הקליטה כרגע שורה-שורה (כ-300 מוצרים בשנייה). לכמות מלאה כדאי batch insert / `COPY` ומקביליות בין סניפים.
10. **מבצעים (Promo/PromoFull):** לא נקלטים. המחיר הוא מחיר המדף בלבד.
11. **מחירי משקל ותוצרת טרייה:** קודים פנימיים שונים בין רשתות. ההתאמה לפי שם עלולה לחבר מוצרים שונים. לבדוק ידנית.
12. **תנאי שימוש וקצב:** לבדוק את תנאי השימוש של הפורטלים ולהגביל קצב; ה-User-Agent נקבע ב-`USER_AGENT`.

## רישוי

הקוד כאן נכתב מאפס ואינו מבוסס על קוד של פרויקט אחר. פורמט הקבצים נלמד מקבצים ציבוריים של הרשתות ומהתקנות השקיפות.
