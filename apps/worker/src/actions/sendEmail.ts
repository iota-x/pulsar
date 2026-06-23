import nodemailer from 'nodemailer';
import type { ActionHandler } from './types';

// Build a transport only if SMTP is configured; otherwise fall back to logging.
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

const transport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export const sendEmail: ActionHandler = async (config, triggerData) => {
  if (!config.to) throw new Error('send_email: "to" is required');

  const subject = config.subject ?? 'Web3 Zapier notification';
  const body = config.body ?? `Workflow triggered:\n${JSON.stringify(triggerData, null, 2)}`;

  if (!transport) {
    console.log(`[send_email] (SMTP not configured) would email ${config.to}: ${subject}`);
    return `Email simulated to ${config.to} (configure SMTP_* to send for real)`;
  }

  await transport.sendMail({ from: process.env.SMTP_FROM, to: config.to, subject, text: body });
  return `Email sent to ${config.to}`;
};
