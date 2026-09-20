const router = require('express').Router();
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const User = require('../models/user.model');
const { registerValidator } = require('../utils/validators');
const { createToken, maxAge, requireAuth, getTokenFromReq, JWT_SECRET } = require('../utils/authMiddleware');
const { getPushConfig, sendPushToUser } = require('../utils/pushNotifications');

const frontendUrl = () => String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
const BIRD_API_KEY = process.env.BIRD_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'support@swiftpursebank.com';
const FROM_NAME = process.env.FROM_NAME || 'SwiftPurse Bank';

/** Infer Bird regional API host from key prefix (bk_us1_... / bk_eu1_...) */
function birdBaseUrl() {
  const key = String(BIRD_API_KEY || '');
  if (key.includes('_us1_') || key.startsWith('bk_eu1')) return 'https://us1.platform.bird.com';
  return 'https://us1.platform.bird.com';
}

// In-memory OTP store (replace with Redis/DB in production)
const otpStore = new Map();
const resetStore = new Map();

function otpEmailHtml(code) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eff1ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eff1ff;padding:24px 12px">
<tr><td align="center">
<table width="590" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="padding:28px 24px;text-align:center;background:#eff1ff">
<img src="https://swiftpursebank.com/i/logo.png" alt="SwiftPurse Bank" width="180" style="display:block;margin:0 auto">
</td></tr>
<tr><td style="padding:20px 30px">
<p style="font-size:18px;margin:0 0 12px">Hi there,</p>
<p style="font-size:16px;line-height:1.5;color:#333">Email OTP Verification</p>
<p style="font-size:16px;line-height:1.5;color:#333">With an active SwiftPurse Bank Business account, you will not need to wait for days to confirm payments - notifications are right on time when money lands in your account and when your payment gets to a beneficiary account.</p>
<p style="font-size:16px;line-height:1.5;color:#333">Below is your one time passcode that you need to use to complete your authentication. The verification code will be valid for 30 minutes. Please do not share this code with anyone.</p>
<p style="font-size:28px;font-weight:700;text-align:center;letter-spacing:6px;margin:28px 0">${code}</p>
<p style="font-size:16px;margin:0">Love,<br><br>The SwiftPurse Bank Team</p>
</td></tr>
<tr><td style="padding:20px 30px;border-top:1px solid #e3e3e3;color:#979797;font-size:12px">
<p>2026 SwiftPurse Bank. All rights reserved.</p>
<p>UK banking services offered by SwiftPurse Bank (RC796975) with registered address at Head office: 21 Lombard St, city of london,London Ec3v 9AH , UK.</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

function welcomeEmailHtml() {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eff1ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eff1ff;padding:24px 12px">
<tr><td align="center">
<table width="590" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="padding:28px 24px;text-align:center;background:#eff1ff">
<img src="https://swiftpursebank.com/i/logo.png" alt="SwiftPurse Bank" width="180">
</td></tr>
<tr><td style="padding:20px 30px">
<p style="font-size:18px">Hi there,</p>
<p style="font-size:16px;line-height:1.5">Welcome to SwiftPurse Bank! We're thrilled to have you as a new member of our online community. Get ready to unlock a world of possibilities for your business.</p>
<p style="font-size:16px;line-height:1.5">With an active SwiftPurse Bank Business account, you will not need to wait for days to confirm payments - notifications are right on time when money lands in your account and when your payment gets to a beneficiary account.</p>
<p style="font-size:16px;line-height:1.5">Move on to better things like instant payments with SwiftPurse Bank Business now.</p>
<p style="font-size:16px">Love,<br><br>The SwiftPurse Bank Team</p>
</td></tr>
<tr><td style="padding:20px 30px;border-top:1px solid #e3e3e3;color:#979797;font-size:12px">
<p>2026 SwiftPurse Bank. All rights reserved.</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

function resetEmailHtml(resetLink) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eff1ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eff1ff;padding:24px 12px">
<tr><td align="center">
<table width="590" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="padding:28px 24px;text-align:center;background:#eff1ff">
<img src="https://swiftpursebank.com/i/logo.png" alt="SwiftPurse Bank" width="180">
</td></tr>
<tr><td style="padding:20px 30px">
<p style="font-size:18px">Hi there,</p>
<p style="font-size:16px;line-height:1.5">We received a request to reset your passcode. If you initiated this request, please click the link below to proceed:</p>
<p style="text-align:center;margin:28px 0">
<a href="${resetLink}" style="display:inline-block;background:#19202F;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700">Reset Your Passcode</a>
</p>
<p style="font-size:14px;color:#666">For security purposes, this link will expire in 5 minutes and can only be used once. If you did not request a passcode reset, please disregard this email or contact our support team immediately.</p>
<p style="font-size:16px">Best Regards,<br><br>The SwiftPurse Bank Team</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

async function sendMail(to, subject, html) {
  if (!BIRD_API_KEY) {
    console.warn('BIRD_API_KEY not set – email not sent. Subject:', subject, 'To:', to);
    return { id: 'dev-skip' };
  }

  const fromEmail = String(FROM_EMAIL || '').trim();
  const payload = {
    from: { email: fromEmail, name: FROM_NAME },
    to: [String(to).trim()],
    subject: String(subject || ''),
    html: String(html || ''),
    category: 'transactional',
  };

  const url = birdBaseUrl() + '/v1/email/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + BIRD_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }

  if (!res.ok) {
    const msg = (data && (data.message || data.error || data.detail)) || text || res.statusText;
    console.error('Bird email failed:', res.status, msg);
    const err = new Error(typeof msg === 'string' ? msg : 'Bird email send failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data || { id: 'bird-ok' };
}

// GET pages → redirect to frontend
router.get('/login', (req, res) => res.redirect(`${frontendUrl()}/login.html`));
router.get('/register', (req, res) => res.redirect(`${frontendUrl()}/register.html`));
router.get('/signup', (req, res) => res.redirect(`${frontendUrl()}/register.html`));

// POST register
router.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, username, email, password } = req.body || {};
    if (!first_name || !last_name || !username || !email || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'Passcode must be at least 6 characters' });
    }
    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Email or username already registered' });
    }
    const account_no = 'SP' + Date.now().toString().slice(-10);
    const user = await User.create({
      first_name: String(first_name).trim(),
      last_name: String(last_name).trim(),
      username: String(username).trim().toLowerCase(),
      email: String(email).trim().toLowerCase(),
      password: String(password),
      account_no,
      verificationStatus: 'not_verified',
      isVerified: false,
    });
    const code = String(Math.floor(10000 + Math.random() * 90000));
    otpStore.set(user.email, { code, expires: Date.now() + 30 * 60 * 1000, userId: String(user._id) });
    try {
      await sendMail(user.email, 'Confirm Email – SwiftPurse Bank', otpEmailHtml(code));
    } catch (mailErr) {
      console.error('Register email error:', mailErr.message);
    }
    const token = createToken(user._id);
    return res.status(201).json({
      success: true,
      message: 'Account created. Verification email sent.',
      token,
      user: {
        _id: user._id,
        first_name: user.first_name,
        last_name: user.last_name,
        name: user.name,
        username: user.username,
        email: user.email,
        verificationStatus: user.verificationStatus,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Registration failed' });
  }
});

