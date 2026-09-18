const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['credit', 'debit', 'transfer', 'deposit', 'withdrawal'], default: 'credit' },
    title: { type: String, default: 'INWARD TRANSFER' },
    amount: { type: Number, required: true },
    currency: { type: String, default: '$' },
    status: { type: String, enum: ['Successful', 'In Progress', 'Failed', 'Pending'], default: 'Successful' },
    description: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

transactionSchema.index({ user_id: 1, createdAt: -1 });

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
