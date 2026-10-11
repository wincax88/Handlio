import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { Webhook } from 'svix';
import { deliverMail, validateMailConfiguration } from '../server/mail';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'handlio-mail-tests-'));
process.env.NODE_ENV = 'test';
const { createApp } = await import('../server/app');
const { one, run } = await import('../server/db');
const { notify, processNotifications } = await import('../server/providers');
const app = createApp();
const config = { NODE_ENV: 'production', MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'unit-test-secret', MAIL_FROM: 'Handlio <notifications@handlio.cloud>', MAIL_AUTH_FROM: 'Handlio <auth@handlio.cloud>' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Resend transactional mail', () => {
  test('auth sender, no default reply-to and stable retry key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email-auth' }), { status: 200 }));
    const receipt = await deliverMail('owner@example.test', 'Verification', 'Code 123456', { kind: 'auth', key: 'auth/challenge-id' }, config, fetcher);
    expect(receipt).toEqual({ provider: 'resend', state: 'accepted', messageId: 'email-auth' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers['Idempotency-Key']).toBe('auth/challenge-id');
    expect(JSON.parse(options.body)).toEqual({ from: config.MAIL_AUTH_FROM, to: ['owner@example.test'], subject: 'Verification', text: 'Code 123456' });
  });
  test('notification sender and configured reply mailbox', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email-notification' })));
    await deliverMail('client@example.test', 'Invite', 'Private link', { kind: 'notification' }, { ...config, MAIL_REPLY_TO: 'support@handlio.cloud' }, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ from: config.MAIL_FROM, reply_to: 'support@handlio.cloud' });
  });
  test('provider failure stays safe and cannot become a local success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('sensitive upstream details', { status: 429 }));
    await expect(deliverMail('client@example.test', 'Invite', 'private', {}, config, fetcher)).rejects.toMatchObject({ code: 'EMAIL_RATE_LIMITED', message: 'Email delivery is temporarily unavailable. Retry later.' });
    await expect(deliverMail('x@example.test', 'x', 'x', {}, { NODE_ENV: 'production' })).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
    expect(() => validateMailConfiguration({ ...config, RESEND_API_KEY: '' })).toThrow();
    expect(() => validateMailConfiguration(config)).not.toThrow();
  });
  test('real auth route uses Resend and stores ID without the code or recipient', async () => {
    for (const [key, value] of Object.entries(config)) if (key !== 'NODE_ENV') vi.stubEnv(key, value);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'auth-route-email' })));
    const response = await request(app).post('/api/auth/challenges').send({ email: 'resend-auth@example.test', purpose: 'owner' });
    expect(response.status).toBe(200);
    const sent = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(sent.from).toBe(config.MAIL_AUTH_FROM);
    expect(sent.text).toContain(response.body.devCode);
    const delivery = one('SELECT * FROM mail_deliveries WHERE delivery_key=?', `auth/${response.body.challengeId}`)!;
    expect(delivery.state).toBe('accepted');
    expect(delivery.provider_message_id).toBe('auth-route-email');
    expect(JSON.stringify(delivery)).not.toContain(response.body.devCode);
    const verified = await request(app).post('/api/auth/verify').send({ challengeId: response.body.challengeId, code: response.body.devCode, purpose: 'owner' });
    expect(verified.status).toBe(200);
  });
  test('outbox retries use the same key and record acceptance', async () => {
    for (const [key, value] of Object.entries(config)) if (key !== 'NODE_ENV') vi.stubEnv(key, value);
    notify(null, 'mail-test-event', 'client@example.test', 'Invitation', 'Private invitation');
    const entry = one('SELECT * FROM notifications WHERE event_key=?', 'mail-test-event')!;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'retry-email' })));
    await processNotifications();
    expect(one('SELECT state FROM notifications WHERE id=?', entry.id)!.state).toBe('retry');
    run('UPDATE notifications SET next_at=0 WHERE id=?', entry.id);
    await processNotifications();
    expect(one('SELECT state FROM notifications WHERE id=?', entry.id)!.state).toBe('accepted');
    expect(fetcher.mock.calls.map(call => (call[1]!.headers as Record<string,string>)['Idempotency-Key'])).toEqual([`notification/${entry.id}`, `notification/${entry.id}`]);
  });
  test('webhooks reject forged bodies, deduplicate and preserve terminal state', async () => {
    run('INSERT INTO mail_deliveries VALUES (?,?,?,?,?,?,?,?,?)', 'webhook-delivery', 'webhook-test', 'notification', 'resend', 'webhook-email', 'accepted', null, Date.now(), Date.now());
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret);
    const wh = new Webhook(secret);
    const sendEvent = (id: string, type: string, signatureBody?: string) => {
      const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: 'webhook-email' } });
      const timestamp = new Date();
      return request(app).post('/api/webhooks/resend').set('Content-Type', 'application/json').set('svix-id', id).set('svix-timestamp', String(Math.floor(timestamp.getTime()/1000))).set('svix-signature', wh.sign(id, timestamp, signatureBody || body)).send(body);
    };
    expect((await sendEvent('forged', 'email.delivered', '{}')).status).toBe(400);
    expect((await sendEvent('delivery', 'email.delivered')).status).toBe(200);
    expect((await sendEvent('delivery', 'email.delivered')).status).toBe(200);
    expect(one('SELECT count(*) AS n FROM mail_events WHERE id=?', 'delivery')!.n).toBe(1);
    expect(one('SELECT state FROM mail_deliveries WHERE provider_message_id=?', 'webhook-email')!.state).toBe('delivered');
    await sendEvent('bounce', 'email.bounced');
    await sendEvent('late-sent', 'email.sent');
    expect(one('SELECT state FROM mail_deliveries WHERE provider_message_id=?', 'webhook-email')!.state).toBe('bounced');
    expect(one('SELECT count(*) AS n FROM confirmations')!.n).toBe(0);
    expect((await sendEvent('opened', 'email.opened')).status).toBe(200);
    expect(one('SELECT count(*) AS n FROM mail_events WHERE id=?', 'opened')!.n).toBe(0);
  });
});
