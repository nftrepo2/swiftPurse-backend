const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    card_type_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CardType', required: true },
    card_holder: { type: String, default: '', trim: true },
    shipping_address: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ['pending', 'active', 'frozen', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    card_number: { type: String, default: '' },
    cvv: { type: String, default: '' },
    expiry_month: { type: Number, default: null },
    expiry_year: { type: Number, default: null },
    balance: { type: Number, default: 0 },
    issued_at: { type: Date, default: null },
    expires_at: { type: Date, default: null },
    activated_at: { type: Date, default: null },
    blocked_at: { type: Date, default: null },
    block_reason: { type: String, default: '' },
  },
  { timestamps: true }
);

cardSchema.index({ user_id: 1, createdAt: -1 });

module.exports = mongoose.models.Card || mongoose.model('Card', cardSchema);
