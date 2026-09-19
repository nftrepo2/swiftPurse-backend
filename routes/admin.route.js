const router = require('express').Router();
const User = require('../models/user.model');
const Notification = require('../models/Notification');
const Transaction = require('../models/Transaction');
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
    const status = type === 'credit' ? 'Successful' : 'Successful';
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

module.exports = router;
