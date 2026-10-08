import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { createClient } from "./api/client";
import { mockFetch } from "./api/mock";
import { PriceChart } from "./components/PriceChart";
import { AppProvider } from "./state";

const api = createClient("/mock", mockFetch);
const renderApp = () => render(<AppProvider api={api}><App /></AppProvider>);

describe("ממשק", () => {
  beforeEach(() => {
    localStorage.clear();
    location.hash = "#/";
  });

  it("חיפוש מציג תוצאות והוספה לסל מעדכנת את המונה", async () => {
    renderApp();
    fireEvent.change(screen.getByLabelText("חיפוש מוצר"), { target: { value: "אורז" } });
    const add = await screen.findAllByRole("button", { name: /הוספה לסל: אורז בסמטי/ }, { timeout: 3000 });
    fireEvent.click(add[0]!);
    await waitFor(() => expect(document.querySelector(".nav-top .count")?.textContent).toBe("1"));
  });

  it("דף סל מחשב איפה הכי זול", async () => {
    localStorage.setItem("supermarket-web-v1", JSON.stringify({ items: [{ id: 1, gtin: null, name: "חלב תנובה 3% 1 ליטר", qty: 2 }], online: false }));
    location.hash = "#/basket";
    renderApp();
    expect(await screen.findByText("הסל הזול ביותר", {}, { timeout: 3000 })).toBeTruthy();
  });

  it("דף טריות מציג רשת ישנה", async () => {
    location.hash = "#/freshness";
    renderApp();
    expect(await screen.findByText("ישן", {}, { timeout: 3000 })).toBeTruthy();
  });
});

describe("PriceChart", () => {
  it("מציג מצב ריק ללא נתונים ומאפשר להסתיר רשת", () => {
    const { rerender } = render(<PriceChart series={[]} chainNames={{}} />);
    expect(screen.getByText(/אין היסטוריית מחירים/)).toBeTruthy();
    rerender(<PriceChart series={[{ chainId: "a", points: [{ t: 1, price: 5 }, { t: 2, price: 6 }] }]} chainNames={{ a: "רשת א" }} now={3} />);
    const chip = screen.getByRole("button", { name: "רשת א" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });
});
