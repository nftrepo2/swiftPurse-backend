const mongoose = require('mongoose');

const loanPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    interest_rate: { type: Number, default: 5 },
    interest_type: { type: String, enum: ['simple', 'compound'], default: 'simple' },
    processing_fee: { type: Number, default: 0 }, // percent
    min_amount: { type: Number, default: 100 },
    max_amount: { type: Number, default: 10000 },
    min_duration: { type: Number, default: 1 },
    max_duration: { type: Number, default: 36 },
    min_account_balance: { type: Number, default: 0 },
    max_active_loans: { type: Number, default: 1 },
    status: { type: String, default: 'Active' },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.LoanPlan || mongoose.model('LoanPlan', loanPlanSchema);
