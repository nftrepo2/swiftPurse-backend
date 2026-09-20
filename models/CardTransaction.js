const mongoose = require('mongoose');

const cardTxSchema = new mongoose.Schema(
  {
    card_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    type: { type: String, default: 'card_fee' },
    narration: { type: String, default: '' },
    status: { type: String, default: 'processed' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.CardTransaction || mongoose.model('CardTransaction', cardTxSchema);
