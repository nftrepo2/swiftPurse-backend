/**
 * Country → currency mapping.
 * KYC-selected country is the primary source of truth for the user's display currency.
 */
const COUNTRY_CURRENCY = {
  // North America
  'united states': { code: 'USD', symbol: '$' },
  'united states of america': { code: 'USD', symbol: '$' },
  usa: { code: 'USD', symbol: '$' },
  us: { code: 'USD', symbol: '$' },
  canada: { code: 'CAD', symbol: 'C$' },
  mexico: { code: 'MXN', symbol: 'MX$' },

  // United Kingdom & related
  'united kingdom': { code: 'GBP', symbol: '£' },
  uk: { code: 'GBP', symbol: '£' },
  'great britain': { code: 'GBP', symbol: '£' },
  england: { code: 'GBP', symbol: '£' },
  scotland: { code: 'GBP', symbol: '£' },
  wales: { code: 'GBP', symbol: '£' },
  'northern ireland': { code: 'GBP', symbol: '£' },
  london: { code: 'GBP', symbol: '£' },

  // Eurozone / Europe
  germany: { code: 'EUR', symbol: '€' },
  france: { code: 'EUR', symbol: '€' },
  italy: { code: 'EUR', symbol: '€' },
  spain: { code: 'EUR', symbol: '€' },
  netherlands: { code: 'EUR', symbol: '€' },
  belgium: { code: 'EUR', symbol: '€' },
  austria: { code: 'EUR', symbol: '€' },
  portugal: { code: 'EUR', symbol: '€' },
  ireland: { code: 'EUR', symbol: '€' },
  finland: { code: 'EUR', symbol: '€' },
  greece: { code: 'EUR', symbol: '€' },
  luxembourg: { code: 'EUR', symbol: '€' },
  slovakia: { code: 'EUR', symbol: '€' },
  slovenia: { code: 'EUR', symbol: '€' },
  estonia: { code: 'EUR', symbol: '€' },
  latvia: { code: 'EUR', symbol: '€' },
  lithuania: { code: 'EUR', symbol: '€' },
  malta: { code: 'EUR', symbol: '€' },
  cyprus: { code: 'EUR', symbol: '€' },
  croatia: { code: 'EUR', symbol: '€' },
  switzerland: { code: 'CHF', symbol: 'CHF' },
  sweden: { code: 'SEK', symbol: 'kr' },
  norway: { code: 'NOK', symbol: 'kr' },
  denmark: { code: 'DKK', symbol: 'kr' },
  poland: { code: 'PLN', symbol: 'zł' },
  'czech republic': { code: 'CZK', symbol: 'Kč' },
  hungary: { code: 'HUF', symbol: 'Ft' },
  romania: { code: 'RON', symbol: 'lei' },
  bulgaria: { code: 'BGN', symbol: 'лв' },

  // Africa
  nigeria: { code: 'NGN', symbol: '₦' },
  ghana: { code: 'GHS', symbol: 'GH₵' },
  kenya: { code: 'KES', symbol: 'KSh' },
  'south africa': { code: 'ZAR', symbol: 'R' },
  egypt: { code: 'EGP', symbol: 'E£' },
  morocco: { code: 'MAD', symbol: 'MAD' },
  tanzania: { code: 'TZS', symbol: 'TSh' },
  uganda: { code: 'UGX', symbol: 'USh' },
  rwanda: { code: 'RWF', symbol: 'FRw' },
  ethiopia: { code: 'ETB', symbol: 'Br' },
  cameroon: { code: 'XAF', symbol: 'FCFA' },
  senegal: { code: 'XOF', symbol: 'CFA' },
  'ivory coast': { code: 'XOF', symbol: 'CFA' },
  "cote d'ivoire": { code: 'XOF', symbol: 'CFA' },

  // Asia / Middle East
  india: { code: 'INR', symbol: '₹' },
  china: { code: 'CNY', symbol: '¥' },
  japan: { code: 'JPY', symbol: '¥' },
  'south korea': { code: 'KRW', symbol: '₩' },
  singapore: { code: 'SGD', symbol: 'S$' },
  'hong kong': { code: 'HKD', symbol: 'HK$' },
  malaysia: { code: 'MYR', symbol: 'RM' },
  indonesia: { code: 'IDR', symbol: 'Rp' },
  thailand: { code: 'THB', symbol: '฿' },
  philippines: { code: 'PHP', symbol: '₱' },
  vietnam: { code: 'VND', symbol: '₫' },
  pakistan: { code: 'PKR', symbol: '₨' },
  bangladesh: { code: 'BDT', symbol: '৳' },
  'saudi arabia': { code: 'SAR', symbol: '﷼' },
  'united arab emirates': { code: 'AED', symbol: 'د.إ' },
  uae: { code: 'AED', symbol: 'د.إ' },
  qatar: { code: 'QAR', symbol: '﷼' },
  israel: { code: 'ILS', symbol: '₪' },
  turkey: { code: 'TRY', symbol: '₺' },

  // Oceania / Americas
  australia: { code: 'AUD', symbol: 'A$' },
  'new zealand': { code: 'NZD', symbol: 'NZ$' },
  brazil: { code: 'BRL', symbol: 'R$' },
  argentina: { code: 'ARS', symbol: 'AR$' },
  chile: { code: 'CLP', symbol: 'CLP$' },
  colombia: { code: 'COP', symbol: 'COL$' },
};

