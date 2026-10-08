import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductImage } from "./ProductImage";
afterEach(() => vi.unstubAllGlobals());
describe("ProductImage", () => {
  it("does not request images for internal products", () => {
    const f=vi.fn();vi.stubGlobal("fetch",f);render(<ProductImage gtin={null} name="מלפפון" />);
    expect(screen.getByLabelText("אין תמונה: מלפפון")).toBeTruthy();expect(f).not.toHaveBeenCalled();
  });
  it("renders source credit and falls back on image error", async () => {
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({url:"https://images.openfoodfacts.org/images/products/test.jpg",sourceUrl:"https://world.openfoodfacts.org/product/7290004127329",licenseUrl:"https://creativecommons.org/licenses/by-sa/3.0/"}))));
    render(<ProductImage gtin="7290004127329" name="קוטג" />);
    await waitFor(()=>expect(screen.getByAltText("קוטג")).toBeTruthy());
    expect(screen.getByText("CC BY-SA")).toBeTruthy();fireEvent.error(screen.getByAltText("קוטג"));
    expect(screen.getByLabelText("אין תמונה: קוטג")).toBeTruthy();expect(screen.queryByText("CC BY-SA")).toBeNull();
  });
});
