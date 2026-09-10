const supabase = require("../services/supabase");
const { sendPaymentReviewEmail } = require("../services/paymentEmail.service");
const {
  UPI_ID,
  hasPaymentReviewAccess,
} = require("../utils/paymentAccess");

const TABLE = "donation_payments";
const MAX_AMOUNT = 1000000;
const MAX_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 500;

const toNumber = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
};

const trimToLimit = (value, limit) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, limit);
};

const formatPayment = (row) => ({
  id: row.id,
  amount: Number(row.amount_rupees),
  supporterName: row.supporter_name,
  message: row.message,
  anonymous: Boolean(row.is_anonymous),
  displayName:
    row.is_anonymous || !row.supporter_name ? "Anonymous" : row.supporter_name,
  status: row.status,
  upiId: row.upi_id,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
});

const formatPublicPayment = (row) => ({
  id: row.id,
  amount: Number(row.amount_rupees),
  displayName:
    row.is_anonymous || !row.supporter_name ? "Anonymous" : row.supporter_name,
  message: row.message,
  createdAt: row.created_at,
});

const requirePaymentToken = (req, res) => {
  if (hasPaymentReviewAccess(req.query.token)) return true;
  res.status(403).json({ success: false, message: "Invalid payments token." });
  return false;
};

const createPayment = async (req, res) => {
  try {
    const amount = toNumber(req.body?.amount);
    if (!amount || amount <= 0 || amount > MAX_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Amount must be between 1 and ${MAX_AMOUNT}.`,
      });
    }

    const supporterName = trimToLimit(req.body?.name, MAX_NAME_LENGTH);
    const message = trimToLimit(req.body?.message, MAX_MESSAGE_LENGTH);
    const anonymous = Boolean(req.body?.anonymous);

    const { data, error } = await supabase
      .from(TABLE)
      .insert([
        {
          amount_rupees: amount,
          supporter_name: supporterName,
          message,
          is_anonymous: anonymous,
          upi_id: UPI_ID,
          status: "pending",
        },
      ])
      .select()
      .single();

    if (error) throw error;

    let email = { sent: false };
    try {
      email = await sendPaymentReviewEmail(data);
    } catch (mailError) {
      console.error("Payment review email failed:", mailError.message);
      email = { sent: false, reason: "send_failed" };
    }

    return res.status(201).json({
      success: true,
      message: "Payment submitted for verification.",
      emailSent: Boolean(email.sent),
      data: {
        id: data.id,
        status: data.status,
      },
    });
  } catch (error) {
    console.error("Error creating payment:", error);
    return res.status(500).json({
      success: false,
      message: "Could not submit payment.",
    });
  }
};

const getPublicPayments = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "id, amount_rupees, supporter_name, message, is_anonymous, status, upi_id, created_at, reviewed_at",
      )
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    const payments = (data || []).map(formatPublicPayment);
    const totalAmount = payments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );

    return res.status(200).json({
      success: true,
      count: payments.length,
      totalAmount,
      data: payments.slice(0, 25),
    });
  } catch (error) {
    console.error("Error fetching public payments:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load payments.",
    });
  }
};

const getPayments = async (req, res) => {
  if (!requirePaymentToken(req, res)) return;

  try {
    const id = String(req.query.id || "").trim();
    let query = supabase
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (id) query = query.eq("id", id).limit(1);
    else query = query.limit(200);

    const { data, error } = await query;
    if (error) throw error;

    if (id && (!data || data.length === 0)) {
      return res.status(404).json({
        success: false,
        message: "Payment not found.",
      });
    }

    const payments = (data || []).map(formatPayment);
    return res.status(200).json({
      success: true,
      count: payments.length,
      data: id ? payments[0] : payments,
    });
  } catch (error) {
    console.error("Error fetching payments:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load payments.",
    });
  }
};

const resendPaymentEmail = async (req, res) => {
  if (!requirePaymentToken(req, res)) return;

  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Payment id is required.",
      });
    }

    const { data: payment, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found.",
      });
    }

    const email = await sendPaymentReviewEmail(payment);
    if (!email.sent) {
      return res.status(503).json({
        success: false,
        message: "Payment email is not configured.",
        code: email.reason || "not_configured",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment review email sent.",
    });
  } catch (error) {
    console.error("Payment review email retry failed:", error.message);
    return res.status(502).json({
      success: false,
      message: "Could not send payment review email.",
      code: error.code || "send_failed",
      responseCode: error.responseCode || null,
    });
  }
};

const updatePaymentStatus = async (req, res) => {
  if (!requirePaymentToken(req, res)) return;

  try {
    const id = String(req.params.id || "").trim();
    const status = String(req.body?.status || "").trim();

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Payment id is required.",
      });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected.",
      });
    }

    const { data: existing, error: fetchError } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Payment not found.",
      });
    }

    if (existing.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: `Payment is already ${existing.status}.`,
        data: formatPayment(existing),
      });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update({
        status,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: `Payment ${status}.`,
      data: formatPayment(data),
    });
  } catch (error) {
    console.error("Error updating payment:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update payment.",
    });
  }
};

module.exports = {
  createPayment,
  getPublicPayments,
  getPayments,
  resendPaymentEmail,
  updatePaymentStatus,
};