// Check email exists (login step 1)
router.post('/login/check-email', async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    const user = await User.findOne({ email }).select('first_name last_name name email image username role verificationStatus isVerified');
    if (!user) return res.status(404).json({ success: false, message: 'No account found with this email' });
    return res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name || [user.first_name, user.last_name].filter(Boolean).join(' '),
        email: user.email,
        image: user.image || '',
        username: user.username,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Check failed' });
  }
});

// POST login
router.post('/login', async (req, res) => {
  try {
    const { email, password, remember } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and passcode required' });
    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select('+password');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or passcode' });
    if (user.isBlocked) return res.status(403).json({ success: false, message: 'Your account has been blocked. Contact support.' });
    const ok = await user.comparePassword(String(password));
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid email or passcode' });
    const token = createToken(user._id);
    const sameSite = process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax');
    res.cookie('jwt', token, {
      httpOnly: true,
      maxAge: (remember ? maxAge * 7 : maxAge) * 1000,
      sameSite,
      secure: sameSite === 'none' || process.env.NODE_ENV === 'production',
      path: '/',
    });
    return res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        first_name: user.first_name,
        last_name: user.last_name,
        name: user.name,
        username: user.username,
        email: user.email,
        image: user.image,
        role: user.role,
        verificationStatus: user.verificationStatus,
        isVerified: user.isVerified,
        account_verify: user.account_verify,
        balance: user.balance,
        account_no: user.account_no,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Login failed' });
  }
});

