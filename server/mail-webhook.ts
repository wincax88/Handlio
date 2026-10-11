import type { Express } from 'express';
import { Webhook } from 'svix';
import { z } from 'zod';
import { AppError, now, run, tx } from './db.js';
import { reconcileMailEvents } from './providers.js';

const eventSchema = z.object({ type: z.string(), created_at: z.string().datetime({ offset: true }), data: z.object({ email_id: z.string().min(1).max(200) }) });
const states: Record<string, string> = {
  'email.sent': 'accepted', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced', 'email.failed': 'failed', 'email.complained': 'complained', 'email.suppressed': 'suppressed',
};
export function installMailWebhook(app: Express) {
  app.post('/api/webhooks/resend', (req, res) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new AppError('ACCESS_UNAVAILABLE', 404, 'This endpoint is unavailable.');
    const headers = { 'svix-id': req.get('svix-id') || '', 'svix-timestamp': req.get('svix-timestamp') || '', 'svix-signature': req.get('svix-signature') || '' };
    let verified: unknown;
    try {
      if (!Buffer.isBuffer(req.body) || !headers['svix-id'] || headers['svix-id'].length > 200) throw new Error('Invalid payload');
      const raw = req.body.toString('utf8');
      new Webhook(secret).verify(raw, headers);
      verified = JSON.parse(raw);
    } catch { throw new AppError('WEBHOOK_INVALID', 400, 'Invalid webhook signature.'); }
    const event = eventSchema.safeParse(verified);
    if (!event.success && verified && typeof verified === 'object' && 'type' in verified && typeof verified.type === 'string' && states[verified.type]) {
      throw new AppError('WEBHOOK_INVALID', 400, 'Invalid email event.');
    }
    if (event.success && states[event.data.type]) {
      tx(() => {
        run('INSERT OR IGNORE INTO mail_events VALUES (?,?,?,?,?)', headers['svix-id'], event.data.data.email_id, states[event.data.type], Date.parse(event.data.created_at), now());
        reconcileMailEvents(event.data.data.email_id);
      });
    }
    // Never use delivery/open/click events to change access or handoff confirmations.
    res.json({ ok: true });
  });
}
