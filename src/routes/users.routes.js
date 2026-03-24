const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const { getAllUsers } = require("../controllers/users.controller");

const router = express.Router();

// All user routes require admin JWT auth
router.use(verifyToken);

router.get("/", getAllUsers);

module.exports = router;
