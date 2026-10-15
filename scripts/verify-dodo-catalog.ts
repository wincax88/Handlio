import DodoPayments from "dodopayments";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Read-only: never creates a checkout, payment, product or customer.
export async function verifyDodoCatalog(
  sdk: Pick<DodoPayments, "products">,
  projectId: string,
  renewalId: string,
) {
  if (!projectId || !renewalId || projectId === renewalId)
    throw new Error(
      "Two distinct Dodo project and renewal product IDs are required.",
    );
  let business: string | undefined;
  for (const [productId, amount] of [
    [projectId, 1900],
    [renewalId, 900],
  ] as const) {
    let product;
    try {
      product = await sdk.products.retrieve(productId);
    } catch {
      throw new Error(
        "Dodo API could not verify the catalog. Check that the key and product IDs belong to the selected mode.",
      );
    }
    const price = product.price;
    if (
      product.product_id !== productId ||
      !product.business_id ||
      (business && product.business_id !== business) ||
      product.is_recurring ||
      product.tax_category !== "saas" ||
      price.type !== "one_time_price" ||
      price.currency !== "USD" ||
      price.price !== amount ||
      price.pay_what_you_want ||
      price.purchasing_power_parity ||
      price.discount ||
      price.discount_bps ||
      product.pricing_mode
    )
      throw new Error(
        "Dodo products must belong to one merchant and match fixed one-time SaaS prices of USD 19 and USD 9, without discounts or localized pricing.",
      );
    business = product.business_id;
  }
  return { projectPriceUSD: 19, renewalPriceUSD: 9, catalogVerified: true };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const mode = process.env.DODO_PAYMENTS_ENVIRONMENT;
    if (mode !== "test_mode" && mode !== "live_mode")
      throw new Error("Explicit Dodo test_mode or live_mode is required.");
    if (!process.env.DODO_PAYMENTS_API_KEY)
      throw new Error("Missing DODO_PAYMENTS_API_KEY.");
    const sdk = new DodoPayments({
      bearerToken: process.env.DODO_PAYMENTS_API_KEY,
      environment: mode,
      timeout: 15000,
      maxRetries: 0,
    });
    console.log(
      JSON.stringify(
        await verifyDodoCatalog(
          sdk,
          process.env.DODO_PROJECT_PRODUCT_ID || "",
          process.env.DODO_RENEWAL_PRODUCT_ID || "",
        ),
      ),
    );
    console.log(
      `Dodo ${mode} catalog verified. No payment or checkout was created.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error && error.constructor === Error
        ? error.message
        : "Dodo catalog verification unavailable.",
    );
    process.exitCode = 1;
  }
}
