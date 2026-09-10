const express = require("express");
const {
  createPayment,
  getPublicPayments,
  getPayments,
  updatePaymentStatus,
} = require("../controllers/payments.controller");

const router = express.Router();

router.get("/public", getPublicPayments);
router.post("/", createPayment);
router.get("/", getPayments);
router.patch("/:id", updatePaymentStatus);

module.exports = router;
