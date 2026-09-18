const router = require('express').Router();

const frontendUrl = () => String(process.env.FRONTEND_URL || '').replace(/\/$/, '');

// Home
router.get('/', (req, res) => {
  return res.redirect(`${frontendUrl()}/index.html`);
});

router.get('/index.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/index.html`);
});

router.get('/home', (req, res) => {
  return res.redirect(`${frontendUrl()}/index.html`);
});

// Auth pages
router.get('/login', (req, res) => {
  return res.redirect(`${frontendUrl()}/login.html`);
});

router.get('/login.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/login.html`);
});

router.get('/register', (req, res) => {
  return res.redirect(`${frontendUrl()}/register.html`);
});

router.get('/register.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/register.html`);
});

router.get('/signup', (req, res) => {
  return res.redirect(`${frontendUrl()}/register.html`);
});

router.get('/signup.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/register.html`);
});

// Product / marketing pages
router.get('/contact', (req, res) => {
  return res.redirect(`${frontendUrl()}/contact.html`);
});

router.get('/contact.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/contact.html`);
});

router.get('/credit-card', (req, res) => {
  return res.redirect(`${frontendUrl()}/credit-card.html`);
});

router.get('/credit-card.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/credit-card.html`);
});

router.get('/current-accounts', (req, res) => {
  return res.redirect(`${frontendUrl()}/current-accounts.html`);
});

router.get('/current-accounts.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/current-accounts.html`);
});

router.get('/deposit', (req, res) => {
  return res.redirect(`${frontendUrl()}/deposit.html`);
});

router.get('/deposit.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/deposit.html`);
});

router.get('/foreign-drafts', (req, res) => {
  return res.redirect(`${frontendUrl()}/foreign-drafts.html`);
});

router.get('/foreign-drafts.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/foreign-drafts.html`);
});

router.get('/interest-checking', (req, res) => {
  return res.redirect(`${frontendUrl()}/interest-checking.html`);
});

router.get('/interest-checking.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/interest-checking.html`);
});

router.get('/invest-benefits', (req, res) => {
  return res.redirect(`${frontendUrl()}/invest-benefits.html`);
});

router.get('/invest-benefits.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/invest-benefits.html`);
});

router.get('/money-market-account', (req, res) => {
  return res.redirect(`${frontendUrl()}/money-market-account.html`);
});

router.get('/money-market-account.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/money-market-account.html`);
});

router.get('/mortgages', (req, res) => {
  return res.redirect(`${frontendUrl()}/mortgages.html`);
});

router.get('/mortgages.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/mortgages.html`);
});

router.get('/personal-insurance', (req, res) => {
  return res.redirect(`${frontendUrl()}/personal-insurance.html`);
});

router.get('/personal-insurance.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/personal-insurance.html`);
});

router.get('/personal-loans', (req, res) => {
  return res.redirect(`${frontendUrl()}/personal-loans.html`);
});

router.get('/personal-loans.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/personal-loans.html`);
});

router.get('/savings-account', (req, res) => {
  return res.redirect(`${frontendUrl()}/savings-account.html`);
});

router.get('/savings-account.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/savings-account.html`);
});

router.get('/small-business', (req, res) => {
  return res.redirect(`${frontendUrl()}/small-business.html`);
});

router.get('/small-business.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/small-business.html`);
});

router.get('/tele-banking', (req, res) => {
  return res.redirect(`${frontendUrl()}/tele-banking.html`);
});

router.get('/tele-banking.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/tele-banking.html`);
});

router.get('/terms', (req, res) => {
  return res.redirect(`${frontendUrl()}/terms.html`);
});

router.get('/terms.html', (req, res) => {
  return res.redirect(`${frontendUrl()}/terms.html`);
});

module.exports = router;
