const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const router = express.Router();
const { getAllUsers, pingUser, trackDownload } = require("../controllers/users.controller");

// Public routes (called by extension, no admin JWT needed)
router.post("/ping", pingUser);
router.post("/download", trackDownload);

// Protected admin routes
router.use(verifyToken);
router.get("/", getAllUsers);

module.exports = router;
