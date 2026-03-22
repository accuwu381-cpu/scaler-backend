const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const {
  getActiveMessages,
  getAllMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  syncUser,
} = require("../controllers/messages.controller");

const router = express.Router();

router.get("/active", getActiveMessages);
router.post("/sync-user", syncUser);

// Apply security middleware to all other routes
router.use(verifyToken);

// Basic Admin CRUD routes
router.get("/", getAllMessages);
router.post("/", createMessage);
router.put("/:id", updateMessage);
router.delete("/:id", deleteMessage);

module.exports = router;
