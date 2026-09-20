const mongoose = require('mongoose');

const cardTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, default: 'Physical', trim: true }, // Physical | Virtual
    network: { type: String, default: 'Visa', trim: true },
    fee: { type: Number, default: 0 },
    issuance_fee: { type: Number, default: 0 },
    delivery_days: { type: Number, default: 7 },
    description: { type: String, default: '' },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.CardType || mongoose.model('CardType', cardTypeSchema);
