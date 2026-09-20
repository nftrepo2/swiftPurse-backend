const mongoose = require('mongoose');

const cryptoWalletSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // Bitcoin, Ethereum, USDT...
    symbol: { type: String, default: '', trim: true },
    network: { type: String, default: '', trim: true },
    address: { type: String, required: true, trim: true },
    is_active: { type: Boolean, default: true },
    sort_order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.CryptoWallet || mongoose.model('CryptoWallet', cryptoWalletSchema);
