const express = require("express");
const {
  getActiveMessages,
  getAllMessages,
  createMessage,
  updateMessage,
  deleteMessage,
} = require("../controllers/messages.controller");

const router = express.Router();

router.get("/active", getActiveMessages);

// Basic Admin CRUD routes
router.get("/", getAllMessages);
router.post("/", createMessage);
router.put("/:id", updateMessage);
router.delete("/:id", deleteMessage);

module.exports = router;
