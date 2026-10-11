// Send only to the operator's explicitly configured test inbox; print no credentials or contents.
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const env = process.env;
if (env.MAIL_PROVIDER === 'resend') {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.MAIL_AUTH_FROM) throw new Error('Resend credentials and senders must be configured.');
  const recipient = env.MAIL_TEST_RECIPIENT;
  if (!recipient || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) throw new Error('MAIL_TEST_RECIPIENT must be a mailbox controlled by the operator.');
  const revision = env.GITHUB_SHA || 'manual-configuration-check';
  for (const [kind, from] of [['auth', env.MAIL_AUTH_FROM], ['notification', env.MAIL_FROM]]) {
    const body = JSON.stringify({ from, to: [recipient], subject: `Handlio ${kind} email configuration check`, text: `This message checks Handlio's ${kind} sender for deployment ${revision}. No action is required. It contains no verification code or private manual link.`, ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}) });
    const contentHash = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `deployment/${revision}/${kind}/${contentHash}` },
      body,
    });
    if (!response.ok) throw new Error(`Resend rejected the ${kind} sender check (HTTP ${response.status}). Verify the API key, sending permissions and handlio.cloud domain status.`);
    const result = await response.json();
    if (typeof result.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(result.id)) throw new Error('Resend did not return a valid email ID.');
    console.log(`Resend ${kind} check accepted: ${result.id}. Delivery must be verified separately.`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `Resend ${kind} check accepted: \`${result.id}\`. Check the recipient inbox and Resend delivery status.\n\n`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
