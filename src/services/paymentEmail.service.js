const nodemailer = require("nodemailer");
const {
  ADMIN_EMAIL,
  PAYMENT_REVIEW_TOKEN,
} = require("../utils/paymentAccess");

const FRONTEND_URL = (
  process.env.PAYMENTS_FRONTEND_URL ||
  process.env.FRONTEND_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://scalerfrontend.vercel.app"
).replace(/\/+$/, "");

const MAIL_USER =
  process.env.PAYMENTS_MAIL_USER || process.env.GMAIL_USER || ADMIN_EMAIL;

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatAmount = (amount) => {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return String(amount || "0");
  return parsed.toLocaleString("en-IN", {
    minimumFractionDigits: parsed % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

const getReviewUrl = (paymentId) => {
  const params = new URLSearchParams({
    id: paymentId,
    token: PAYMENT_REVIEW_TOKEN,
  });
  return `${FRONTEND_URL}/payments?${params.toString()}`;
};

const getTransporter = () => {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) return null;

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: MAIL_USER,
      pass,
    },
  });
};

async function sendPaymentReviewEmail(payment) {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, reason: "missing_gmail_app_password" };
  }

  const reviewUrl = getReviewUrl(payment.id);
  const amount = formatAmount(payment.amount_rupees);
  const name = payment.supporter_name || "Anonymous / not provided";
  const message = payment.message || "No message";

  await transporter.sendMail({
    from: `"Scaler++ Payments" <${MAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `Scaler++ donation pending: Rs. ${amount}`,
    text: [
      "A user submitted a Scaler++ donation for verification.",
      "",
      `Amount: Rs. ${amount}`,
      `Name: ${name}`,
      `Anonymous on public page: ${payment.is_anonymous ? "Yes" : "No"}`,
      `Message: ${message}`,
      "",
      `Review: ${reviewUrl}`,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>Scaler++ donation pending</h2>
        <p>A user submitted a payment for verification.</p>
        <table style="border-collapse:collapse">
          <tr><td style="padding:4px 12px 4px 0"><b>Amount</b></td><td>Rs. ${escapeHtml(amount)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><b>Name</b></td><td>${escapeHtml(name)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><b>Anonymous</b></td><td>${payment.is_anonymous ? "Yes" : "No"}</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><b>Message</b></td><td>${escapeHtml(message)}</td></tr>
        </table>
        <p>
          <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:10px 14px;background:#7a32fd;color:#fff;text-decoration:none;border-radius:8px">
            Review payment
          </a>
        </p>
      </div>
    `,
  });

  return { sent: true, reviewUrl };
}

module.exports = {
  getReviewUrl,
  sendPaymentReviewEmail,
};
