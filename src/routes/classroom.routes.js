const express = require("express");
const {
  postStates,
  postVote,
  getAdminVotes,
  getAdminHistory,
  postResettle,
  postSweep,
} = require("../controllers/classroom.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

const router = express.Router();

// Same shared bearer token the extension already sends to /api/transcribe and
// /api/transcript. Overridable by env so it can be rotated without a code push.
const EXTENSION_TOKEN =
  process.env.EXTENSION_TOKEN ||
  "Ritesh-Prajapati-created-started-this-extension-super-secret-key-12345";

function requireExtensionToken(req, res, next) {
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${EXTENSION_TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ── Student-facing (extension bearer token) ──────────────────────────────────

// POST because a read needs the class metadata in a body — see the controller.
router.post("/states", requireExtensionToken, postStates);
router.post("/:classId/vote", requireExtensionToken, postVote);

// ── Admin (cookie JWT) ───────────────────────────────────────────────────────
// Attribution and settled state never travel over the extension token: a
// student must not be able to pull the list of who voted what.

router.get("/admin/votes", verifyToken, getAdminVotes);
router.get("/admin/history", verifyToken, getAdminHistory);
router.post("/admin/resettle/:classId", verifyToken, postResettle);
router.post("/admin/sweep", verifyToken, postSweep);

module.exports = router;
