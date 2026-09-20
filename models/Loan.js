const mongoose = require('mongoose');

const scheduleItemSchema = new mongoose.Schema(
  {
    due_date: Date,
    principal: Number,
    interest: Number,
    total: Number,
    late_fee: { type: Number, default: 0 },
    status: { type: String, default: 'upcoming' }, // upcoming | overdue | paid
    paid_at: Date,
    paid_amount: Number,
  },
  { _id: true }
);

const loanSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPlan', required: true },
    amount: { type: Number, required: true },
    approved_amount: { type: Number, default: null },
    duration_months: { type: Number, required: true },
    purpose: { type: String, default: '' },
    monthly_income: { type: Number, default: 0 },
    interest_rate: { type: Number, default: 0 },
    interest_type: { type: String, default: 'simple' },
    processing_fee: { type: Number, default: 0 },
    total_interest: { type: Number, default: 0 },
    total_repayable: { type: Number, default: 0 },
    total_repaid: { type: Number, default: 0 },
    schedule: [scheduleItemSchema],
    status: {
      type: String,
      enum: ['pending', 'active', 'repaying', 'completed', 'rejected', 'defaulted'],
      default: 'pending',
      index: true,
    },
    applied_at: { type: Date, default: Date.now },
    approved_at: Date,
    rejected_at: Date,
    reject_reason: { type: String, default: '' },
  },
  { timestamps: true }
);

loanSchema.index({ user_id: 1, createdAt: -1 });

module.exports = mongoose.models.Loan || mongoose.model('Loan', loanSchema);
