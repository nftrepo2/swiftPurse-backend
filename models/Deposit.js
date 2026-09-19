const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    method: { type: String, enum: ['crypto', 'institutional', 'bank', 'card', 'upgrade', 'fixed_deposit'], default: 'crypto' },
    crypto_type: { type: String, default: 'Bitcoin' },
    amount: { type: Number, required: true },
    address: { type: String, default: '' },
    proof_url: { type: String, default: '' },
    purpose: { type: String, default: 'deposit' },
    plan: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'Pending', 'Approved', 'Rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

depositSchema.index({ user_id: 1, createdAt: -1 });

module.exports = mongoose.models.Deposit || mongoose.model('Deposit', depositSchema);
