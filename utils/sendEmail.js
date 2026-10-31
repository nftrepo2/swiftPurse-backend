/**
 * Zoho ZeptoMail REST API email sender for SwiftPurse Bank.
 *
 * All email delivery uses the Zoho REST API and ZOHO_CPAAS_API_KEY.
 * Delivery uses the Zoho REST API exclusively.
 *
 * Delivery is processed in the background so OTP, registration, login,
 * password-reset, PIN-reset, transfer and admin requests are not held open
 * while Zoho processes an email. Existing sendMail(to, subject, html, text)
 * call sites remain compatible.
 *
 * IMPORTANT: This is an in-process queue. Messages still pending when the
 * server process stops may be lost. For durable delivery across restarts,
 * use a persistent job queue or database-backed outbox.
 */

function clean(value) {
  if (value == null) return '';
  return String(value).trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (!email || email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !domain || domain.length > 253 ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(label => label.length > 0 && label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

function maskEmail(value) {
  const email = String(value || '');
  const parts = email.split('@');
  if (parts.length !== 2) return '[invalid email]';
  const local = parts[0];
  return `${local.length <= 2 ? (local[0] || '*') + '***' : local.slice(0, 2) + '***'}@${parts[1]}`;
}

function getZohoConfig() {
  return {
    apiKey: clean(process.env.ZOHO_CPAAS_API_KEY),
    fromEmail: clean(process.env.ZOHO_FROM_EMAIL || process.env.FROM_EMAIL || 'support@swiftcaptial.com'),
    fromName: clean(process.env.ZOHO_FROM_NAME || process.env.FROM_NAME || 'SwiftPurse Bank'),
    restBase: clean(process.env.ZOHO_EMAIL_API_URL || 'https://cpaas.zoho.com/v1.1/email'),
  };
}

function zohoAuthHeader(apiKey) {
  const key = clean(apiKey);
  if (!key) return null;
  return /^Zoho-enczapikey\s+/i.test(key) ? key : `Zoho-enczapikey ${key}`;
}

function logSafeConfig() {
  const config = getZohoConfig();
  const rawKey = process.env.ZOHO_CPAAS_API_KEY;
  console.info('[Zoho Debug] Configuration:', {
    endpoint: config.restBase,
    endpointIsHttps: config.restBase.startsWith('https://'),
    apiKeyPresent: Boolean(config.apiKey),
    apiKeyLength: config.apiKey.length,
    apiKeyHasOuterWhitespace: typeof rawKey === 'string' && rawKey !== rawKey.trim(),
    apiKeyAlreadyHasAuthPrefix: /^Zoho-enczapikey\s+/i.test(config.apiKey),
    sender: maskEmail(config.fromEmail),
    senderSyntaxValid: isValidEmail(config.fromEmail),
    senderNamePresent: Boolean(config.fromName),
    // The key and Authorization header are deliberately never logged.
  });
  if (!config.apiKey) {
    console.error('[Zoho Diagnosis] ZOHO_CPAAS_API_KEY is missing or empty.');
  } else if (config.apiKey.length < 20) {
    console.warn('[Zoho Diagnosis] API key looks unusually short; verify that the complete Agent Send Mail Token is configured.');
  }
  if (!isValidEmail(config.fromEmail)) {
    console.error('[Zoho Diagnosis] ZOHO_FROM_EMAIL is not a syntactically valid email address.');
  }
  if (!config.restBase.startsWith('https://')) {
    console.error('[Zoho Diagnosis] Zoho REST endpoint must use HTTPS.');
  }
}

function diagnoseHttpError(status, data) {
  const safeResponse = data && typeof data === 'object'
    ? JSON.stringify(data).slice(0, 1200)
    : String(data || '').slice(0, 1200);
  console.error('[Zoho Debug] REST request rejected:', { status, response: safeResponse });
  if (status === 401) {
    console.error('[Zoho Diagnosis] HTTP 401: Zoho rejected authentication. Check the Agent Send Mail Token, matching Zoho agent/data center, and exactly one "Zoho-enczapikey " authorization prefix. The token was not logged.');
  } else if (status === 403) {
    console.error('[Zoho Diagnosis] HTTP 403: access/permission denied. Check agent/account access and endpoint compatibility.');
  } else if (status === 400 || status === 422) {
    console.error('[Zoho Diagnosis] Invalid email request. Check sender verification, recipient addresses and payload fields.');
  } else if (status === 404) {
    console.error('[Zoho Diagnosis] Endpoint not found. Check ZOHO_EMAIL_API_URL and the account data-center endpoint.');
  } else if (status === 429) {
    console.error('[Zoho Diagnosis] Zoho rate limit reached.');
  } else if (status >= 500) {
    console.error('[Zoho Diagnosis] Zoho server-side error.');
  }
}

async function sendViaZohoRest(job) {
  const config = getZohoConfig();
  const auth = zohoAuthHeader(config.apiKey);
  if (!auth) throw new Error('ZOHO_CPAAS_API_KEY is missing.');
  if (typeof fetch !== 'function') throw new Error('Zoho REST email requires Node.js 18 or newer.');
  if (!config.restBase.startsWith('https://')) throw new Error('Zoho REST endpoint must use HTTPS.');
  if (!isValidEmail(config.fromEmail)) throw new Error(`Invalid configured sender email: ${maskEmail(config.fromEmail)}`);
  if (!isValidEmail(job.to)) throw new Error(`Invalid recipient email: ${maskEmail(job.to)}`);

  const payload = {
    from: { address: config.fromEmail, name: config.fromName },
    to: [{ email_address: { address: job.to, name: '' } }],
    subject: job.subject,
    htmlbody: job.html || `<p>${job.subject}</p>`,
  };
  if (job.text) payload.textbody = job.text;

  console.info('[Zoho Debug] Sending email in background:', {
    jobId: job.id,
    endpoint: config.restBase,
    recipient: maskEmail(job.to),
    sender: maskEmail(config.fromEmail),
    subjectPresent: Boolean(job.subject),
    authSchemeValid: /^Zoho-enczapikey\s+\S+/i.test(auth),
  });

  let response;
  try {
    response = await fetch(config.restBase, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('[Zoho Debug] Network error:', {
      jobId: job.id, name: error.name, message: error.message, endpoint: config.restBase,
    });
    throw error;
  }

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; }
  catch (_) { data = { responseText: raw.slice(0, 1200) }; }

  if (!response.ok) {
    diagnoseHttpError(response.status, data);
    const message = data?.message || data?.error?.message ||
      data?.error || `Zoho REST request failed (HTTP ${response.status})`;
    const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return {
    messageId: data?.data?.[0]?.message_id || data?.message_id || data?.request_id || null,
    provider: 'zoho_rest',
    data,
  };
}

const emailQueue = [];
let activeWorkers = 0;
const MAX_CONCURRENT_DELIVERIES = 3;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1200;
let configLogged = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function shouldRetry(error) {
  // Authentication, permission and invalid-payload errors will not improve
  // by retrying. Retry transient network, rate-limit and server failures.
  return !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
}

function processQueue() {
  while (activeWorkers < MAX_CONCURRENT_DELIVERIES && emailQueue.length) {
    const job = emailQueue.shift();
    activeWorkers += 1;

    (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const result = await sendViaZohoRest(job);
          console.info('[Zoho] Email accepted:', {
            jobId: job.id,
            messageId: result.messageId,
            recipient: maskEmail(job.to),
          });
          return;
        } catch (error) {
          console.error('[Zoho] Background delivery attempt failed:', {
            jobId: job.id,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
            recipient: maskEmail(job.to),
            status: error.status || null,
            message: error.message,
          });
          if (attempt >= MAX_ATTEMPTS || !shouldRetry(error)) {
            console.error('[Zoho] Email delivery failed permanently:', {
              jobId: job.id,
              recipient: maskEmail(job.to),
              subject: job.subject,
              status: error.status || null,
              message: error.message,
            });
            return;
          }
          await wait(RETRY_DELAY_MS * attempt);
        }
      }
    })()
      .catch(error => console.error('[Zoho] Unexpected background worker error:', error.message))
      .finally(() => {
        activeWorkers -= 1;
        processQueue();
      });
  }
}

/**
 * Backward-compatible signature: sendMail(to, subject, html, text).
 * Resolves immediately after placing a valid message in the background queue.
 * It does not wait for Zoho and does not expose provider failures to the
 * business/OTP request. Delivery outcomes are reported in the server console.
 */
function sendMail(to, subject, html, text) {
  const recipient = String(to || '').trim();
  const subj = String(subject || '').trim();
  const bodyHtml = String(html || '');
  const bodyText = text == null ? '' : String(text);

  if (!configLogged) {
    configLogged = true;
    logSafeConfig();
  }

  if (!recipient || !isValidEmail(recipient)) {
    console.error('[Zoho Debug] Email not queued: invalid or missing recipient.', {
      recipient: maskEmail(recipient),
    });
    return Promise.resolve({
      id: null, provider: 'zoho_rest_skipped', queued: false,
      error: 'Invalid or missing recipient email.',
    });
  }
  if (!subj) {
    console.error('[Zoho Debug] Email not queued: subject is missing.');
    return Promise.resolve({
      id: null, provider: 'zoho_rest_skipped', queued: false,
      error: 'Email subject is required.',
    });
  }

  const config = getZohoConfig();
  if (!config.apiKey) {
    console.error('[Zoho Debug] Email not queued because ZOHO_CPAAS_API_KEY is missing. Business workflow will continue.');
    return Promise.resolve({
      id: null, provider: 'zoho_rest_skipped', queued: false,
      error: 'Zoho API key is not configured.',
    });
  }
  if (!isValidEmail(config.fromEmail)) {
    console.error('[Zoho Debug] Email not queued because configured sender email is invalid:', maskEmail(config.fromEmail));
    return Promise.resolve({
      id: null, provider: 'zoho_rest_skipped', queued: false,
      error: 'Configured Zoho sender email is invalid.',
    });
  }

  const id = `zoho-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  emailQueue.push({ id, to: recipient, subject: subj, html: bodyHtml, text: bodyText });

  console.info('[Zoho] Email queued without blocking application workflow:', {
    jobId: id,
    recipient: maskEmail(recipient),
    queueLength: emailQueue.length,
  });

  setImmediate(processQueue);

  return Promise.resolve({
    id,
    messageId: id,
    provider: 'zoho_rest',
    queued: true,
  });
}

const sendEmail = sendMail;
module.exports = sendMail;
module.exports.sendMail = sendMail;
module.exports.sendEmail = sendEmail;
module.exports.getZohoConfig = getZohoConfig;
module.exports.logSafeConfig = logSafeConfig;
module.exports.isValidEmail = isValidEmail;
