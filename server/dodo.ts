import DodoPayments from "dodopayments";
import { z } from "zod";
import { AppError, id, now, one, run, tx, type Row } from "./db.js";
import { origin } from "./providers.js";
import { expectedPaymentEnvironment } from "./payment-instance.js";

export const dodoSelected = () => process.env.BILLING_PROVIDER === "dodo";
const mode = () => process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode";
export function dodoReady() {
  return !!(
    dodoSelected() &&
    process.env.DODO_PAYMENTS_API_KEY &&
    process.env.DODO_PAYMENTS_WEBHOOK_KEY &&
    process.env.DODO_PROJECT_PRODUCT_ID &&
    process.env.DODO_RENEWAL_PRODUCT_ID &&
    mode() ===
      (expectedPaymentEnvironment() === "production"
        ? "live_mode"
        : "test_mode")
  );
}
export const billingAvailable = () =>
  dodoSelected() ? dodoReady() : !!process.env.BILLING_ADAPTER_URL;
export const billingProvider = () =>
  dodoSelected()
    ? {
        name: "Dodo Payments",
        mode: mode() === "live_mode" ? "live" : "test",
        configured: dodoReady(),
      }
    : null;
function client() {
  if (!dodoReady())
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "Payment is not configured for this environment. Test payments require a separate development instance.",
    );
  return new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY!,
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY!,
    environment: mode() as "test_mode" | "live_mode",
    timeout: 15000,
    maxRetries: 0,
  });
}
async function providerCall<T>(fn: () => PromiseLike<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "The payment provider is unavailable. Keep your order reference and try again.",
    );
  }
}
const mismatch = () =>
  new AppError(
    "PAYMENT_MISMATCH",
    400,
    "Payment details do not match the order.",
  );
const flights = new Map<string, ReturnType<typeof createCheckout>>();
export async function createDodoCheckout(order: Row, email: string) {
  const active = flights.get(order.id);
  if (active) return active;
  const flight = createCheckout(order, email).finally(() =>
    flights.delete(order.id),
  );
  flights.set(order.id, flight);
  return flight;
}
async function createCheckout(order: Row, email: string) {
  const sdk = client();
  const previous = one(
    "SELECT * FROM dodo_checkouts WHERE order_id=? ORDER BY created_at DESC LIMIT 1",
    order.id,
  );
  if (previous) {
    if (previous.environment !== mode()) throw mismatch();
    if (previous.status === "creating" && now() - previous.created_at < 120000)
      throw new AppError(
        "CHECKOUT_IN_PROGRESS",
        409,
        "Checkout is being prepared. Wait a moment before retrying.",
      );
    if (previous.session_id) {
      // Links expire after 24 hours. Never replace a link while an original payment is in progress.
      const result = await checkDodoOrder(order);
      if (!result) throw mismatch();
      if (
        result.status !== "pending" ||
        ("paymentId" in result && result.paymentId)
      )
        return { transaction: result };
      if (
        now() - previous.created_at < 86400000 + 300000 &&
        previous.checkout_url
      )
        return { url: previous.checkout_url };
    }
  }
  const productId =
    order.product === "project"
      ? process.env.DODO_PROJECT_PRODUCT_ID!
      : process.env.DODO_RENEWAL_PRODUCT_ID!;
  const product = await providerCall(() => sdk.products.retrieve(productId));
  const price = product.price;
  if (
    product.product_id !== productId ||
    product.is_recurring ||
    price.type !== "one_time_price" ||
    price.currency !== order.currency ||
    price.price !== order.amount ||
    price.pay_what_you_want ||
    price.purchasing_power_parity ||
    price.discount ||
    price.discount_bps ||
    product.pricing_mode
  )
    throw new AppError(
      "PAYMENT_CATALOG_MISMATCH",
      503,
      "The payment product configuration needs review. No checkout has been started.",
    );
  const attempt = id();
  // Persist before the network request so separate workers cannot expose multiple links for an order.
  run(
    "UPDATE dodo_checkouts SET status='abandoned' WHERE order_id=? AND status='creating' AND created_at<?",
    order.id,
    now() - 120000,
  );
  try {
    run(
      "INSERT INTO dodo_checkouts VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      attempt,
      order.id,
      null,
      productId,
      product.business_id,
      mode(),
      order.amount,
      price.tax_inclusive ? 1 : 0,
      "creating",
      now(),
      null,
    );
  } catch {
    throw new AppError(
      "CHECKOUT_IN_PROGRESS",
      409,
      "Checkout is being prepared. Wait a moment before retrying.",
    );
  }
  try {
    const returnUrl = `${origin}/app/payment/${order.id}`;
    const session = await providerCall(() =>
      sdk.checkoutSessions.create({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email },
        billing_currency: "USD",
        return_url: returnUrl,
        cancel_url: returnUrl,
        metadata: {
          handlio_app: "handlio",
          order_id: order.id,
          project_id: order.project_id,
          workspace_id: order.workspace_id,
          product: order.product,
          environment: mode(),
        },
        feature_flags: {
          allow_currency_selection: false,
          allow_discount_code: false,
          allow_customer_editing_email: false,
          allow_phone_number_collection: false,
        },
      }),
    );
    const checkedUrl = z.string().url().safeParse(session.checkout_url);
    if (!checkedUrl.success) throw mismatch();
    const url = new URL(checkedUrl.data);
    const host =
      mode() === "test_mode"
        ? "test.checkout.dodopayments.com"
        : "checkout.dodopayments.com";
    if (
      url.protocol !== "https:" ||
      url.hostname !== host ||
      url.username ||
      url.password ||
      url.port ||
      !session.session_id
    )
      throw mismatch();
    tx(() => {
      run(
        "UPDATE dodo_checkouts SET session_id=?,status='ready',checkout_url=? WHERE id=?",
        session.session_id,
        url.href,
        attempt,
      );
      run("UPDATE orders SET checkout_url=? WHERE id=?", url.href, order.id);
    });
    return { url: url.href };
  } catch (e) {
    // No URL was exposed. An orphan session cannot be paid through Handlio; do not retry POSTs inside the SDK.
    run(
      "UPDATE dodo_checkouts SET status='abandoned' WHERE id=? AND status='creating'",
      attempt,
    );
    throw e;
  }
}

