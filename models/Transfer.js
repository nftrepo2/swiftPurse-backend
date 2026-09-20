const mongoose = require('mongoose');

const transferSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bank: { type: String, required: true, trim: true },
    swift: { type: String, default: '', trim: true },
    currency: { type: String, default: 'USD', trim: true },
    routing: { type: String, default: '', trim: true },
    country: { type: String, default: '', trim: true },
    account_no: { type: String, required: true, trim: true },
    holder_name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    service_charge: { type: Number, default: 0 },
    amount_received: { type: Number, default: 0 },
    note: { type: String, default: '' },
    payment_method: { type: String, default: 'Bank Transfer' },
    status: {
      type: String,
      enum: ['In Progress', 'Processing', 'Successful', 'Failed', 'Pending', 'Rejected'],
      default: 'In Progress',
      index: true,
    },
    transaction_id: { type: String, default: '', index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

transferSchema.index({ user_id: 1, createdAt: -1 });

module.exports = mongoose.models.Transfer || mongoose.model('Transfer', transferSchema);
