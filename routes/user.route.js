const router = require('express').Router();
const cloudinary = require('cloudinary').v2;
const Verify = require('../models/verifySchema');
const User = require('../models/user.model');

const NotificationController = require('../utils/NotificationController');
const Notification = require('../models/Notification');
const { sendPushToUser } = require('../utils/pushNotifications');
const Transaction = require('../models/Transaction');
const Transfer = require('../models/Transfer');
const Card = require('../models/Card');
const Loan = require('../models/Loan');
const LoanPlan = require('../models/LoanPlan');
const CardType = require('../models/CardType');
const CardTransaction = require('../models/CardTransaction');
const Deposit = require('../models/Deposit');
const CryptoWallet = require('../models/CryptoWallet');
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

function transferEmailHtml(details) {
  const statusColor = details.status === 'Successful' ? 'green' : 'goldenrod';
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#eff1ff;padding:24px">
  <div style="max-width:590px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="text-align:center;padding:24px 0"><img src="https://swiftpursebank.com/i/logo.png" alt="SwiftPurse" style="max-width:200px;height:auto"/></div>
    <div style="padding:8px 30px 20px;color:#000;font-size:16px;line-height:1.5">
      <p style="font-size:18px;margin:0 0 12px">We hope this message finds you well. This is to inform you that you have initiated a bank transfer request. Below are the details of the recent transaction:</p>
      <p style="font-size:18px;margin:16px 0">
        Bank Name: ${details.bank}<br/>
        SWIFT Code: ${details.swift}<br/>
        Country: ${details.country}<br/>
        Account Number: ${details.account_no}<br/>
        Account Holder Name: ${details.holder_name}<br/>
        Amount Transferred: ${Number(details.amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}<br/>
        Transferred Currency: ${details.currency}<br/>
        Date and time: ${details.datetime}<br/>
        Current Account Balance: ${Number(details.balance).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}<br/>
        Transaction Status: <span style="color:${statusColor}">${details.status}</span><br/>
        Transaction ID: ${details.txId}<br/>
      </p>
      <p style="font-size:18px;margin:16px 0">For any questions or assistance regarding this transaction, please contact SwiftPurse Bank's Customer Support at <a href="mailto:support@swiftpursebank.com">support@swiftpursebank.com</a>.<br/><strong>Thank you for banking with SwiftPurse Bank.</strong></p>
      <p style="font-size:18px;margin:24px 0 0">Love,<br/><br/>The SwiftPurse Bank Team</p>
    </div>
    <div style="padding:20px 30px;border-top:1px solid #e3e3e3;color:#979797;font-size:12px">
      <p>2026 SwiftPurse Bank . All rights reserved.</p>
      <p>UK banking services offered by SwiftPurse Bank (RC796975) with registered address at Head office: 21 Lombard St, city of london,London Ec3v 9AH , UK.</p>
    </div>
  </div>
</div>`;
}



cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadToCloudinary(fileBuffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: folder || 'swiftpurse/kyc', resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(fileBuffer);
  });
}

// ---------- Verification ----------
router.get('/verification', async (req, res) => {
  try {
    const latest = await Verify.findOne({ $or: [{ user: req.user._id }, { user_id: req.user._id }] })
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: latest });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch verification' });
  }
});

router.post('/verification', async (req, res) => {
  try {
    // Support multipart via express-fileupload or multer-style; also base64 fallback
    const body = req.body || {};
    const files = req.files || {};

    let frontUrl = body.frontimg || '';
    let backUrl = body.backimg || '';
    let photoUrl = body.photo || '';

    if (files.frontimg) {
      const r = await uploadToCloudinary(files.frontimg.data, 'swiftpurse/kyc');
      frontUrl = r.secure_url;
    }
    if (files.backimg) {
      const r = await uploadToCloudinary(files.backimg.data, 'swiftpurse/kyc');
      backUrl = r.secure_url;
    }
    if (files.photo) {
      const r = await uploadToCloudinary(files.photo.data, 'swiftpurse/kyc');
      photoUrl = r.secure_url;
    }

    if (!frontUrl || !backUrl) {
      return res.status(400).json({ success: false, message: 'Front and back ID images are required' });
    }

    const doc = await Verify.create({
      user: req.user._id,
      user_id: req.user._id,
      document_type: body.document_type || 'ID',
      frontimg: frontUrl,
      backimg: backUrl,
      idcardFront: frontUrl,
      idcardBack: backUrl,
      status: 'pending',
      subject: body.address || '',
      message: [body.country, body.phone, body.address].filter(Boolean).join(' | '),
    });

    const user = await User.findById(req.user._id);
    if (user) {
      user.verificationStatus = 'pending';
      user.account_verify = 'Pending';
      if (body.phone) user.phone = body.phone;
      if (body.country) user.country = body.country;
      if (photoUrl) user.image = photoUrl;
      await user.save();
    }

    return res.json({
      success: true,
      message: 'Verification submitted',
      status: 'pending',
      data: doc,
      user: user
        ? {
            _id: user._id,
            first_name: user.first_name,
            last_name: user.last_name,
            name: user.name,
            email: user.email,
            image: user.image,
            verificationStatus: user.verificationStatus,
            role: user.role,
          }
        : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Verification submit failed' });
  }
});


router.get('/dashboard/notifications', NotificationController.list);
router.get('/dashboard/notifications/unread', NotificationController.unread);
router.post('/dashboard/notifications/:id/read', NotificationController.markAsRead);
router.post('/dashboard/notifications/read-all', NotificationController.markAllAsRead);
router.delete('/dashboard/notifications/:id', NotificationController.destroy);
router.get('/dashboard/notification', NotificationController.list);

// ---------- Dashboard ----------
router.get('/dashboard', async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ user_id: req.user._id, read_at: null });
    let transactions = await Transaction.find({ user_id: req.user._id }).sort({ createdAt: -1 }).limit(30).lean();
    // Backfill approved loans as credit rows when no matching Loan Disbursement transaction exists
    try {
      const Loan = require('../models/Loan');
      const loans = await Loan.find({
        user_id: req.user._id,
        status: { $in: ['active', 'repaying', 'completed'] },
        approved_at: { $ne: null },
      }).sort({ approved_at: -1 }).limit(20).lean();
      const existingLoanIds = new Set(
        transactions
          .map((t) => (t.meta && t.meta.loan_id ? String(t.meta.loan_id) : ''))
          .filter(Boolean)
      );
      const alsoByTitle = transactions.filter((t) => /loan\s*disburse/i.test(String(t.title || '')));
      loans.forEach((loan) => {
        const lid = String(loan._id);
        if (existingLoanIds.has(lid)) return;
        const amt = Number(loan.approved_amount || loan.amount || 0);
        if (!amt) return;
        transactions.push({
          _id: 'loan-' + lid,
          user_id: req.user._id,
          type: 'credit',
          title: 'Loan Disbursement',
          amount: amt,
          currency: '$',
          status: 'Successful',
          description: 'Loan approved and disbursed',
          meta: { loan_id: lid, source: 'loan-approve' },
          createdAt: loan.approved_at || loan.createdAt,
        });
      });
      transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      transactions = transactions.slice(0, 20);
    } catch (loanErr) {
      console.error('dashboard loan merge:', loanErr.message);
    }
    return res.json({
      success: true,
      message: 'Dashboard endpoint',
      unreadCount,
      transactions,
      user: req.user
        ? {
            id: req.user._id,
            _id: req.user._id,
            first_name: req.user.first_name,
            last_name: req.user.last_name,
            name: req.user.name,
            username: req.user.username,
            email: req.user.email,
            image: req.user.image,
            balance: req.user.balance,
            account_no: req.user.account_no,
            account_tier: req.user.account_tier || 'Tier 1',
            verificationStatus: req.user.verificationStatus,
            phone: req.user.phone,
            country: req.user.country,
          }
        : null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Dashboard failed' });
  }
});



// ---------- Deposits ----------
const CRYPTO_ADDRESSES = {
  Bitcoin: process.env.CRYPTO_BTC_ADDRESS || 'bc1qjgpnpy95wdwek8sqzof07mcsdsh0s7szawq',
  Ethereum: process.env.CRYPTO_ETH_ADDRESS || '0x0000000000000000000000000000000000000000',
  USDT: process.env.CRYPTO_USDT_ADDRESS || '0x0000000000000000000000000000000000000000',
};

router.get('/deposit/addresses', async (req, res) => {
  try {
    const wallets = await CryptoWallet.find({ is_active: true }).sort({ sort_order: 1, name: 1 }).lean();
    if (wallets.length) {
      const addresses = {};
      const options = wallets.map((w) => {
        addresses[w.name] = w.address;
        return {
          id: w._id,
          name: w.name,
          symbol: w.symbol || '',
          network: w.network || '',
          address: w.address,
        };
      });
      return res.json({ success: true, addresses, options: options, wallets: options });
    }
    // fallback legacy env map
    return res.json({
      success: true,
      addresses: CRYPTO_ADDRESSES,
      options: Object.keys(CRYPTO_ADDRESSES).map((k) => ({
        name: k,
        symbol: k,
        network: '',
        address: CRYPTO_ADDRESSES[k],
      })),
      wallets: Object.keys(CRYPTO_ADDRESSES).map((k) => ({
        name: k,
        symbol: k,
        network: '',
        address: CRYPTO_ADDRESSES[k],
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load wallets' });
  }
});

router.get('/deposit/crypto', async (req, res) => {
  try {
    const list = await Deposit.find({ user_id: req.user._id, method: 'crypto' })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, deposits: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load deposits' });
  }
});

router.post('/deposit/crypto', async (req, res) => {
  try {
    const amount = Number((req.body || {}).amount);
    const crypto_type = String((req.body || {}).crypto_type || (req.body || {}).type || 'Bitcoin');
    let address = String((req.body || {}).address || '').trim();
    if (!address) {
      try {
        const w = await CryptoWallet.findOne({ name: crypto_type, is_active: true }).lean();
        if (w) address = w.address;
      } catch (_) {}
    }
    if (!address) address = String(CRYPTO_ADDRESSES[crypto_type] || '');
    let proof_url = String((req.body || {}).proof_url || '');

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid amount' });
    }

    // Optional proof upload (express-fileupload or multer-style)
    if (!proof_url && req.files && req.files.proof) {
      const file = req.files.proof;
      try {
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'swiftpurse/deposits' },
            (err, result) => (err ? reject(err) : resolve(result))
          );
          stream.end(file.data);
        });
        proof_url = uploaded.secure_url;
      } catch (e) {
        console.error('Deposit proof upload failed', e.message);
      }
    }

    const purpose = String((req.body || {}).purpose || 'deposit');
    const plan = String((req.body || {}).plan || '');
    const method = String((req.body || {}).method || 'crypto');
    const deposit = await Deposit.create({
      user_id: req.user._id,
      method,
      crypto_type,
      amount,
      address,
      proof_url,
      purpose,
      plan,
      status: 'pending',
    });

    const notifTitle = purpose === 'upgrade' ? 'Upgrade Submitted' : 'Deposit Submitted';
    const notifMsg = purpose === 'upgrade'
      ? `Your upgrade payment of $${amount} is under review`
      : `Your deposit of $${amount} is under review`;
    await Notification.create({
      user_id: req.user._id,
      type: 'deposit',
      title: notifTitle,
      message: notifMsg,
      icon: 'bell',
      action_url: '/user/notifications.html',
      data: { amount, crypto_type, depositId: deposit._id },
    });

    try {
      await sendPushToUser(req.user, {
        title: notifTitle,
        body: notifMsg,
        url: '/user/notifications.html',
        tag: 'deposit-submitted',
      });
    } catch (error) {
      console.error('Push notification failed:', error.message);
    }

    return res.json({
      success: true,
      message: 'Payment pending',
      deposit,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Deposit failed' });
  }
});

// Admin-style approve (optional internal) — also allow from admin later
router.post('/deposit/:id/approve', async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found' });
    if (String(deposit.status).toLowerCase() === 'approved') {
      return res.json({ success: true, message: 'Already approved', deposit });
    }
    deposit.status = 'approved';
    await deposit.save();

    const user = await User.findById(deposit.user_id);
    if (user) {
      user.balance = Number(user.balance || 0) + Number(deposit.amount || 0);
      user.account_bal = user.balance;
      await user.save();
      await Transaction.create({
        user_id: user._id,
        type: 'credit',
        title: 'CRYPTO DEPOSIT',
        amount: deposit.amount,
        status: 'Successful',
        description: `Crypto deposit approved (${deposit.crypto_type})`,
      });
      try {
        await sendPushToUser(user, {
          title: 'Deposit confirmed',
          body: `Your deposit of $${deposit.amount} has been successfully processed.`,
          url: '/user/dashboard.html',
          tag: 'deposit-confirmed',
        });
      } catch (error) {
        console.error('Push notification failed:', error.message);
      }
    }
    return res.json({ success: true, message: 'Deposit approved', deposit });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});



// ---------- Bank Transfer (Send) ----------
router.get('/transfers', async (req, res) => {
  try {
    const list = await Transfer.find({ user_id: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, transfers: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/transfer', async (req, res) => {
  try {
    const body = req.body || {};
    const bank = String(body.bank || '').trim();
    const swift = String(body.swift || '').trim();
    const currency = String(body.currency || 'USD').trim() || 'USD';
    const routing = String(body.routing || '').trim();
    const country = String(body.country || '').trim();
    const account_no = String(body.act_no || body.account_no || '').trim();
    const holder_name = String(body.act_hold_name || body.holder_name || '').trim();
    const amount = Number(body.amount);
    const note = String(body.note || '').trim();

    if (!bank || !account_no || !holder_name || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Please fill all required fields with a valid amount' });
    }

    const pin = String(body.pin || '').trim();
    if (pin && !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 4-digit PIN' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const storedPin = String(user.pin || user.transaction_pin || '').trim();
    if (storedPin && pin && storedPin !== pin) {
      return res.status(400).json({ success: false, message: 'Invalid PIN' });
    }
    if (storedPin && !pin) {
      return res.status(400).json({ success: false, message: 'Transaction PIN is required' });
    }

    // Do NOT deduct balance until Successful
    const service_charge = Math.round(amount * 0.1 * 100) / 100;
    const amount_received = Math.round((amount - service_charge) * 100) / 100;
    const txId = String(Math.floor(10000000000 + Math.random() * 90000000000));
    const tx = await Transfer.create({
      user_id: user._id,
      bank,
      swift,
      currency,
      routing,
      country,
      account_no,
      holder_name,
      amount,
      service_charge,
      amount_received,
      note,
      payment_method: 'Bank Transfer',
      status: 'In Progress',
      transaction_id: txId,
      meta: {
        pin_verified: Boolean(pin),
      },
    });

    // Mirror into Transaction so dashboard Recent Transactions shows it immediately
    await Transaction.create({
      user_id: user._id,
      type: 'transfer',
      title: 'Bank Transfer',
      amount,
      currency,
      status: 'In Progress',
      description: note || `Transfer to ${holder_name}`,
      meta: {
        transfer_id: tx._id,
        bank,
        account_no,
        holder_name,
        transaction_id: txId,
        payment_method: 'Bank Transfer',
      },
    });

    const notifTitle = 'Transfer initiated';
    const notifMsg = `Your Transfer of $${amount} is under review`;
    await Notification.create({
      user_id: user._id,
      type: 'transfer',
      title: notifTitle,
      message: notifMsg,
      icon: 'bell',
      action_url: '/user/notifications.html',
      data: { amount, transactionId: tx._id, txId },
    });

    try {
      await sendPushToUser(user, {
        title: notifTitle,
        body: notifMsg,
        url: '/user/notifications.html',
        tag: 'transfer-initiated',
      });
    } catch (error) {
      console.error('Push notification failed:', error.message);
    }

    const now = new Date();
    const datetime = now.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    try {
      await sendMail(
        user.email,
        'Bank Transfer Initiated – SwiftPurse Bank',
        transferEmailHtml({
          bank,
          swift,
          country,
          account_no,
          holder_name,
          amount,
          currency,
          datetime,
          balance: user.balance || 0,
          status: 'Processing',
          txId,
        })
      );
    } catch (e) {
      console.error('Transfer email failed:', e.message);
    }

    return res.json({
      success: true,
      message: 'Transfer Submitted',
      transfer: {
        _id: tx._id,
        bank: tx.bank,
        date: new Date(tx.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        name: tx.holder_name,
        payment_method: tx.payment_method || 'Bank Transfer',
        amount: Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        currency: tx.currency,
        status: tx.status,
        txId: tx.transaction_id,
      },
      summary: {
        bank,
        date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        name: holder_name,
        payment_method: 'Bank Transfer',
        amount,
        currency,
        status: 'In Progress',
        transaction_id: txId,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Transfer failed' });
  }
});



// ---------- Statements & receipt ----------
router.get('/statements', async (req, res) => {
  try {
    const [txs, transfers] = await Promise.all([
      Transaction.find({ user_id: req.user._id }).sort({ createdAt: -1 }).limit(100).lean(),
      Transfer.find({ user_id: req.user._id }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);

    // Prefer transfer records for bank transfers (avoid duplicates from mirrored Transaction)
    const transferIds = new Set(
      transfers.map((t) => String(t._id))
    );
    const items = [];

    transfers.forEach((t) => {
      items.push({
        id: String(t._id),
        source: 'transfer',
        title: 'Bank Transfer',
        type: 'transfer',
        amount: Number(t.amount || 0),
        currency: t.currency || 'USD',
        status: t.status || 'In Progress',
        createdAt: t.createdAt,
        bank: t.bank || '',
        holder_name: t.holder_name || '',
        account_no: t.account_no || '',
        country: t.country || '',
        transaction_id: t.transaction_id || String(t._id),
        payment_method: t.payment_method || 'Bank Transfer',
        is_debit: true,
      });
    });

    txs.forEach((t) => {
      const meta = t.meta || {};
      if (meta.transfer_id && transferIds.has(String(meta.transfer_id))) return; // skip mirror
      const isDebit = t.type === 'transfer' || t.type === 'debit' || t.type === 'withdrawal';
      const title = t.title || (isDebit ? 'Bank Transfer' : 'INWARD TRANSFER');
      items.push({
        id: String(t._id),
        source: 'transaction',
        title,
        type: t.type || 'credit',
        amount: Number(t.amount || 0),
        currency: t.currency || 'USD',
        status: t.status || 'Successful',
        createdAt: t.createdAt,
        bank: meta.bank || '',
        holder_name: meta.holder_name || meta.holder || '',
        account_no: meta.account_no || '',
        country: meta.country || '',
        transaction_id: meta.transaction_id || meta.txId || String(t._id),
        payment_method: meta.payment_method || (isDebit ? 'Bank Transfer' : (/loan/i.test(title) ? 'Loan Disbursement' : 'Inward Transfer')),
        is_debit: isDebit,
        description: t.description || '',
      });
    });

    // Backfill approved loans missing a Loan Disbursement transaction
    try {
      const Loan = require('../models/Loan');
      const loans = await Loan.find({
        user_id: req.user._id,
        status: { $in: ['active', 'repaying', 'completed'] },
        approved_at: { $ne: null },
      }).sort({ approved_at: -1 }).limit(50).lean();
      const existingLoanIds = new Set(
        items.filter((x) => x.meta && x.meta.loan_id).map((x) => String(x.meta.loan_id)).concat(
          items.filter((x) => /loan\s*disburse/i.test(String(x.title || ''))).map((x) => String(x.id))
        )
      );
      // also detect meta on original txs
      txs.forEach((t) => {
        if (t.meta && t.meta.loan_id) existingLoanIds.add(String(t.meta.loan_id));
      });
      loans.forEach((loan) => {
        const lid = String(loan._id);
        if (existingLoanIds.has(lid)) return;
        const already = items.some((it) => it.meta && String(it.meta.loan_id) === lid);
        if (already) return;
        const amt = Number(loan.approved_amount || loan.amount || 0);
        if (!amt) return;
        items.push({
          id: 'loan-' + lid,
          source: 'loan',
          title: 'Loan Disbursement',
          type: 'credit',
          amount: amt,
          currency: 'USD',
          status: 'Successful',
          createdAt: loan.approved_at || loan.createdAt,
          bank: '',
          holder_name: '',
          account_no: '',
          country: '',
          transaction_id: 'LN' + lid.slice(-8).toUpperCase(),
          payment_method: 'Loan Disbursement',
          is_debit: false,
          description: 'Loan approved and disbursed',
          meta: { loan_id: lid },
        });
      });
    } catch (loanErr) {
      console.error('statements loan merge:', loanErr.message);
    }

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ success: true, statements: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/statements/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let item = null;

    const transfer = await Transfer.findOne({ _id: id, user_id: req.user._id }).lean();
    if (transfer) {
      item = {
        id: String(transfer._id),
        source: 'transfer',
        title: 'Bank Transfer',
        type: 'transfer',
        amount: Number(transfer.amount || 0),
        currency: transfer.currency || 'USD',
        status: transfer.status || 'In Progress',
        createdAt: transfer.createdAt,
        bank: transfer.bank || '',
        holder_name: transfer.holder_name || '',
        account_no: transfer.account_no || '',
        country: transfer.country || '',
        transaction_id: transfer.transaction_id || String(transfer._id),
        payment_method: transfer.payment_method || 'Bank Transfer',
        is_debit: true,
      };
    } else {
      const tx = await Transaction.findOne({ _id: id, user_id: req.user._id }).lean();
      if (!tx) return res.status(404).json({ success: false, message: 'Statement not found' });
      const meta = tx.meta || {};
      const isDebit = tx.type === 'transfer' || tx.type === 'debit' || tx.type === 'withdrawal';
      item = {
        id: String(tx._id),
        source: 'transaction',
        title: tx.title || (isDebit ? 'Bank Transfer' : 'INWARD TRANSFER'),
        type: tx.type || 'credit',
        amount: Number(tx.amount || 0),
        currency: tx.currency || 'USD',
        status: tx.status || 'Successful',
        createdAt: tx.createdAt,
        bank: meta.bank || '',
        holder_name: meta.holder_name || meta.holder || '',
        account_no: meta.account_no || '',
        country: meta.country || '',
        transaction_id: meta.transaction_id || meta.txId || String(tx._id),
        payment_method: meta.payment_method || (isDebit ? 'Bank Transfer' : 'Inward Transfer'),
        is_debit: isDebit,
      };
    }
    return res.json({ success: true, statement: item });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});



// ---------- Profile ----------
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({
      success: true,
      user: {
        _id: user._id,
        first_name: user.first_name,
        last_name: user.last_name,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone || '',
        gender: user.gender || '',
        country: user.country || '',
        dob: user.dob || '',
        marital_status: user.marital_status || '',
        home_address: user.home_address || '',
        next_of_kin: user.next_of_kin || '',
        account_no: user.account_no || '',
        image: user.image || '',
        account_tier: user.account_tier || 'Tier 1',
        verificationStatus: user.verificationStatus,
        balance: user.balance,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load profile' });
  }
});

router.post('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const body = req.body || {};

    if (body.fullname || body.name) {
      const full = String(body.fullname || body.name || '').trim();
      if (full) {
        const parts = full.split(/\s+/);
        user.first_name = parts[0] || user.first_name;
        user.last_name = parts.slice(1).join(' ') || user.last_name || '';
        user.name = full;
      }
    }
    if (body.phone !== undefined) user.phone = String(body.phone || '').trim();
    if (body.gender !== undefined) {
      const g = String(body.gender || '').trim();
      user.gender = ['Female', 'Male', 'Others', ''].includes(g) ? g : (g || '');
    }
    if (body.dob !== undefined) user.dob = String(body.dob || '').trim();
    if (body.country !== undefined) user.country = String(body.country || '').trim();
    if (body.marital_status !== undefined) user.marital_status = String(body.marital_status || '').trim();
    if (body.home_address !== undefined) user.home_address = String(body.home_address || '').trim();
    if (body.next_of_kin !== undefined) user.next_of_kin = String(body.next_of_kin || '').trim();

    await user.save();
    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        first_name: user.first_name,
        last_name: user.last_name,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        country: user.country,
        dob: user.dob,
        marital_status: user.marital_status,
        home_address: user.home_address,
        next_of_kin: user.next_of_kin,
        account_no: user.account_no,
        image: user.image,
        account_tier: user.account_tier,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Update failed' });
  }
});

router.post('/profile/photo', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let fileBuffer = null;
    if (req.files && req.files.profilePic) {
      const f = req.files.profilePic;
      fileBuffer = f.data || f.buffer;
    } else if (req.file && req.file.buffer) {
      fileBuffer = req.file.buffer;
    } else if (req.body && req.body.imageBase64) {
      const raw = String(req.body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      fileBuffer = Buffer.from(raw, 'base64');
    }

    if (!fileBuffer) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }

    const result = await uploadToCloudinary(fileBuffer, 'swiftpurse/profile');
    user.image = result.secure_url || result.url || '';
    await user.save();

    return res.json({
      success: true,
      message: 'Profile picture updated successfully',
      image: user.image,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Photo upload failed' });
  }
});



// ---------- Settings (email / passcode / pin) ----------
const pinResetStore = new Map();

function pinResetEmailHtml(resetLink) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eff1ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eff1ff;padding:24px 12px">
<tr><td align="center">
<table width="590" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="padding:28px 24px;text-align:center;background:#eff1ff">
<img src="https://swiftpursebank.com/i/logo.png" alt="SwiftPurse Bank" width="180">
</td></tr>
<tr><td style="padding:20px 30px">
<p style="font-size:18px">Hi there,</p>
<p style="font-size:16px;line-height:1.5">We received a request to reset your PIN. If you initiated this request, please click the link below to proceed:</p>
<p style="text-align:center;margin:28px 0">
<a href="${resetLink}" style="display:inline-block;background:#19202F;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700">Reset Your PIN</a>
</p>
<p style="font-size:14px;color:#666">For security purposes, this link will expire in 5 minutes and can only be used once. If you did not request a PIN reset, please disregard this email or contact our support team immediately.</p>
<p style="font-size:16px">Best Regards,<br><br>The SwiftPurse Bank Team</p>
</td></tr>
<tr><td style="padding:20px 30px;border-top:1px solid #e3e3e3;color:#979797;font-size:12px">
<p>2026 SwiftPurse Bank. All rights reserved.</p>
<p>UK banking services offered by SwiftPurse Bank (RC796975) with registered address at Head office: 21 Lombard St, city of london,London Ec3v 9AH , UK. Clients' money is safeguarded with reputable UK and EU banks. Financial Services Compensation Scheme (FSCS) does not apply.</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

router.post('/settings/email', async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }
    const exists = await User.findOne({ email, _id: { $ne: req.user._id } });
    if (exists) return res.status(409).json({ success: false, message: 'Email already in use' });
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.email = email;
    await user.save();
    return res.json({ success: true, message: 'Email updated successfully', email: user.email });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Update failed' });
  }
});

router.post('/settings/passcode', async (req, res) => {
  try {
    const body = req.body || {};
    const current = String(body.current_passcode || body.current || '').trim();
    const next = String(body.new_passcode || body.password || '').trim();
    const confirm = String(body.confirm_passcode || body.confirm || '').trim();
    if (!current || !next || !confirm) {
      return res.status(400).json({ success: false, message: 'All passcode fields are required' });
    }
    if (next.length < 6) {
      return res.status(400).json({ success: false, message: 'New passcode must be at least 6 characters' });
    }
    if (next !== confirm) {
      return res.status(400).json({ success: false, message: 'Passcodes do not match' });
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const ok = await user.comparePassword(current);
    if (!ok) return res.status(400).json({ success: false, message: 'Current passcode is incorrect' });
    user.password = next;
    await user.save();
    return res.json({ success: true, message: 'Passcode updated successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Update failed' });
  }
});

router.post('/settings/pin', async (req, res) => {
  try {
    const body = req.body || {};
    const current = String(body.current_pin || '').trim();
    const next = String(body.new_pin || '').trim();
    const confirm = String(body.confirm_pin || '').trim();
    if (!/^\d{4}$/.test(next)) {
      return res.status(400).json({ success: false, message: 'New PIN must be 4 digits' });
    }
    if (next !== confirm) {
      return res.status(400).json({ success: false, message: 'PINs do not match' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const stored = String(user.pin || user.transaction_pin || '').trim();
    if (stored && stored !== current) {
      return res.status(400).json({ success: false, message: 'Current PIN is incorrect' });
    }
    user.pin = next;
    user.transaction_pin = next;
    await user.save();
    return res.json({ success: true, message: 'PIN updated successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Update failed' });
  }
});

router.post('/settings/reset-pin', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const crypto = require('crypto');
    const token = crypto.randomBytes(24).toString('hex');
    const expires = Date.now() + 5 * 60 * 1000;
    pinResetStore.set(token, { userId: String(user._id), email: user.email, expires });
    user.pinResetToken = token;
    user.pinResetExpires = new Date(expires);
    await user.save({ validateBeforeSave: false });

    const link = `${frontendUrl()}/user/resetpin.html?token=${token}&email=${encodeURIComponent(user.email)}`;
    try {
      await sendMail(user.email, 'Reset Your PIN – SwiftPurse Bank', pinResetEmailHtml(link));
    } catch (e) {
      console.error('PIN reset email failed:', e.message);
    }
    return res.json({ success: true, message: 'PIN reset link sent to your email' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Request failed' });
  }
});

// Public: complete PIN reset via email link (no session required)
router.post('/reset-pin', async (req, res) => {
  try {
    const body = req.body || {};
    const token = String(body.token || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const pin = String(body.pin || body.new_pin || '').trim();
    const confirm = String(body.confirm_pin || body.confirm || pin).trim();
    if (!token) return res.status(400).json({ success: false, message: 'Invalid or missing reset token' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ success: false, message: 'PIN must be 4 digits' });
    if (pin !== confirm) return res.status(400).json({ success: false, message: 'PINs do not match' });

    let user = null;
    const mem = pinResetStore.get(token);
    if (mem && Date.now() <= mem.expires) {
      user = await User.findById(mem.userId);
    }
    if (!user) {
      user = await User.findOne({
        email: email || undefined,
        pinResetToken: token,
        pinResetExpires: { $gt: new Date() },
      });
    }
    if (!user && email) {
      user = await User.findOne({ email, pinResetToken: token, pinResetExpires: { $gt: new Date() } });
    }
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });

    user.pin = pin;
    user.transaction_pin = pin;
    user.pinResetToken = undefined;
    user.pinResetExpires = undefined;
    await user.save();
    pinResetStore.delete(token);
    return res.json({ success: true, message: 'PIN reset successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Reset failed' });
  }
});



// ---------- Cards (user) ----------
router.get('/cards', async (req, res) => {
  try {
    const cards = await Card.find({ user_id: req.user._id })
      .populate('card_type_id')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, cards });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/card-types', async (req, res) => {
  try {
    const cardTypes = await CardType.find({ is_active: true }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, cardTypes });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cards', async (req, res) => {
  try {
    const body = req.body || {};
    const typeId = body.card_type_id || body.cardTypeId;
    const t = await CardType.findOne({ _id: typeId, is_active: true });
    if (!t) return res.status(404).json({ success: false, message: 'Card type is unavailable.' });

    const existing = await Card.findOne({
      user_id: req.user._id,
      card_type_id: t._id,
      status: { $in: ['pending', 'active', 'frozen'] },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You already have an active or pending card of this type.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const holder = String(body.card_holder || user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || '').trim();
    const c = await Card.create({
      user_id: user._id,
      card_type_id: t._id,
      card_holder: holder,
      shipping_address: body.shipping_address || body.address || null,
      status: 'pending',
    });

    try {
      await Notification.create({
        user_id: user._id,
        type: 'account',
        title: 'Card Application Submitted',
        message: `Your application for a ${t.name} has been submitted and is pending review.`,
        icon: 'bell',
        action_url: '/user/notifications.html',
        data: { cardId: c._id },
      });
    } catch (_) {}

    try {
      const { sendPushToUser } = require('../utils/pushNotifications');
      await sendPushToUser(user, {
        title: 'Card Application Submitted',
        body: `Your application for a ${t.name} has been submitted and is pending review.`,
        url: '/user/credit-card.html',
        tag: 'card-application',
      });
    } catch (error) {
      console.error('Push notification failed:', error.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Card application submitted. Pending review.',
      card: c,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Application failed' });
  }
});

router.get('/cards/:id', async (req, res) => {
  try {
    const c = await Card.findOne({ _id: req.params.id, user_id: req.user._id })
      .populate('card_type_id')
      .lean();
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    return res.json({ success: true, card: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


function featureNum(v, fallback) {
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return fallback !== undefined ? Number(fallback) || 0 : 0;
}

function loanBuildSchedule(amount, months, annualRate, interestType) {
  const n = Math.max(1, Math.floor(months));
  const principal = featureNum(amount);
  const r = featureNum(annualRate) / 100;
  const schedule = [];
  let totalInterest = 0;
  if (String(interestType).toLowerCase() === 'compound') {
    const monthlyRate = r / 12;
    const payment =
      monthlyRate === 0
        ? principal / n
        : (principal * monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
    let balance = principal;
    for (let i = 1; i <= n; i++) {
      const interest = balance * monthlyRate;
      let prin = payment - interest;
      if (i === n) prin = balance;
      const total = prin + interest;
      totalInterest += interest;
      balance = Math.max(0, balance - prin);
      const due = new Date();
      due.setMonth(due.getMonth() + i);
      schedule.push({
        due_date: due,
        principal: Math.round(prin * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        total: Math.round(total * 100) / 100,
        late_fee: 0,
        status: 'upcoming',
      });
    }
  } else {
    const totalInterestAll = principal * r * (n / 12);
    const interestPer = totalInterestAll / n;
    const prinPer = principal / n;
    totalInterest = totalInterestAll;
    for (let i = 1; i <= n; i++) {
      const due = new Date();
      due.setMonth(due.getMonth() + i);
      schedule.push({
        due_date: due,
        principal: Math.round(prinPer * 100) / 100,
        interest: Math.round(interestPer * 100) / 100,
        total: Math.round((prinPer + interestPer) * 100) / 100,
        late_fee: 0,
        status: 'upcoming',
      });
    }
  }
  const totalRepayable = schedule.reduce((s, x) => s + featureNum(x.total), 0);
  return { schedule, totalInterest, totalRepayable };
}


// ---------- Loans (user) ----------
router.get('/loan-plans', async (req, res) => {
  try {
    const plans = await LoanPlan.find({ is_active: true, status: 'Active' }).sort({ createdAt: -1 }).lean();
    const u = await User.findById(req.user._id).lean();
    const bal = featureNum(u && (u.balance ?? u.account_bal));
    return res.json({ success: true, plans, balance: bal });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/loans/preview', async (req, res) => {
  try {
    const plan = await LoanPlan.findById(req.body.plan_id).lean();
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    const amount = featureNum(req.body.amount);
    const months = featureNum(req.body.duration_months, plan.min_duration);
    const fee = amount * (featureNum(plan.processing_fee) / 100);
    const built = loanBuildSchedule(amount, months, plan.interest_rate, plan.interest_type);
    const u = await User.findById(req.user._id).lean();
    return res.json({
      success: true,
      preview: {
        amount,
        months,
        fee: Math.round(fee * 100) / 100,
        interest: Math.round(built.totalInterest * 100) / 100,
        total_repayable: Math.round((built.totalRepayable + fee) * 100) / 100,
        schedule: built.schedule,
      },
      balance: featureNum(u && (u.balance ?? u.account_bal)),
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/loans/apply', async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    if (!u) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const b = req.body || {};
    const plan = await LoanPlan.findOne({ _id: b.plan_id, is_active: true, status: 'Active' });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    const amount = featureNum(b.amount);
    const months = Math.floor(featureNum(b.duration_months, plan.min_duration));
    if (amount < featureNum(plan.min_amount) || amount > featureNum(plan.max_amount)) {
      return res.status(422).json({
        success: false,
        message: `Amount must be between $${featureNum(plan.min_amount)} and $${featureNum(plan.max_amount)}.`,
      });
    }
    if (months < featureNum(plan.min_duration) || months > featureNum(plan.max_duration)) {
      return res.status(422).json({
        success: false,
        message: `Duration must be between ${plan.min_duration} and ${plan.max_duration} months.`,
      });
    }
    const bal = featureNum(u.balance ?? u.account_bal);
    if (bal < featureNum(plan.min_account_balance)) {
      return res.status(422).json({
        success: false,
        message: `Minimum account balance of $${featureNum(plan.min_account_balance)} required.`,
      });
    }
    const activeCount = await Loan.countDocuments({
      user_id: u._id,
      plan_id: plan._id,
      status: { $in: ['pending', 'active', 'repaying'] },
    });
    if (activeCount >= featureNum(plan.max_active_loans, 1)) {
      return res.status(422).json({ success: false, message: 'Maximum active loans of this type reached.' });
    }
    const fee = Math.round(amount * (featureNum(plan.processing_fee) / 100) * 100) / 100;
    const loan = await Loan.create({
      user_id: u._id,
      plan_id: plan._id,
      amount,
      duration_months: months,
      purpose: String(b.purpose || '').trim(),
      monthly_income: featureNum(b.monthly_income),
      interest_rate: featureNum(plan.interest_rate),
      interest_type: plan.interest_type,
      processing_fee: fee,
      status: 'pending',
      applied_at: new Date(),
    });
    try {
      await Notification.create({
        user_id: u._id,
        type: 'loan',
        title: 'Loan Application Submitted',
        message: `Your loan application for $${amount.toFixed(2)} is pending review.`,
        icon: 'bell',
        action_url: '/user/loan.html',
        data: { loanId: loan._id },
      });
    } catch (_) {}
    try {
      const { sendPushToUser } = require('../utils/pushNotifications');
      await sendPushToUser(u, {
        title: 'Loan Application Submitted',
        body: `Your loan application for $${amount.toFixed(2)} is pending review.`,
        url: '/user/loan.html',
        tag: 'loan-apply',
      });
    } catch (_) {}
    return res.json({ success: true, message: 'Loan application submitted successfully.', loan });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/loans', async (req, res) => {
  try {
    const loans = await Loan.find({ user_id: req.user._id }).populate('plan_id').sort({ createdAt: -1 }).lean();
    const active = loans.filter((x) => ['active', 'repaying'].includes(x.status));
    const pending = loans.filter((x) => x.status === 'pending');
    const totalBorrowed = loans
      .filter((x) => ['active', 'repaying', 'completed', 'defaulted'].includes(x.status))
      .reduce((s, x) => s + featureNum(x.approved_amount || x.amount), 0);
    const totalRepaid = loans.reduce((s, x) => s + featureNum(x.total_repaid), 0);
    return res.json({
      success: true,
      loans,
      stats: { active: active.length, pending: pending.length, totalBorrowed, totalRepaid },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/loans/:id', async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    const loan = await Loan.findOne({ _id: req.params.id, user_id: req.user._id }).populate('plan_id').lean();
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found.' });
    const now = Date.now();
    if (Array.isArray(loan.schedule)) {
      loan.schedule = loan.schedule.map((item) => {
        if (item.status === 'upcoming' && item.due_date && new Date(item.due_date).getTime() < now) {
          return { ...item, status: 'overdue' };
        }
        return item;
      });
    }
    const total = featureNum(loan.total_repayable);
    const paid = featureNum(loan.total_repaid);
    const remaining = Math.max(0, total - paid);
    const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
    const next = (loan.schedule || []).find((x) => x.status === 'upcoming' || x.status === 'overdue');
    return res.json({
      success: true,
      loan,
      progress: { paid, remaining, total, pct },
      nextPayment: next || null,
      balance: featureNum(u && (u.balance ?? u.account_bal)),
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/loans/:id/repay', async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    if (!u) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const loan = await Loan.findOne({ _id: req.params.id, user_id: u._id });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found.' });
    if (!['active', 'repaying'].includes(loan.status)) {
      return res.status(422).json({ success: false, message: 'Loan is not repayable.' });
    }
    const scheduleId = req.body.schedule_id;
    const amount = featureNum(req.body.amount);
    let item = null;
    let idx = -1;
    if (scheduleId != null && scheduleId !== '') {
      idx = loan.schedule.findIndex(
        (s, i) =>
          String(s._id) === String(scheduleId) ||
          String(i + 1) === String(scheduleId) ||
          String(i) === String(scheduleId)
      );
      if (idx >= 0) item = loan.schedule[idx];
    }
    if (!item) {
      idx = loan.schedule.findIndex((s) => s.status === 'upcoming' || s.status === 'overdue');
      if (idx >= 0) item = loan.schedule[idx];
    }
    if (!item) return res.status(422).json({ success: false, message: 'No payable installment found.' });
    const due = amount > 0 ? amount : featureNum(item.total) + featureNum(item.late_fee);
    if (due <= 0) return res.status(422).json({ success: false, message: 'Invalid amount.' });
    const bal = featureNum(u.balance ?? u.account_bal);
    if (bal < due) return res.status(422).json({ success: false, message: 'Insufficient account balance.' });
    u.balance = bal - due;
    u.account_bal = u.balance;
    await u.save();
    item.status = 'paid';
    item.paid_at = new Date();
    item.paid_amount = due;
    loan.markModified('schedule');
    loan.total_repaid = featureNum(loan.total_repaid) + due;
    if (loan.status === 'active') loan.status = 'repaying';
    if (loan.schedule.every((s) => s.status === 'paid')) loan.status = 'completed';
    await loan.save();
    try {
      await Notification.create({
        user_id: u._id,
        type: 'loan',
        title: 'Loan Repayment Recorded',
        message: `Payment of $${due.toFixed(2)} recorded successfully.`,
        icon: 'bell',
        action_url: '/user/loan.html',
        data: { loanId: loan._id },
      });
    } catch (_) {}
    try {
      const { sendPushToUser } = require('../utils/pushNotifications');
      await sendPushToUser(u, {
        title: 'Loan Repayment Recorded',
        body: `Payment of $${due.toFixed(2)} recorded successfully.`,
        url: '/user/loan.html',
        tag: 'loan-repay',
      });
    } catch (_) {}
    return res.json({ success: true, message: `Payment of $${due.toFixed(2)} recorded successfully.`, loan });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