export async function checkDodoOrder(order: Row) {
  const sdk = client();
  const checkout = one(
    "SELECT * FROM dodo_checkouts WHERE order_id=? AND session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    order.id,
  );
  if (!checkout || checkout.environment !== mode()) throw mismatch();
  if (order.provider_transaction)
    return retrieveDodoPayment(order.provider_transaction);
  const session = await providerCall(() =>
    sdk.checkoutSessions.retrieve(checkout.session_id),
  );
  if (session.id !== checkout.session_id) throw mismatch();
  if (!session.payment_id)
    return { orderId: order.id, status: "pending" as const };
  const result = await retrieveDodoPayment(session.payment_id);
  if (!result || result.orderId !== order.id) throw mismatch();
  return result;
}

export async function retrieveDodoPayment(
  paymentId: string,
  expectedBusiness?: string,
) {
  const payment = await providerCall(() =>
    client().payments.retrieve(paymentId),
  );
  if (
    payment.payment_id !== paymentId ||
    (expectedBusiness && payment.business_id !== expectedBusiness)
  )
    throw mismatch();
  if (payment.metadata.handlio_app !== "handlio") return null;
  const order = one(
    "SELECT * FROM orders WHERE id=?",
    String(payment.metadata.order_id || ""),
  );
  const checkout = one(
    "SELECT * FROM dodo_checkouts WHERE session_id=?",
    payment.checkout_session_id || "",
  );
  if (
    !order ||
    !checkout ||
    checkout.order_id !== order.id ||
    checkout.amount !== order.amount ||
    checkout.environment !== mode() ||
    payment.metadata.project_id !== order.project_id ||
    payment.metadata.workspace_id !== order.workspace_id ||
    payment.metadata.product !== order.product ||
    payment.metadata.environment !== checkout.environment ||
    payment.business_id !== checkout.business_id ||
    payment.currency !== "USD" ||
    payment.subscription_id ||
    payment.subscription_ids?.length ||
    payment.is_multi_subscription ||
    payment.is_update_payment_method ||
    payment.product_cart?.length !== 1 ||
    payment.product_cart[0].product_id !== checkout.product_id ||
    payment.product_cart[0].quantity !== 1 ||
    (order.provider_transaction && order.provider_transaction !== paymentId)
  )
    throw mismatch();
  if (!["succeeded", "failed", "cancelled"].includes(payment.status || ""))
    return { orderId: order.id, status: "pending" as const, paymentId };
  const tax = payment.tax ?? 0;
  if (
    !Number.isSafeInteger(tax) ||
    tax < 0 ||
    tax > payment.total_amount ||
    (payment.status === "succeeded" &&
      (payment.total_amount !==
        checkout.amount + (checkout.tax_inclusive ? 0 : tax) ||
        payment.discount_id ||
        payment.discounts?.length))
  )
    throw mismatch();
  // Fetching the current payment (including refunds/disputes) makes delayed events harmless.
  const succeededRefunds = payment.refunds.filter(
    (r) => r.status === "succeeded",
  );
  let returned = 0;
  for (const refund of succeededRefunds) {
    if (
      refund.payment_id !== paymentId ||
      (refund.currency != null && refund.currency !== "USD") ||
      (refund.amount != null &&
        (!Number.isSafeInteger(refund.amount) || refund.amount <= 0))
    )
      throw mismatch();
    returned += refund.amount ?? 0;
  }
  if (returned > payment.total_amount) throw mismatch();
  const fullRefund =
    payment.refund_status === "full" ||
    succeededRefunds.some((refund) => refund.is_partial === false) ||
    (returned > 0 && returned === payment.total_amount);
  const partialRefund =
    payment.refund_status === "partial" || succeededRefunds.length > 0;
  // The existing entitlement ledger stores refunds against the package price, excluding tax.
  // Any positive partial refund triggers review; full refunds revoke the entire package.
  // Dodo may omit refund amounts; its verified summary still revokes/reviews access.
  // The minimum marker below is an entitlement flag, never a claimed refund total.
  const refundAmount = Math.max(
    order.refunded,
    fullRefund
      ? order.amount
      : partialRefund
        ? Math.max(
            1,
            Math.min(
              order.amount - 1,
              Math.round((returned * order.amount) / payment.total_amount),
            ),
          )
        : 0,
  );
  const disputed = payment.disputes.some(
    (d) => !["dispute_won", "dispute_cancelled"].includes(d.dispute_status),
  );
  const status =
    refundAmount > 0
      ? "refunded"
      : disputed
        ? "disputed"
        : payment.status === "succeeded"
          ? "paid"
          : "failed";
  const paidAt = new Date(
    order.paid_at || Date.parse(payment.updated_at || payment.created_at),
  ).toISOString();
  const invoice = payment.invoice_url
    ? z
        .string()
        .url()
        .refine((v) => v.startsWith("https://"))
        .safeParse(payment.invoice_url)
    : null;
  return {
    id: paymentId,
    orderId: order.id,
    status,
    amount: order.amount,
    currency: "USD" as const,
    environment:
      checkout.environment === "live_mode" ? "production" : "sandbox",
    paidAt,
    refundAmount,
    tax,
    total: payment.total_amount,
    receiptUrl: invoice?.success ? invoice.data : null,
    invoiceNumber: payment.invoice_id?.slice(0, 200) || null,
  };
}

export function verifyDodoEvent(raw: Buffer, headers: Record<string, string>) {
  if (!Buffer.isBuffer(raw))
    throw new AppError(
      "SIGNATURE_INVALID",
      401,
      "Invalid payment notification.",
    );
  let event: unknown;
  try {
    event = client().webhooks.unwrap(raw.toString("utf8"), { headers });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      "SIGNATURE_INVALID",
      401,
      "Invalid payment notification.",
    );
  }
  const parsed = z
    .object({
      business_id: z.string().min(1).max(200),
      type: z.string(),
      data: z
        .object({ payment_id: z.string().min(1).max(200).optional() })
        .passthrough(),
    })
    .parse(event);
  if (
    !/^(payment|refund|dispute)\./.test(parsed.type) ||
    !parsed.data.payment_id
  )
    return null;
  const eventId = z.string().min(1).max(200).parse(headers["webhook-id"]);
  return {
    eventId: `dodo:${mode()}:${eventId}`,
    transactionId: parsed.data.payment_id,
    provider: "dodo",
    environment: mode(),
    businessId: parsed.business_id,
    type: parsed.type,
  };
}
