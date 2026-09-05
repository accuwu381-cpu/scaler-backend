const {
  getClassroomStates,
  castVote,
  settleClass,
  sweepSettlements,
  listVotesForAdmin,
  listVoteHistoryForAdmin,
} = require("../services/classroom.service");
const { ROOMS } = require("../services/classroomTrust");

const MAX_CLASSES_PER_READ = 40;

/** Fraction of reads that also settle finished classes. See sweepSettlements. */
const SWEEP_CHANCE = 0.15;

/**
 * POST /api/classroom/states
 * Body: { email?, classes: [{ classId, subject?, batch?, classDate, startsAt, endsAt }] }
 *
 * A read, but it takes a body: a class nobody has voted on yet exists in no
 * table, and that is precisely when the history prior matters. `batch` in the
 * body is ignored whenever the server has its own value for that user.
 */
const postStates = async (req, res) => {
  try {
    const classes = Array.isArray(req.body?.classes) ? req.body.classes : null;
    if (!classes || !classes.length) {
      return res.status(400).json({ error: "'classes' must be a non-empty array." });
    }
    if (classes.length > MAX_CLASSES_PER_READ) {
      return res
        .status(400)
        .json({ error: `At most ${MAX_CLASSES_PER_READ} classes per request.` });
    }

    const invalid = classes.find(
      (entry) => !entry?.classId || !entry?.startsAt || !entry?.endsAt,
    );
    if (invalid) {
      return res
        .status(400)
        .json({ error: "Each class needs classId, startsAt and endsAt." });
    }

    const states = await getClassroomStates(classes, req.body?.email);

    if (Math.random() < SWEEP_CHANCE) {
      await sweepSettlements();
    }

    return res.status(200).json({ rooms: ROOMS, states });
  } catch (err) {
    console.error("postStates error:", err.message);
    return res.status(500).json({ error: "Classroom lookup failed.", details: err.message });
  }
};

/**
 * POST /api/classroom/:classId/vote
 * Body: { email, room, subject?, batch?, lectureTitle?, classDate, startsAt, endsAt }
 *
 * `room: null` withdraws the caller's answer. It is read off the body as-is so
 * an explicit null survives — defaulting it would turn a withdrawal into a
 * "bad_room" refusal.
 */
const postVote = async (req, res) => {
  try {
    const { classId } = req.params;
    const { email, room } = req.body || {};

    if (!classId) return res.status(400).json({ error: "classId is required." });

    const result = await castVote({
      classId,
      email,
      room,
      meta: {
        // The course batch ("SST DevOps & Cloud 2028 Batch A") is what predicts
        // a room; `subject` is accepted as its legacy name.
        courseBatch: req.body?.courseBatch,
        subject: req.body?.subject,
        batch: req.body?.batch,
        lectureTitle: req.body?.lectureTitle,
        classDate: req.body?.classDate,
        startsAt: req.body?.startsAt,
        endsAt: req.body?.endsAt,
      },
    });

    if (!result.ok) {
      // A refused vote is an expected outcome, not a server fault: the window
      // closed, or the daily write cap is hit. Changing an answer is allowed
      // as often as the voter likes while the window is open.
      return res.status(409).json({ error: result.reason });
    }

    const states = await getClassroomStates(
      [
        {
          classId,
          subject: req.body?.subject,
          batch: req.body?.batch,
          classDate: req.body?.classDate,
          startsAt: req.body?.startsAt,
          endsAt: req.body?.endsAt,
        },
      ],
      email,
    );

    return res.status(200).json({ success: true, state: states[0] });
  } catch (err) {
    console.error("postVote error:", err.message);
    return res.status(500).json({ error: "Failed to record vote.", details: err.message });
  }
};

/** GET /api/classroom/admin/votes?classId=&email= — admin JWT only. */
const getAdminVotes = async (req, res) => {
  try {
    const votes = await listVotesForAdmin({
      classId: req.query.classId,
      email: req.query.email,
    });
    return res.status(200).json({ count: votes.length, votes });
  } catch (err) {
    console.error("getAdminVotes error:", err.message);
    return res.status(500).json({ error: "Failed to list votes.", details: err.message });
  }
};

/** GET /api/classroom/admin/history?classId=&email= — admin JWT only.
 *  Every answer a voter replaced, so a flip-flopper is traceable. */
const getAdminHistory = async (req, res) => {
  try {
    const history = await listVoteHistoryForAdmin({
      classId: req.query.classId,
      email: req.query.email,
    });
    return res.status(200).json({ count: history.length, history });
  } catch (err) {
    console.error("getAdminHistory error:", err.message);
    return res.status(500).json({ error: "Failed to list vote history.", details: err.message });
  }
};

/** POST /api/classroom/admin/resettle/:classId — admin JWT only. */
const postResettle = async (req, res) => {
  try {
    const result = await settleClass(req.params.classId, { force: true });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("postResettle error:", err.message);
    return res.status(500).json({ error: "Failed to settle class.", details: err.message });
  }
};

/** POST /api/classroom/admin/sweep — admin JWT only; settles a bounded batch. */
const postSweep = async (_req, res) => {
  try {
    const result = await sweepSettlements();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("postSweep error:", err.message);
    return res.status(500).json({ error: "Sweep failed.", details: err.message });
  }
};

module.exports = {
  postStates,
  postVote,
  getAdminVotes,
  getAdminHistory,
  postResettle,
  postSweep,
};
