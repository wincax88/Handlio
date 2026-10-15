import { expect, test, vi } from "vitest";
import DodoPayments from "dodopayments";
import { verifyDodoCatalog } from "../scripts/verify-dodo-catalog";

function client(
  change: Record<string, unknown> = {},
  priceChange: Record<string, unknown> = {},
) {
  return {
    products: {
      retrieve: vi.fn(async (id: string) => ({
        product_id: id,
        business_id: "merchant",
        is_recurring: false,
        tax_category: "saas",
        price: {
          type: "one_time_price",
          currency: "USD",
          price: id === "project" ? 1900 : 900,
          pay_what_you_want: false,
          purchasing_power_parity: false,
          ...priceChange,
        },
        ...change,
      })),
    },
  } as unknown as Pick<DodoPayments, "products">;
}
test("validates both products without creating any resource", async () => {
  await expect(
    verifyDodoCatalog(client(), "project", "renewal"),
  ).resolves.toEqual({
    projectPriceUSD: 19,
    renewalPriceUSD: 9,
    catalogVerified: true,
  });
});
test("requires independent product IDs", async () => {
  const sdk = client();
  await expect(verifyDodoCatalog(sdk, "same", "same")).rejects.toThrow(
    "distinct",
  );
  expect(sdk.products.retrieve).not.toHaveBeenCalled();
});
test.each([
  [{ is_recurring: true }, {}],
  [{ tax_category: "digital_products" }, {}],
  [{ pricing_mode: "localized" }, {}],
  [{}, { currency: "EUR" }],
  [{}, { price: 1901 }],
  [{}, { pay_what_you_want: true }],
  [{}, { purchasing_power_parity: true }],
  [{}, { discount: 1 }],
  [{}, { discount_bps: 1 }],
  [{}, { type: "recurring_price" }],
])("rejects unsupported catalog configuration %#", async (product, price) => {
  await expect(
    verifyDodoCatalog(client(product, price), "project", "renewal"),
  ).rejects.toThrow("fixed one-time SaaS");
});
test("rejects products returned from different merchants", async () => {
  const sdk = client();
  vi.mocked(sdk.products.retrieve).mockResolvedValueOnce({
    ...(await sdk.products.retrieve("project")),
    business_id: "other-merchant",
  });
  await expect(verifyDodoCatalog(sdk, "project", "renewal")).rejects.toThrow(
    "one merchant",
  );
});
test("reports provider authentication errors without leaking the response", async () => {
  const sdk = client();
  vi.mocked(sdk.products.retrieve).mockRejectedValue(
    new Error("private-provider-details"),
  );
  await expect(verifyDodoCatalog(sdk, "project", "renewal")).rejects.toThrow(
    "selected mode",
  );
});
