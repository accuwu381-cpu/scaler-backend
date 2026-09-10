const PAYMENT_REVIEW_TOKEN = "LauduLalit";
const UPI_ID = "7218548912@sbi";
const ADMIN_EMAIL = "prajapatiritesh381@gmail.com";

const normalizeReviewToken = (value) =>
  String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");

const hasPaymentReviewAccess = (token) =>
  normalizeReviewToken(token) === PAYMENT_REVIEW_TOKEN;

module.exports = {
  ADMIN_EMAIL,
  PAYMENT_REVIEW_TOKEN,
  UPI_ID,
  hasPaymentReviewAccess,
};
