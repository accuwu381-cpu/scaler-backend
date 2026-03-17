const { loginAdmin } = require("../controllers/auth.controller");
const express = require("express");

const router = express.Router();

router.post("/login", loginAdmin);

module.exports = router;
