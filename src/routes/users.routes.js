const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const { getAllUsers } = require("../controllers/users.controller");

const router = express.Router();
const { getAllUsers, pingUser } = require("../controllers/users.controller");

// Public routes
router.post("/ping", pingUser);

// Protected admin routes
router.use(verifyToken);
router.get("/", getAllUsers);

module.exports = router;
