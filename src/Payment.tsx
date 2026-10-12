import { useEffect, useState } from "react";
import type { Session } from "./types";
import { api, formatDate, send } from "./api";
import {
  Badge,
  Button,
  ErrorNotice,
  Link,
  Loading,
  PageHeading,
  Panel,
} from "./ui";

export function PaymentPage({
  orderId,
  session,
}: {
  orderId: string;
  session: Session;
}) {
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  async function load() {
    setOrder(await api(`/billing/orders/${orderId}`));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      5000,
    );
    return () => clearInterval(timer);
  }, [orderId]);
  useEffect(() => {
    if (sessionStorage.getItem(`checkout:${orderId}`) === "started") {
      sessionStorage.removeItem(`checkout:${orderId}`);
      void check();
    }
  }, [orderId]);
  async function check() {
    setBusy(true);
    setError(null);
    try {
      await send(`/billing/orders/${orderId}/check`, {});
      setCheckedAt(Date.now());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!order)
    return (
      <>
        <ErrorNotice error={error} />
        <Loading />
      </>
    );
  const paid = order.status === "paid",
    pending = order.status === "pending";
  const tz = session.user!.settings.timezone;
  const money = (amount: number) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: order.currency,
    }).format(amount / 100);
  return (
    <div className="payment-page">
      <PageHeading
        eyebrow="PROJECT PURCHASE · NO AUTOMATIC RENEWAL"
        title={
          paid
            ? "Your project pack is active."
            : pending
              ? "One more check before access."
              : "Your draft is safe."
        }
        description={
          paid
            ? "The verified result is linked to this project. Payment does not automatically publish content or invite clients."
            : pending
              ? "We are waiting for a verified provider result. Returning from checkout does not confirm payment. Avoid paying again while verification is pending."
              : "This order is not an active payment. Check the original provider result before starting another checkout."
        }
      />
      <ErrorNotice error={error} />
      <Panel title="Order details">
        <dl className="detail-list">
          <div>
            <dt>Project</dt>
            <dd>{order.projectName}</dd>
          </div>
          <div>
            <dt>Order reference</dt>
            <dd>{order.id}</dd>
          </div>
          <div>
            <dt>Product</dt>
            <dd>
              {order.product === "renewal"
                ? "90-day hosting extension"
                : "90-day project pack"}
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{money(order.amount)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>
              {order.receipt?.tax != null
                ? money(order.receipt.tax)
                : "Unavailable from provider"}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <Badge tone={paid ? "green" : "amber"}>{order.status}</Badge>
            </dd>
          </div>
          <div>
            <dt>Paid at</dt>
            <dd>{formatDate(order.paid_at, tz)}</dd>
          </div>
          <div>
            <dt>Hosting ends</dt>
            <dd>{formatDate(order.entitlement.expiresAt, tz)}</dd>
          </div>
          <div>
            <dt>Invoice number</dt>
            <dd>
              {order.receipt?.invoice_number || "Unavailable from provider"}
            </dd>
          </div>
        </dl>
        {order.receipt?.receipt_url && (
          <a
            className="button secondary"
            href={order.receipt.receipt_url}
            target="_blank"
            rel="noreferrer"
          >
            Provider receipt
          </a>
        )}
        <div className="action-row">
          <Button
            kind="secondary"
            disabled={busy || Date.now() - checkedAt < 60000}
            onClick={() => void check()}
          >
            {busy ? "Checking original payment…" : "Check original payment"}
          </Button>
          {paid ? (
            <Link
              className="button"
              to={`/app/projects/${order.project_id}/${order.product === "renewal" ? "handoff" : "releases"}`}
            >
              {order.product === "renewal"
                ? "Review sharing before reopening"
                : "Continue to publish checks"}
            </Link>
          ) : (
            <Link
              className="button"
              to={`/app/projects/${order.project_id}/overview`}
            >
              Return to draft
            </Link>
          )}
          <Link
            className="button text"
            to={`/app/help?kind=refund&order=${order.id}`}
          >
            Request order review
          </Link>
        </div>
        {session.localMode && (
          <p className="muted">
            Local development order. Payment simulation does not make a real
            charge.
          </p>
        )}
      </Panel>
    </div>
  );
}
