/**
 * Zoho / ZeptoMail email sender
 * Prefers SMTP when ZOHO_SMTP_PASS is set; falls back to REST API (ZOHO_CPAAS_API_KEY).
 * Replaces Bird.com integration.
 */
const nodemailer = require('nodemailer');

function clean(v) {
  return String(v || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

function getZohoConfig() {
  const apiKey = clean(process.env.ZOHO_CPAAS_API_KEY || process.env.ZOHO_EMAIL_API_KEY);
  const fromEmail = clean(
    process.env.ZOHO_FROM_EMAIL || process.env.FROM_EMAIL || 'support@swiftcaptial.com'
  );
  const fromName = clean(
    process.env.ZOHO_FROM_NAME || process.env.FROM_NAME || 'SwiftPurse Bank'
  );
  const smtpHost = clean(process.env.ZOHO_SMTP_HOST || 'smtp.zeptomail.com');
  const smtpPort = Number(process.env.ZOHO_SMTP_PORT || 465);
  const smtpUser = clean(process.env.ZOHO_SMTP_USER || 'emailapikey');
  const smtpPass = clean(process.env.ZOHO_SMTP_PASS || process.env.ZOHO_SMTP_PASSWORD);
  const restBase = clean(
    process.env.ZOHO_EMAIL_API_URL || 'https://api.zeptomail.com/v1.1/email'
  );
  return { apiKey, fromEmail, fromName, smtpHost, smtpPort, smtpUser, smtpPass, restBase };
}

function zohoAuthHeader(apiKey) {
  let key = clean(apiKey);
  if (!key) return null;
  if (!/^Zoho-enczapikey\s+/i.test(key)) {
    key = `Zoho-enczapikey ${key}`;
  }
  return key;
}

async function sendViaZohoSmtp({ to, subject, html, text, fromEmail, fromName, smtp }) {
  const transporter = nodemailer.createTransport({
    host: smtp.smtpHost,
    port: smtp.smtpPort,
    secure: smtp.smtpPort === 465,
    auth: {
      user: smtp.smtpUser,
      pass: smtp.smtpPass,
    },
  });

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text: text || undefined,
    html: html || `<p>${subject}</p>`,
  });

  console.log('Zoho SMTP accepted:', info.messageId);
  return {
    messageId: info.messageId,
    provider: 'zoho_smtp',
    data: info,
  };
}

async function sendViaZohoRest({ to, subject, html, text, fromEmail, fromName, apiKey, restBase }) {
  const auth = zohoAuthHeader(apiKey);
  if (!auth) {
    throw new Error('ZOHO_CPAAS_API_KEY not set for Zoho email REST');
  }

  const payload = {
    from: { address: fromEmail, name: fromName },
    to: [{ email_address: { address: to, name: '' } }],
    subject,
    htmlbody: html || `<p>${subject}</p>`,
  };
  if (text) payload.textbody = text;

  console.log('Zoho email REST:', { url: restBase, to, from: fromEmail });
  const res = await fetch(restBase, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = { raw };
  }

  if (!res.ok) {
    console.error('Zoho Email REST error:', data);
    const err = new Error(
      data?.message || data?.error?.message || 'Zoho email send failed'
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return {
    messageId: data?.data?.[0]?.message_id || data?.message_id || data?.request_id,
    provider: 'zoho_rest',
    data,
  };
}

/**
 * sendMail(to, subject, html) — drop-in replacement for previous Bird sendMail
 */
async function sendMail(to, subject, html, text) {
  const recipient = String(to || '').trim();
  const subj = String(subject || '').trim();
  const bodyHtml = String(html || '');

  if (!recipient) throw new Error('sendMail: recipient email is required');
  if (!subj) throw new Error('sendMail: subject is required');

  const z = getZohoConfig();

  if (z.smtpPass) {
    try {
      return await sendViaZohoSmtp({
        to: recipient,
        subject: subj,
        html: bodyHtml,
        text,
        fromEmail: z.fromEmail,
        fromName: z.fromName,
        smtp: z,
      });
    } catch (e) {
      console.error('Zoho SMTP failed, trying REST:', e.message);
    }
  }

  if (z.apiKey) {
    return sendViaZohoRest({
      to: recipient,
      subject: subj,
      html: bodyHtml,
      text,
      fromEmail: z.fromEmail,
      fromName: z.fromName,
      apiKey: z.apiKey,
      restBase: z.restBase,
    });
  }

  console.warn(
    'Zoho email not configured (need ZOHO_SMTP_PASS or ZOHO_CPAAS_API_KEY). Subject:',
    subj,
    'To:',
    recipient
  );
  return { id: 'dev-skip', provider: 'none', messageId: 'dev-skip-' + Date.now() };
}

module.exports = sendMail;
module.exports.sendMail = sendMail;
module.exports.getZohoConfig = getZohoConfig;
