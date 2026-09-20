const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { roles } = require('../utils/constants');

const userSchema = new mongoose.Schema(
  {
    // Registration form fields (aligned with frontend register page)
    first_name: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [80, 'First name is too long'],
    },
    last_name: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [80, 'Last name is too long'],
    },
    // Computed full name for display / legacy compatibility
    name: {
      type: String,
      trim: true,
      maxlength: [160, 'Full name is too long'],
      default: '',
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [40, 'Username must be at most 40 characters'],
      match: [/^[a-z0-9_.-]+$/, 'Username contains invalid characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    // Passcode / password from registration (6-digit passcode or longer password)
    pin: { type: String, default: '' },
    transaction_pin: { type: String, default: '' },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },

    // Optional profile fields (not required at registration)
    phone: { type: String, trim: true, maxlength: [30, 'Phone is too long'], default: '' },
    gender: { type: String, enum: ['Female', 'Male', 'Others', ''], default: '' },
    country: { type: String, trim: true, default: '' },
    currency_code: { type: String, uppercase: true, trim: true, default: 'USD' },
    role: { type: String, enum: [roles.admin, roles.moderator, roles.client], default: roles.client },

    // Account / balance fields
    balance: { type: Number, default: 0, min: 0 },
    account_bal: { type: Number, default: 0, min: 0 },
    frozen_bal: { type: Number, default: 0, min: 0 },
    profit: { type: Number, default: 0, min: 0 },
    bonus: { type: Number, default: 0, min: 0 },
    account_no: { type: String, default: '', trim: true },

    // Verification status
    isVerified: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ['not_verified', 'pending', 'verified', 'rejected'],
      default: 'not_verified',
    },
    account_verify: { type: String, default: 'Not Verified' },

    // Profile image & misc
    image: { type: String, default: '' },
    dob: { type: String, default: '' },
    marital_status: { type: String, default: '' },
    home_address: { type: String, default: '' },
    next_of_kin: { type: String, default: '' },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    pinResetToken: { type: String, select: false },
    pinResetExpires: { type: Date, select: false },
    pushSubscription: { type: mongoose.Schema.Types.Mixed, default: null },
    pushSubscriptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    isBlocked: { type: Boolean, default: false },
    account_tier: { type: String, enum: ['Tier 1', 'Tier 2', '1', '2', ''], default: 'Tier 1' },
    ref_link: { type: String, default: '' },
  },
  { timestamps: true }
);

// Auto-set full name from first + last before save
userSchema.pre('save', function setFullName(next) {
  if (this.first_name || this.last_name) {
    this.name = [this.first_name, this.last_name].filter(Boolean).join(' ').trim();
  }
  next();
});

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.pre('save', function syncLegacyBalance(next) {
  const balanceChanged = this.isModified('balance');
  const accountBalChanged = this.isModified('account_bal');
  if (balanceChanged && !accountBalChanged) this.account_bal = Math.max(0, Number(this.balance || 0));
  if (accountBalChanged && !balanceChanged) this.balance = Math.max(0, Number(this.account_bal || 0));
  if (this.isVerified || this.verificationStatus === 'verified' || this.account_verify === 'Verified') {
    this.isVerified = true;
    this.verificationStatus = 'verified';
    this.account_verify = 'Verified';
  }
  if (this.verificationStatus === 'pending') this.account_verify = 'Pending';
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
