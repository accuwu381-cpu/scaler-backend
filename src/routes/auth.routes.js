const { loginAdmin, logoutAdmin } = require("../controllers/auth.controller");
const express = require("express");

const router = express.Router();

router.post("/login", loginAdmin);
router.post("/logout", logoutAdmin);

module.exports = router;
