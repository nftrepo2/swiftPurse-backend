const crypto = require('crypto');
const router = require('express').Router();
const User = require('../models/user.model');
const Deposit = require('../models/Deposit');
const CryptoWallet = require('../models/CryptoWallet');
const Verify = require('../models/verifySchema');
const Notification = require('../models/Notification');
const Transaction = require('../models/Transaction');
const Transfer = require('../models/Transfer');
const Card = require('../models/Card');
const Loan = require('../models/Loan');
const LoanPlan = require('../models/LoanPlan');
const CardType = require('../models/CardType');
const CardTransaction = require('../models/CardTransaction');
const { sendPushToUser } = require('../utils/pushNotifications');

const frontendUrl = () => String(process.env.FRONTEND_URL || '').replace(/\/$/, '');

function safeUser(u) {
  return {
    _id: u._id,
    id: u._id,
    first_name: u.first_name,
    last_name: u.last_name,
    name: u.name || [u.first_name, u.last_name].filter(Boolean).join(' '),
    username: u.username,
    email: u.email,
    phone: u.phone || '',
    country: u.country || '',
    image: u.image || '',
    role: u.role,
    balance: u.balance || 0,
    account_no: u.account_no || '',
    verificationStatus: u.verificationStatus || 'not_verified',
    isVerified: u.isVerified,
    account_verify: u.account_verify,
    isBlocked: Boolean(u.isBlocked),
    account_tier: u.account_tier || 'Tier 1',
    createdAt: u.createdAt,
  };
}

