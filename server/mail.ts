import nodemailer from "nodemailer";

export type MailOptions = { kind?: "auth" | "notification"; key?: string };
export type MailReceipt = {
  provider: "resend" | "smtp" | "local";
  state: "accepted" | "local";
  messageId: string | null;
};
type MailConfig = Record<string, string | undefined>;
export class MailProviderError extends Error {
  constructor(public code: string) { super("Email delivery is temporarily unavailable. Retry later."); }
}
export function validateMailConfiguration(config: MailConfig) {
  const provider = config.MAIL_PROVIDER || (config.SMTP_HOST ? "smtp" : "local");
  if (!['resend', 'smtp', 'local'].includes(provider)) throw new Error('MAIL_PROVIDER must be resend, smtp or local.');
  if (config.NODE_ENV !== 'production') return;
  if (!config.MAIL_FROM || !config.MAIL_AUTH_FROM && provider === 'resend') throw new Error('Production requires MAIL_FROM and Resend MAIL_AUTH_FROM.');
  if (provider === 'local' || provider === 'resend' && !config.RESEND_API_KEY || provider === 'smtp' && !config.SMTP_HOST) {
    throw new Error('Production requires credentials for the selected email provider.');
  }
}
export async function deliverMail(
  email: string, subject: string, text: string, options: MailOptions = {},
  config: MailConfig = process.env, request: typeof fetch = fetch,
): Promise<MailReceipt> {
  const provider = config.MAIL_PROVIDER || (config.SMTP_HOST ? 'smtp' : 'local');
  if (provider === 'local') {
    if (config.NODE_ENV === 'production') throw new MailProviderError('EMAIL_NOT_CONFIGURED');
    return { provider: 'local', state: 'local', messageId: null };
  }
  const from = options.kind === 'auth' ? config.MAIL_AUTH_FROM || config.MAIL_FROM : config.MAIL_FROM;
  if (!from) throw new MailProviderError('EMAIL_NOT_CONFIGURED');
  const replyTo = config.MAIL_REPLY_TO || undefined;
  if (provider === 'resend') {
    if (!config.RESEND_API_KEY) throw new MailProviderError('EMAIL_NOT_CONFIGURED');
    try {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          ...(options.key ? { 'Idempotency-Key': options.key } : {}),
        },
        body: JSON.stringify({ from, to: [email], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new MailProviderError(response.status === 429 ? 'EMAIL_RATE_LIMITED' : 'EMAIL_PROVIDER_REJECTED');
      const data = await response.json() as { id?: unknown };
      if (typeof data.id !== 'string' || !data.id) throw new MailProviderError('EMAIL_INVALID_RESPONSE');
      return { provider: 'resend', state: 'accepted', messageId: data.id };
    } catch (error) {
      if (error instanceof MailProviderError) throw error;
      throw new MailProviderError('EMAIL_PROVIDER_TIMEOUT');
    }
  }
  if (provider !== 'smtp' || !config.SMTP_HOST) throw new MailProviderError('EMAIL_NOT_CONFIGURED');
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST, port: Number(config.SMTP_PORT || 587),
    secure: ['465', '2465'].includes(config.SMTP_PORT || ''),
    requireTLS: !['465', '2465'].includes(config.SMTP_PORT || ''),
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15000, socketTimeout: 15000,
  });
  try {
    const result = await transport.sendMail({ from, to: email, subject, text, replyTo,
      ...(options.key ? { headers: { 'Resend-Idempotency-Key': options.key } } : {}),
    });
    if (!result.accepted?.length) throw new MailProviderError('EMAIL_PROVIDER_REJECTED');
    return { provider: 'smtp', state: 'accepted', messageId: result.messageId || null };
  } catch (error) {
    if (error instanceof MailProviderError) throw error;
    throw new MailProviderError('EMAIL_PROVIDER_REJECTED');
  } finally { transport.close(); }
}
