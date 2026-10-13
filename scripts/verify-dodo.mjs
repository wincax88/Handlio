import DodoPayments from "dodopayments";
// Read-only merchant setup check. Never print keys or complete provider responses.
if (process.env.DODO_PAYMENTS_ENVIRONMENT !== "test_mode")
  throw new Error("This verification is restricted to Dodo test_mode.");
const sdk = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment: "test_mode",
  timeout: 15000,
  maxRetries: 0,
});
for (const [key, amount] of [
  ["DODO_PROJECT_PRODUCT_ID", 1900],
  ["DODO_RENEWAL_PRODUCT_ID", 900],
]) {
  if (!process.env[key]) throw new Error(`Missing ${key}.`);
  let product;
  try {
    product = await sdk.products.retrieve(process.env[key]);
  } catch {
    throw new Error(
      `Dodo test API could not verify ${key}. Check the test-mode key and product ID.`,
    );
  }
  const price = product.price;
  if (
    product.is_recurring ||
    price.type !== "one_time_price" ||
    price.currency !== "USD" ||
    price.price !== amount ||
    price.pay_what_you_want ||
    price.purchasing_power_parity ||
    price.discount ||
    price.discount_bps ||
    product.pricing_mode
  )
    throw new Error(`${key} does not match the fixed one-time USD price.`);
  console.log(`${key}: verified one-time USD ${amount / 100}.`);
}
console.log("Dodo test catalog verified. No payment or checkout was created.");
