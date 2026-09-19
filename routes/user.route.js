const router = require('express').Router();
const cloudinary = require('cloudinary').v2;
const Verify = require('../models/verifySchema');
const User = require('../models/user.model');

const NotificationController = require('../utils/NotificationController');
const Notification = require('../models/Notification');
const { sendPushToUser } = require('../utils/pushNotifications');
const Transaction = require('../models/Transaction');
const Deposit = require('../models/Deposit');
const frontendUrl = () => String(process.env.FRONTEND_URL || '').replace(/\/$/, '');

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
    const transactions = await Transaction.find({ user_id: req.user._id }).sort({ createdAt: -1 }).limit(20).lean();
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
  return res.json({ success: true, addresses: CRYPTO_ADDRESSES });
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
    const address = String((req.body || {}).address || CRYPTO_ADDRESSES[crypto_type] || '');
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

    const deposit = await Deposit.create({
      user_id: req.user._id,
      method: 'crypto',
      crypto_type,
      amount,
      address,
      proof_url,
      status: 'pending',
    });

    const notifTitle = 'Deposit Submitted';
    const notifMsg = `Your deposit of $${amount} is under review`;
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


module.exports = router;