const DEFAULT_CURRENCY = { code: 'USD', symbol: '$' };

function normalizeCountry(country) {
  if (!country) return '';
  return String(country)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, '');
}

/**
 * Resolve currency from a country name (KYC country is first priority).
 * @param {string} country
 * @returns {{ code: string, symbol: string }}
 */
function getCurrencyForCountry(country) {
  const key = normalizeCountry(country);
  if (!key) return { ...DEFAULT_CURRENCY };

  if (COUNTRY_CURRENCY[key]) return { ...COUNTRY_CURRENCY[key] };

  // Partial / fuzzy matches
  for (const [name, cur] of Object.entries(COUNTRY_CURRENCY)) {
    if (key.includes(name) || name.includes(key)) {
      return { ...cur };
    }
  }

  // Common aliases
  if (key.includes('united states') || key === 'america') return { code: 'USD', symbol: '$' };
  if (key.includes('united kingdom') || key.includes('britain') || key === 'london') {
    return { code: 'GBP', symbol: '£' };
  }

  return { ...DEFAULT_CURRENCY };
}

/**
 * Get display currency for a user document.
 * Priority: KYC country (user.country) → stored currency fields → default USD.
 */
function getUserCurrency(user) {
  if (!user) return { ...DEFAULT_CURRENCY };
  if (user.country) {
    return getCurrencyForCountry(user.country);
  }
  if (user.currency_code || user.currency_symbol) {
    return {
      code: (user.currency_code || 'USD').toUpperCase(),
      symbol: user.currency_symbol || DEFAULT_CURRENCY.symbol,
    };
  }
  return { ...DEFAULT_CURRENCY };
}

/**
 * Extract client IP from Express request (supports proxies).
 */
function getClientIp(req) {
  if (!req) return '';
  const xf = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (xf) {
    const first = String(xf).split(',')[0].trim();
    if (first) return first.replace(/^::ffff:/, '');
  }
  const raw =
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    (req.ip && String(req.ip)) ||
    '';
  return String(raw).replace(/^::ffff:/, '') || '';
}

/**
 * Optionally resolve country from IP via free ip-api (best-effort, non-blocking failure).
 * Returns country name string or empty string.
 */
async function resolveIpCountry(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return '';
  }
  try {
    const https = require('https');
    const url = `https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country`;
    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
    if (data && data.status === 'success' && data.country) return String(data.country);
  } catch (_) {
    // ignore network errors
  }
  return '';
}

module.exports = {
  COUNTRY_CURRENCY,
  DEFAULT_CURRENCY,
  getCurrencyForCountry,
  getUserCurrency,
  getClientIp,
  resolveIpCountry,
  normalizeCountry,
};