// Verify email OTP
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code, id } = req.body || {};
    const key = String(email || '').trim().toLowerCase();
    const entry = otpStore.get(key);
    if (!entry || entry.code !== String(code).trim()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }
    if (Date.now() > entry.expires) {
      otpStore.delete(key);
      return res.status(400).json({ success: false, message: 'Verification code expired' });
    }
    const user = await User.findById(entry.userId || id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    // Mark email verified path (still needs KYC)
    user.verificationStatus = user.verificationStatus === 'verified' ? 'verified' : 'not_verified';
    await user.save();
    otpStore.delete(key);
    try {
      await sendMail(user.email, 'Welcome to SwiftPurse Bank', welcomeEmailHtml());
    } catch (e) {
      console.error('Welcome email error:', e.message);
    }
    const token = createToken(user._id);
    return res.json({
      success: true,
      message: 'Email verified',
      token,
      user: {
        _id: user._id,
        first_name: user.first_name,
        last_name: user.last_name,
        name: user.name,
        email: user.email,
        verificationStatus: user.verificationStatus,
        role: user.role,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Verification failed' });
  }
});

// Resend OTP
router.post('/resend-verification', async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const code = String(Math.floor(10000 + Math.random() * 90000));
    otpStore.set(email, { code, expires: Date.now() + 30 * 60 * 1000, userId: String(user._id) });
    await sendMail(email, 'Confirm Email – SwiftPurse Bank', otpEmailHtml(code));
    return res.json({ success: true, message: 'Verification code resent' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Verification resend failed' });
  }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    const user = await User.findOne({ email });
    // Always return success to avoid email enumeration
    if (!user) {
      return res.json({ success: true, message: 'Reset Code Sent Successfully. Check your Email.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    resetStore.set(token, { userId: String(user._id), email, expires: Date.now() + 5 * 60 * 1000 });
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();
    const link = `${frontendUrl()}/reset-password.html?token=${token}&email=${encodeURIComponent(email)}`;
    await sendMail(email, 'Reset Your Passcode – SwiftPurse Bank', resetEmailHtml(link));
    return res.json({ success: true, message: 'Reset Code Sent Successfully. Check your Email.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Request failed' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'Passcode must be 6 digits' });
    }
    let user = null;
    const mem = resetStore.get(token);
    if (mem && Date.now() <= mem.expires) {
      user = await User.findById(mem.userId).select('+password +resetPasswordToken +resetPasswordExpires');
    }
    if (!user) {
      user = await User.findOne({
        email: String(email || '').toLowerCase(),
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() },
      }).select('+password +resetPasswordToken +resetPasswordExpires');
    }
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });
    user.password = String(password);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    resetStore.delete(token);
    return res.json({ success: true, message: 'Password Update Successful.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Reset failed' });
  }
});


// ---------- Session / current user ----------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    return res.json({
      _id: user._id,
      id: user._id,
      first_name: user.first_name,
      last_name: user.last_name,
      name: user.name,
      username: user.username,
      email: user.email,
      image: user.image,
      role: user.role,
      verificationStatus: user.verificationStatus,
      isVerified: user.isVerified,
      account_verify: user.account_verify,
      balance: user.balance,
      account_no: user.account_no,
      account_tier: user.account_tier || 'Tier 1',
      phone: user.phone,
      country: user.country,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load user' });
  }
});

function clearAuthCookie(res) {
  const sameSite = process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax');
  res.clearCookie('jwt', {
    httpOnly: true,
    sameSite,
    secure: sameSite === 'none' || process.env.NODE_ENV === 'production',
    path: '/',
  });
}

router.get('/logout', (req, res) => {
  clearAuthCookie(res);
  if (req.session) req.session.destroy(() => {});
  return res.json({ success: true, message: 'Logged out' });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  if (req.session) req.session.destroy(() => {});
  return res.json({ success: true, message: 'Logged out' });
});

// ---------- Web Push (aligned with frontend auth.js) ----------
router.get('/push-config', (req, res) => {
  const config = getPushConfig();
  if (!config) return res.json({ enabled: false, publicKey: null });
  return res.json({ enabled: true, publicKey: config.publicKey });
});

router.post('/push-subscribe', async (req, res) => {
  try {
    const subscription = (req.body || {}).subscription;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ success: false, message: 'Invalid push subscription' });
    }

    let user = req.user || null;
    if (!user) {
      try {
        const jwt = require('jsonwebtoken');
        const User = require('../models/user.model');
        const token = getTokenFromReq(req);
        if (token) {
          const decoded = jwt.verify(token, JWT_SECRET || process.env.SESSION_SECRET);
          user = await User.findById(decoded.id || decoded._id);
        }
      } catch (_) {}
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Login required to save push subscription' });
    }

    const list = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions.slice() : [];
    const filtered = list.filter((item) => item && item.endpoint !== subscription.endpoint);
    filtered.push(subscription);
    user.pushSubscriptions = filtered.slice(-10);
    user.pushSubscription = subscription;
    await user.save({ validateBeforeSave: false });
    return res.json({ success: true, message: 'Push subscription saved' });
  } catch (err) {
    console.error('push-subscribe error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to save subscription' });
  }
});

router.delete('/push-subscribe', requireAuth, async (req, res) => {
  try {
    const user = await require('../models/user.model').findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const endpoint = (req.body || {}).endpoint;
    if (endpoint && Array.isArray(user.pushSubscriptions)) {
      user.pushSubscriptions = user.pushSubscriptions.filter((s) => s && s.endpoint !== endpoint);
    } else {
      user.pushSubscriptions = [];
    }
    user.pushSubscription = user.pushSubscriptions[user.pushSubscriptions.length - 1] || null;
    await user.save({ validateBeforeSave: false });
    return res.json({ success: true, message: 'Push subscription removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to remove subscription' });
  }
});

router.post('/push-test', requireAuth, async (req, res) => {
  try {
    const User = require('../models/user.model');
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const result = await sendPushToUser(user, {
      title: (req.body && req.body.title) || 'SwiftPurse Bank',
      body: (req.body && req.body.body) || 'Test notification',
      url: (req.body && req.body.url) || '/user/dashboard.html',
    });
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Push test failed' });
  }
});

module.exports = router;