// GET all users
router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.search || '').trim();
    const filter = { role: { $ne: 'ADMIN' } };
    if (q) {
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { username: new RegExp(q, 'i') },
        { first_name: new RegExp(q, 'i') },
        { last_name: new RegExp(q, 'i') },
        { phone: new RegExp(q, 'i') },
      ];
    }
    const users = await User.find(filter)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 });
    return res.json({ success: true, users: users.map(safeUser), count: users.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// GET single user
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Notify users
router.post('/notify', async (req, res) => {
  try {
    const { title, message, userIds, all } = req.body || {};
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }
    let users = [];
    if (all) {
      users = await User.find({ role: { $ne: 'ADMIN' } });
    } else {
      const ids = Array.isArray(userIds) ? userIds : userIds ? [userIds] : [];
      if (!ids.length) return res.status(400).json({ success: false, message: 'Select at least one user' });
      users = await User.find({ _id: { $in: ids } });
    }
    if (!users.length) return res.status(404).json({ success: false, message: 'No users found' });

    const actionUrl = '/user/notifications.html';
    for (const user of users) {
      await Notification.create({
        user_id: user._id,
        type: 'admin',
        title: String(title),
        message: String(message),
        icon: 'bell',
        action_url: actionUrl,
        data: { title, message },
      });
      try {
        await sendPushToUser(user, {
          title: String(title),
          body: String(message),
          url: actionUrl,
          tag: 'admin-notify',
        });
      } catch (error) {
        console.error('Push notification failed:', error.message);
      }
    }

    const msg = users.length > 1 ? "The users have been notified" : 'User notified';
    return res.json({ success: true, message: msg, count: users.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Notify failed' });
  }
});

// Fund / debit user
router.post('/fund', async (req, res) => {
  try {
    const { userId, amount, creditType, account_tier } = req.body || {};
    const amt = Number(amount);
    if (!userId) return res.status(400).json({ success: false, message: 'Select a user' });
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Enter a valid amount' });
    const type = String(creditType || 'credit').toLowerCase() === 'debit' ? 'debit' : 'credit';

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (type === 'debit' && Number(user.balance || 0) < amt) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    if (type === 'credit') {
      user.balance = Number(user.balance || 0) + amt;
      user.account_bal = user.balance;
    } else {
      user.balance = Math.max(0, Number(user.balance || 0) - amt);
      user.account_bal = user.balance;
    }
    if (account_tier) user.account_tier = account_tier === '2' || account_tier === 'Tier 2' ? 'Tier 2' : 'Tier 1';
    await user.save();

    const title = 'INWARD TRANSFER';
    const status = type === 'credit' ? 'Successful' : 'In Progress';
    await Transaction.create({
      user_id: user._id,
      type,
      title,
      amount: amt,
      status,
      description: type === 'credit' ? `Account credited $${amt}` : `Account debited $${amt}`,
      meta: { byAdmin: req.user?._id },
    });

    const notifTitle = type === 'credit' ? 'Account credited' : 'Account Debited';
    const notifMsg =
      type === 'credit'
        ? `Your account has been credited $${amt}`
        : `Your account has been debited $${amt}`;
    const actionUrl = '/user/notifications.html';

    await Notification.create({
      user_id: user._id,
      type: 'account',
      title: notifTitle,
      message: notifMsg,
      icon: 'bell',
      action_url: actionUrl,
      data: { amount: amt, creditType: type },
    });

    try {
      await sendPushToUser(user, {
        title: notifTitle,
        body: notifMsg,
        url: actionUrl,
        tag: type === 'credit' ? 'account-credited' : 'account-debited',
      });
    } catch (error) {
      console.error('Push notification failed:', error.message);
    }

    const okMsg =
      type === 'credit' ? 'User account funded successfully' : 'User account debited successfully';
    return res.json({ success: true, message: okMsg, user: safeUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Fund failed' });
  }
});

// Block / unblock
router.post('/users/:id/block', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isBlocked = true;
    await user.save();
    return res.json({ success: true, message: 'User blocked successfully', user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/users/:id/unblock', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isBlocked = false;
    await user.save();
    return res.json({ success: true, message: 'User unblocked successfully', user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Toggle verification approve / revoke
router.post('/users/:id/verify', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const approve = req.body && (req.body.approve === true || req.body.approve === 'true' || req.body.approve === 1);
    if (approve) {
      user.verificationStatus = 'verified';
      user.isVerified = true;
      user.account_verify = 'Verified';
      await user.save();
      return res.json({ success: true, message: 'User account has been approved', user: safeUser(user) });
    }
    user.verificationStatus = 'pending';
    user.isVerified = false;
    user.account_verify = 'Pending';
    await user.save();
    return res.json({ success: true, message: 'Verification has been revoked', user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});



// ---------- Deposits (admin) ----------
router.get('/deposits', async (req, res) => {
  try {
    const list = await Deposit.find({})
      .sort({ createdAt: -1 })
      .populate('user_id', 'first_name last_name name email username')
      .lean();
    const deposits = list.map((d) => {
      const u = d.user_id || {};
      const fullName = u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || '—';
      return {
        _id: d._id,
        user_id: u._id || d.user_id,
        full_name: fullName,
        email: u.email || '',
        method: d.method,
        crypto_type: d.crypto_type,
        amount: d.amount,
        address: d.address,
        proof_url: d.proof_url,
        status: d.status,
        createdAt: d.createdAt,
      };
    });
    return res.json({ success: true, deposits, count: deposits.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load deposits' });
  }
});

router.post('/deposits/:id/approve', async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found' });
    if (String(deposit.status).toLowerCase() === 'approved') {
      return res.json({ success: true, message: 'Deposit already approved', deposit });
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
        description: `Crypto deposit approved (${deposit.crypto_type || 'crypto'})`,
      });
      const notifTitle = 'Deposit Approved';
      const notifMsg = `Your deposit of $${deposit.amount} has been approved and credited to your account.`;
      await Notification.create({
        user_id: user._id,
        type: 'deposit',
        title: notifTitle,
        message: notifMsg,
        icon: 'bell',
        action_url: '/user/notifications.html',
        data: { amount: deposit.amount, depositId: deposit._id },
      });
      try {
        await sendPushToUser(user, {
          title: notifTitle,
          body: notifMsg,
          url: '/user/notifications.html',
          tag: 'deposit-approved',
        });
      } catch (error) {
        console.error('Push notification failed:', error.message);
      }
    }
    return res.json({ success: true, message: 'Deposit approved successfully', deposit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Approve failed' });
  }
});

router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found' });
    deposit.status = 'rejected';
    await deposit.save();

    const user = await User.findById(deposit.user_id);
    if (user) {
      const notifTitle = 'Deposit Rejected';
      const notifMsg = `Your deposit of $${deposit.amount} was rejected. Contact support if you need help.`;
      await Notification.create({
        user_id: user._id,
        type: 'deposit',
        title: notifTitle,
        message: notifMsg,
        icon: 'bell',
        action_url: '/user/notifications.html',
        data: { amount: deposit.amount, depositId: deposit._id },
      });
      try {
        await sendPushToUser(user, {
          title: notifTitle,
          body: notifMsg,
          url: '/user/notifications.html',
          tag: 'deposit-rejected',
        });
      } catch (error) {
        console.error('Push notification failed:', error.message);
      }
    }
    return res.json({ success: true, message: 'Deposit rejected successfully', deposit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Reject failed' });
  }
});

router.delete('/deposits/:id', async (req, res) => {
  try {
    const deposit = await Deposit.findByIdAndDelete(req.params.id);
    if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found' });
    return res.json({ success: true, message: 'Deposit deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Delete failed' });
  }
});



// ---------- Verifications (admin) ----------
router.get('/verifications', async (req, res) => {
  try {
    const list = await Verify.find({})
      .sort({ createdAt: -1 })
      .populate('user user_id', 'first_name last_name name email username image phone country')
      .lean();

    const verifications = list.map((v) => {
      const u = v.user || v.user_id || {};
      const fullName = u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || '—';
      const front = v.frontimg || v.idcardFront || '';
      const back = v.backimg || v.idcardBack || '';
      const photo = u.image || v.photo || '';
      return {
        _id: v._id,
        user_id: u._id || v.user || v.user_id,
        full_name: fullName,
        email: u.email || '',
        document_type: v.document_type || '',
        status: v.status || 'pending',
        frontimg: front,
        backimg: back,
        photo: photo,
        message: v.message || '',
        subject: v.subject || '',
        createdAt: v.createdAt || v.submittedAt,
      };
    });
    return res.json({ success: true, verifications, count: verifications.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load verifications' });
  }
});

router.delete('/verifications/:id', async (req, res) => {
  try {
    const doc = await Verify.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Verification not found' });
    return res.json({ success: true, message: 'Verification deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Delete failed' });
  }
});



// ---------- Transfers (admin complete) ----------
router.get('/transfers', async (req, res) => {
  try {
    const list = await Transfer.find({})
      .sort({ createdAt: -1 })
      .populate('user_id', 'first_name last_name name email username')
      .lean();
    return res.json({ success: true, transfers: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/transfers/:id/approve', async (req, res) => {
  try {
    const tx = await Transfer.findById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Transfer not found' });
    if (String(tx.status) === 'Successful') {
      return res.json({ success: true, message: 'Already successful', transfer: tx });
    }
    const user = await User.findById(tx.user_id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const bal = Number(user.balance || user.account_bal || 0);
    const amt = Number(tx.amount || 0);
    if (bal < amt) {
      return res.status(400).json({ success: false, message: 'Insufficient user balance to complete transfer' });
    }
    user.balance = bal - amt;
    user.account_bal = user.balance;
    await user.save();
    tx.status = 'Successful';
    await tx.save();

    // Update mirrored Transaction (or create if missing) for dashboard history
    let hist = await Transaction.findOne({ 'meta.transfer_id': tx._id });
    if (hist) {
      hist.status = 'Successful';
      hist.amount = amt;
      await hist.save();
    } else {
      await Transaction.create({
        user_id: user._id,
        type: 'transfer',
        title: 'Bank Transfer',
        amount: amt,
        currency: tx.currency || 'USD',
        status: 'Successful',
        description: tx.note || `Transfer to ${tx.holder_name}`,
        meta: {
          transfer_id: tx._id,
          bank: tx.bank,
          account_no: tx.account_no,
          holder_name: tx.holder_name,
          transaction_id: tx.transaction_id,
        },
      });
    }

    const notifTitle = 'Transfer Successful';
    const notifMsg = `Your transfer of $${amt} was successful. Your new balance is $${user.balance}.`;
    await Notification.create({
      user_id: user._id,
      type: 'transfer',
      title: notifTitle,
      message: notifMsg,
      icon: 'bell',
      action_url: '/user/notifications.html',
      data: { amount: amt, transferId: tx._id },
    });
    try {
      const { sendPushToUser } = require('../utils/pushNotifications');
      await sendPushToUser(user, {
        title: notifTitle,
        body: notifMsg,
        url: '/user/notifications.html',
        tag: 'transfer-success',
      });
    } catch (error) {
      console.error('Push notification failed:', error.message);
    }

    // Success email via Bird (same as auth.route.js)
    try {
      const BIRD_API_KEY = process.env.BIRD_API_KEY || '';
      if (BIRD_API_KEY) {
        const FROM_EMAIL = process.env.FROM_EMAIL || 'support@swiftpursebank.com';
        const FROM_NAME = process.env.FROM_NAME || 'SwiftPurse Bank';
        const key = String(BIRD_API_KEY);
        const base = (key.includes('_us1_') || key.startsWith('bk_eu1')) ? 'https://us1.platform.bird.com' : 'https://us1.platform.bird.com';
        const fmtAmt = Number(amt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const html = `<!DOCTYPE html><html><body style="margin:0;background:#eff1ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eff1ff;padding:24px 12px"><tr><td align="center">
<table width="590" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px">
<tr><td style="padding:28px 24px;text-align:center;background:#eff1ff"><img src="https://swiftpursebank.com/i/logo.png" width="180" alt="SwiftPurse Bank"></td></tr>
<tr><td style="padding:20px 30px">
<p style="font-size:18px">Your bank transfer of ${fmtAmt} ${tx.currency || 'USD'} to ${tx.holder_name || ''} was successful.</p>
<p style="font-size:16px">Current Account Balance: ${Number(user.balance).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
<p style="font-size:16px">Transaction Status: <span style="color:green">Successful</span></p>
<p style="font-size:16px">Transaction ID: ${tx.transaction_id || tx._id}</p>
<p style="font-size:16px">Love,<br><br>The SwiftPurse Bank Team</p>
</td></tr></table></td></tr></table></body></html>`;
        await fetch(base + '/v1/email/messages', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + BIRD_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            from: { email: FROM_EMAIL, name: FROM_NAME },
            to: [user.email],
            subject: 'Bank Transfer Successful – SwiftPurse Bank',
            html,
            category: 'transactional',
          }),
        });
      }
    } catch (e) {
      console.error('Success transfer email failed', e.message);
    }

    return res.json({ success: true, message: 'Transfer completed successfully', transfer: tx, balance: user.balance });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
});



router.post('/transfers/:id/reject', async (req, res) => {
  try {
    const tx = await Transfer.findById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Transfer not found' });
    tx.status = 'Rejected';
    await tx.save();

    // Mirror status on Transaction history if present
    try {
      const hist = await Transaction.findOne({ 'meta.transfer_id': tx._id });
      if (hist) {
        hist.status = 'Failed';
        await hist.save();
      }
    } catch (_) {}

    const user = await User.findById(tx.user_id);
    if (user) {
      const amt = Number(tx.amount || 0);
      const notifTitle = 'Transfer Rejected';
      const notifMsg = `Your transfer of $${amt} was rejected. Contact support if you need help.`;
      await Notification.create({
        user_id: user._id,
        type: 'transfer',
        title: notifTitle,
        message: notifMsg,
        icon: 'bell',
        action_url: '/user/notifications.html',
        data: { amount: amt, transferId: tx._id },
      });
      try {
        const { sendPushToUser } = require('../utils/pushNotifications');
        await sendPushToUser(user, {
          title: notifTitle,
          body: notifMsg,
          url: '/user/notifications.html',
          tag: 'transfer-rejected',
        });
      } catch (error) {
        console.error('Push notification failed:', error.message);
      }
    }
    return res.json({ success: true, message: 'Transfer rejected successfully', transfer: tx });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Reject failed' });
  }
});

router.delete('/transfers/:id', async (req, res) => {
  try {
    const tx = await Transfer.findByIdAndDelete(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Transfer not found' });
    try {
      await Transaction.deleteMany({ 'meta.transfer_id': tx._id });
    } catch (_) {}
    return res.json({ success: true, message: 'Transfer deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Delete failed' });
  }
});



// ---------- Cards (admin) ----------
function genCardNumber() {
  return Array.from({ length: 16 }, () => crypto.randomInt(0, 10)).join('');
}
function genCvv() {
  return String(crypto.randomInt(0, 1000)).padStart(3, '0');
}

router.get('/cards', async (req, res) => {
  try {
    const types = await CardType.find().sort({ createdAt: -1 }).lean();
    const cards = await Card.find()
      .populate('user_id', 'name first_name last_name email username')
      .populate('card_type_id')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({
      success: true,
      types,
      cards,
      stats: {
        pending: cards.filter((x) => x.status === 'pending').length,
        active: cards.filter((x) => x.status === 'active').length,
        frozen: cards.filter((x) => x.status === 'frozen').length,
        types: types.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/card-types', async (req, res) => {
  try {
    const types = await CardType.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, types });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/card-types/:id', async (req, res) => {
  try {
    const t = await CardType.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ success: false, message: 'Card type not found.' });
    return res.json({ success: true, type: t });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/card-types', async (req, res) => {
  try {
    const b = req.body || {};
    const fee = Number(b.fee || 0);
    const t = await CardType.create({
      name: String(b.name || '').trim(),
      type: String(b.type || 'Physical'),
      network: String(b.network || 'Visa'),
      fee,
      issuance_fee: fee,
      delivery_days: Number(b.delivery_days || 7),
      description: String(b.description || ''),
      is_active: b.is_active === false || b.is_active === 'false' ? false : true,
    });
    return res.status(201).json({ success: true, message: 'Card type created successfully.', type: t });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/card-types/:id', async (req, res) => {
  try {
    const t = await CardType.findById(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Card type not found.' });
    const b = req.body || {};
    if (b.name !== undefined) t.name = String(b.name);
    if (b.type !== undefined) t.type = String(b.type);
    if (b.network !== undefined) t.network = String(b.network);
    if (b.fee !== undefined) {
      t.fee = Number(b.fee);
      t.issuance_fee = Number(b.fee);
    }
    if (b.delivery_days !== undefined) t.delivery_days = Number(b.delivery_days);
    if (b.description !== undefined) t.description = String(b.description);
    if (b.is_active !== undefined) t.is_active = !(b.is_active === false || b.is_active === 'false');
    await t.save();
    return res.json({ success: true, message: 'Card type updated successfully.', type: t });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/card-types/:id/toggle', async (req, res) => {
  try {
    const t = await CardType.findById(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Card type not found.' });
    t.is_active = !t.is_active;
    await t.save();
    return res.json({ success: true, message: `Card type ${t.is_active ? 'enabled' : 'disabled'}.`, type: t });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/card-types/:id', async (req, res) => {
  try {
    await CardType.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Card type deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/cards/:id', async (req, res) => {
  try {
    const c = await Card.findById(req.params.id)
      .populate('user_id', 'name first_name last_name email username currency_code balance account_bal')
      .populate('card_type_id')
      .lean();
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    return res.json({ success: true, card: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cards/:id/approve', async (req, res) => {
  try {
    const c = await Card.findById(req.params.id).populate('user_id').populate('card_type_id');
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    if (c.status !== 'pending') return res.status(409).json({ success: false, message: 'Card is not pending.' });

    const fee = Number(c.card_type_id?.fee ?? c.card_type_id?.issuance_fee ?? 0);
    const user = c.user_id;
    const bal = Number(user.balance ?? user.account_bal ?? 0);
    if (fee > bal) {
      return res.status(422).json({ success: false, message: 'User balance is insufficient for the card fee.' });
    }
    if (fee > 0) {
      user.balance = bal - fee;
      user.account_bal = user.balance;
      await user.save();
      await CardTransaction.create({
        card_id: c._id,
        user_id: user._id,
        amount: -fee,
        type: 'card_fee',
        narration: 'Card issuance fee',
        status: 'processed',
      });
    }

    const now = new Date();
    c.card_number = genCardNumber();
    c.cvv = genCvv();
    c.expiry_month = now.getMonth() + 1;
    c.expiry_year = now.getFullYear() + 3;
    c.issued_at = now;
    c.expires_at = new Date(now.getFullYear() + 3, now.getMonth(), now.getDate());
    c.activated_at = now;
    c.status = 'active';
    await c.save();

    try {
      await Notification.create({
        user_id: user._id,
        type: 'account',
        title: 'Card Approved',
        message: `Your ${c.card_type_id?.name || 'card'} has been approved and is now active.`,
        icon: 'bell',
        action_url: '/user/notifications.html',
        data: { cardId: c._id },
      });
    } catch (_) {}
    try {
      const { sendPushToUser } = require('../utils/pushNotifications');
      await sendPushToUser(user, {
        title: 'Card Approved',
        body: `Your ${c.card_type_id?.name || 'card'} has been approved and is now active.`,
        url: '/user/credit-card.html',
        tag: 'card-approved',
      });
    } catch (error) {
      console.error('Push notification failed:', error.message);
    }

    return res.json({ success: true, message: 'Card approved and issued successfully', card: c });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cards/:id/reject', async (req, res) => {
  try {
    const c = await Card.findById(req.params.id).populate('user_id').populate('card_type_id');
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    c.status = 'rejected';
    await c.save();
    try {
      await Notification.create({
        user_id: c.user_id._id,
        type: 'account',
        title: 'Card Rejected',
        message: `Your ${c.card_type_id?.name || 'card'} application was rejected.`,
        icon: 'bell',
        action_url: '/user/notifications.html',
        data: { cardId: c._id },
      });
    } catch (_) {}
    return res.json({ success: true, message: 'Card application rejected.', card: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cards/:id/freeze', async (req, res) => {
  try {
    const c = await Card.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    c.status = 'frozen';
    c.blocked_at = new Date();
    c.block_reason = String((req.body || {}).reason || '');
    await c.save();
    return res.json({ success: true, message: 'Card frozen.', card: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cards/:id/unfreeze', async (req, res) => {
  try {
    const c = await Card.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    c.status = 'active';
    c.blocked_at = null;
    c.block_reason = '';
    await c.save();
    return res.json({ success: true, message: 'Card unfrozen and set to active.', card: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cards/:id/cancel', async (req, res) => {
  try {
    const c = await Card.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    c.status = 'cancelled';
    await c.save();
    return res.json({ success: true, message: 'Card cancelled.', card: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/cards/:id', async (req, res) => {
  try {
    const c = await Card.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    const b = req.body || {};
    for (const k of ['card_holder', 'card_number', 'expiry_month', 'expiry_year', 'cvv', 'status']) {
      if (b[k] !== undefined) c[k] = b[k];
    }
    if (b.balance !== undefined) c.balance = Number(b.balance);
    await c.save();
    return res.json({ success: true, message: 'Card details updated successfully.', card: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/cards/:id', async (req, res) => {
  try {
    const c = await Card.findByIdAndDelete(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Card not found.' });
    return res.json({ success: true, message: 'Card deleted successfully.' });
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


// ---------- Loans (admin) ----------
router.get('/loan-plans', async (req, res) => {
  try {
    const plans = await LoanPlan.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, plans });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/loan-plans', async (req, res) => {
  try {
    const b = req.body || {};
    const plan = await LoanPlan.create({
      name: String(b.name || '').trim(),
      description: String(b.description || ''),
      interest_rate: featureNum(b.interest_rate, 5),
      interest_type: String(b.interest_type || 'simple').toLowerCase() === 'compound' ? 'compound' : 'simple',
      processing_fee: featureNum(b.processing_fee),
      min_amount: featureNum(b.min_amount, 100),
      max_amount: featureNum(b.max_amount, 10000),
      min_duration: featureNum(b.min_duration, 1),
      max_duration: featureNum(b.max_duration, 36),
      min_account_balance: featureNum(b.min_account_balance),
      max_active_loans: featureNum(b.max_active_loans, 1),
      status: 'Active',
      is_active: b.is_active === false || b.is_active === 'false' ? false : true,
    });
    return res.status(201).json({ success: true, message: 'Loan plan created.', plan });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/loan-plans/:id', async (req, res) => {
  try {
    const plan = await LoanPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    const b = req.body || {};
    ['name', 'description', 'interest_type', 'status'].forEach((k) => {
      if (b[k] !== undefined) plan[k] = b[k];
    });
    ['interest_rate', 'processing_fee', 'min_amount', 'max_amount', 'min_duration', 'max_duration', 'min_account_balance', 'max_active_loans'].forEach((k) => {
      if (b[k] !== undefined) plan[k] = featureNum(b[k]);
    });
    if (b.is_active !== undefined) plan.is_active = !(b.is_active === false || b.is_active === 'false');
    await plan.save();
    return res.json({ success: true, message: 'Plan updated.', plan });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/loan-plans/:id/toggle', async (req, res) => {
  try {
    const plan = await LoanPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    plan.is_active = !plan.is_active;
    plan.status = plan.is_active ? 'Active' : 'Inactive';
    await plan.save();
    return res.json({ success: true, message: `Plan ${plan.is_active ? 'enabled' : 'disabled'}.`, plan });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/loan-plans/:id', async (req, res) => {
  try {
    await LoanPlan.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Plan deleted.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/loans', async (req, res) => {
  try {
    const plans = await LoanPlan.find().sort({ createdAt: -1 }).lean();
    const loans = await Loan.find()
      .populate('user_id', 'name first_name last_name email username')
      .populate('plan_id')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({
      success: true,
      plans,
      loans,
      stats: {
        pending: loans.filter((x) => x.status === 'pending').length,
        active: loans.filter((x) => ['active', 'repaying'].includes(x.status)).length,
        completed: loans.filter((x) => x.status === 'completed').length,
        plans: plans.length,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/loans/:id/approve', async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate('user_id').populate('plan_id');
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found.' });
    if (loan.status !== 'pending') return res.status(409).json({ success: false, message: 'Loan is not pending.' });
    const user = loan.user_id;
    const amount = featureNum(loan.amount);
    const months = featureNum(loan.duration_months);
    const built = loanBuildSchedule(amount, months, loan.interest_rate, loan.interest_type);
    const fee = featureNum(loan.processing_fee);
    loan.approved_amount = amount;
    loan.total_interest = Math.round(built.totalInterest * 100) / 100;
    loan.total_repayable = Math.round((built.totalRepayable + fee) * 100) / 100;
    loan.schedule = built.schedule;
    loan.status = 'active';
    loan.approved_at = new Date();
    await loan.save();

    // Credit principal to user balance
    const bal = featureNum(user.balance ?? user.account_bal);
    user.balance = bal + amount;
    user.account_bal = user.balance;
    await user.save();

    try {
      const Transaction = require('../models/Transaction');
      await Transaction.create({
        user_id: user._id,
        type: 'credit',
        title: 'Loan Disbursement',
        amount: amount,
        currency: '$',
        status: 'Successful',
        description: `Loan approved and disbursed (${loan.plan_id && loan.plan_id.name ? loan.plan_id.name : 'Loan'})`,
        meta: { loan_id: String(loan._id), source: 'loan-approve' },
      });
    } catch (txErr) {
      console.error('loan transaction create failed:', txErr.message);
    }

    try {
      await Notification.create({
        user_id: user._id,
        type: 'loan',
        title: 'Loan Approved',
        message: `Your loan of $${amount.toFixed(2)} has been approved and credited to your account.`,
        icon: 'bell',
        action_url: '/user/loan.html',
        data: { loanId: loan._id },
      });
    } catch (_) {}
    try {
      const { sendPushToUser } = require('../utils/pushNotifications');
      await sendPushToUser(user, {
        title: 'Loan Approved',
        body: `Your loan of $${amount.toFixed(2)} has been approved and credited.`,
        url: '/user/loan.html',
        tag: 'loan-approved',
      });
    } catch (_) {}
    return res.json({ success: true, message: 'Loan approved and funded.', loan });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/loans/:id/reject', async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate('user_id').populate('plan_id');
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found.' });
    loan.status = 'rejected';
    loan.rejected_at = new Date();
    loan.reject_reason = String((req.body || {}).reason || '');
    await loan.save();
    try {
      await Notification.create({
        user_id: loan.user_id._id,
        type: 'loan',
        title: 'Loan Rejected',
        message: `Your loan application for $${featureNum(loan.amount).toFixed(2)} was rejected.`,
        icon: 'bell',
        action_url: '/user/loan.html',
        data: { loanId: loan._id },
      });
    } catch (_) {}
    return res.json({ success: true, message: 'Loan application rejected.', loan });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/loans/:id', async (req, res) => {
  try {
    const loan = await Loan.findByIdAndDelete(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found.' });
    return res.json({ success: true, message: 'Loan deleted.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});


// ---------- Crypto wallets (admin) ----------
router.get('/wallets', async (req, res) => {
  try {
    const wallets = await CryptoWallet.find().sort({ sort_order: 1, name: 1 }).lean();
    return res.json({ success: true, wallets });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/wallets', async (req, res) => {
  try {
    const b = req.body || {};
    const w = await CryptoWallet.create({
      name: String(b.name || '').trim(),
      symbol: String(b.symbol || b.name || '').trim(),
      network: String(b.network || '').trim(),
      address: String(b.address || '').trim(),
      is_active: b.is_active === false || b.is_active === 'false' ? false : true,
      sort_order: Number(b.sort_order || 0),
    });
    return res.status(201).json({ success: true, message: 'Wallet created', wallet: w });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/wallets/:id', async (req, res) => {
  try {
    const w = await CryptoWallet.findById(req.params.id);
    if (!w) return res.status(404).json({ success: false, message: 'Wallet not found' });
    const b = req.body || {};
    ['name', 'symbol', 'network', 'address'].forEach((k) => {
      if (b[k] !== undefined) w[k] = String(b[k]).trim();
    });
    if (b.is_active !== undefined) w.is_active = !(b.is_active === false || b.is_active === 'false');
    if (b.sort_order !== undefined) w.sort_order = Number(b.sort_order);
    await w.save();
    return res.json({ success: true, message: 'Wallet updated', wallet: w });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/wallets/:id/toggle', async (req, res) => {
  try {
    const w = await CryptoWallet.findById(req.params.id);
    if (!w) return res.status(404).json({ success: false, message: 'Wallet not found' });
    w.is_active = !w.is_active;
    await w.save();
    return res.json({ success: true, message: w.is_active ? 'Wallet enabled' : 'Wallet disabled', wallet: w });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/wallets/:id', async (req, res) => {
  try {
    await CryptoWallet.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Wallet deleted' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
