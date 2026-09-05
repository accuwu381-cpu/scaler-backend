// ============================================================
// services/classroom.service.js — Supabase I/O for classroom votes
// ─────────────────────────────────────────────────────────────
// All trust math lives in classroomTrust.js (pure, unit-tested). This file only
// reads and writes rows, and is deliberately forgiving on reads: a room tag is
// decoration, and a failed lookup must degrade to "unknown", never break a
// dashboard.
// ============================================================

const supabase = require("./supabase");
const {
  ROOMS,
  VOTE_WINDOW_MS,
  SETTLE_VOTERS,
  weightFor,
  computePrior,
  pickLabel,
  tallyVotes,
  isVotingOpen,
} = require("./classroomTrust");

/** history.replaced_by sentinel for a vote that was taken back, not changed. */
const WITHDRAWN = "withdrawn";
const PRIOR_TIER_LIMIT = 3;
const SWEEP_LIMIT = 20;
const SWEEP_SCAN = 200;

// ── helpers ──────────────────────────────────────────────────────────────────

/** 'HH:MM' in the batch's local day. Times are stored as timestamptz, and the
 *  slot key only has to be *consistent*, so UTC is used for both write and read. */
function slotKeyFrom(startsAtMs) {
  const d = new Date(startsAtMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function weekdayFrom(startsAtMs) {
  return new Date(startsAtMs).getUTCDay();
}

function isKnownRoom(room) {
  return ROOMS.includes(room);
}

/**
 * The course batch a class belongs to — Scaler's `super_batch_name`, e.g.
 * "SST DevOps & Cloud 2028 Batch A". Stored in the `subject` column and used as
 * the primary prediction key, because that is the group which actually shares a
 * room; the `batch` column holds the wider degree cohort.
 *
 * `batch` is accepted as the last fallback on purpose: extension builds that
 * predate the `courseBatch` field already send the same `super_batch_name`
 * string under that name, so installs in the wild start populating course
 * batches the moment this backend deploys, without waiting for a store update.
 *
 * It is client-supplied either way, but every tier that uses it is also scoped
 * to the server-derived cohort, so a made-up value can only muddle the grouping
 * of the sender's own cohort — the same blast radius their votes already have.
 */
function courseBatchFrom(meta) {
  const raw = meta?.courseBatch || meta?.subject || meta?.batch || "";
  return String(raw).trim().slice(0, 200) || null;
}

/**
 * The batch a vote belongs to.
 *
 * Never taken from the request when the server has its own value: a
 * client-supplied batch would let one student write rows into another cohort's
 * prior grouping. The client string is a fallback only for users whose profile
 * sync has not recorded a cohort yet.
 */
async function resolveBatch(email, clientBatch) {
  try {
    const { data, error } = await supabase
      .from("extension_users")
      .select("cohort")
      .eq("email", email)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data?.cohort && String(data.cohort).trim()) return String(data.cohort).trim();
  } catch (err) {
    console.warn("resolveBatch failed:", err.message);
  }

  return (clientBatch || "").trim() || null;
}

async function fetchVoterStats(email) {
  try {
    const { data, error } = await supabase
      .from("classroom_voter_stats")
      .select("correct, incorrect")
      .eq("email", email)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data || null;
  } catch (err) {
    console.warn("fetchVoterStats failed:", err.message);
    return null;
  }
}

/** Every vote for the given classes, in one query. */
async function fetchVotes(classIds) {
  if (!classIds.length) return {};

  const { data, error } = await supabase
    .from("classroom_votes")
    .select("class_id, email, room, weight_at_vote, created_at, class_start, class_end, batch, subject, weekday, slot_start, class_date, edits")
    .in("class_id", classIds);

  if (error) throw new Error(error.message);

  const byClass = {};
  for (const row of data || []) {
    (byClass[row.class_id] ||= []).push(row);
  }
  return byClass;
}

function toBallot(row) {
  return {
    email: row.email,
    room: row.room,
    weightAtVote: Number(row.weight_at_vote) || 0,
    // updated_at is when the CURRENT answer was given. Using created_at would
    // keep an edited vote stuck on the discount its first guess earned, so
    // someone who corrects themselves from the corridor would still count as a
    // day-early guess.
    castAtMs: Date.parse(row.updated_at || row.created_at),
  };
}

/**
 * The prior tiers for one class, newest-first, excluding the class itself.
 *
 * `subject` holds the COURSE BATCH (Scaler's `super_batch_name`), which is the
 * group that actually shares a room; `batch` is the wider degree cohort from
 * `extension_users`. See computePrior for why the tiers narrow in that order.
 *
 * `memo` deduplicates across the classes in one request: the cohort-wide tier
 * is identical for every card on the dashboard, and sessions of the same course
 * share their course tier, so eight cards fire a handful of queries rather than
 * four each.
 */
async function fetchPriorTiers({ classId, batch, subject, weekday, slotStart, memo }) {
  if (!batch) return {};

  // Deliberately NOT filtered by class_id here. Excluding the caller's own
  // class inside the query would make each card's query unique and unshareable;
  // the self-row is dropped in JS below instead. One extra row is fetched so
  // dropping it cannot leave the tier a row short.
  const base = () =>
    supabase
      .from("classroom_settled")
      .select("class_id, room, class_date")
      .eq("batch", batch)
      .order("class_date", { ascending: false })
      .limit(PRIOR_TIER_LIMIT + 1);

  const queries = [];

  if (subject) {
    queries.push([
      "courseSlot",
      `course:${subject}|slot:${weekday}:${slotStart}`,
      () =>
        base()
          .eq("subject", subject)
          .eq("weekday", weekday)
          .eq("slot_start", slotStart),
    ]);
    queries.push(["course", `course:${subject}`, () => base().eq("subject", subject)]);
  }
  queries.push([
    "slot",
    `slot:${weekday}:${slotStart}`,
    () => base().eq("weekday", weekday).eq("slot_start", slotStart),
  ]);
  queries.push(["batch", "batch", () => base()]);

  const tiers = {};
  await Promise.all(
    queries.map(async ([tier, cacheKey, build]) => {
      try {
        // The promise is memoised, not just the result, so concurrent cards
        // share one in-flight query rather than racing to issue their own.
        const key = `${batch}|${cacheKey}`;
        if (memo && !memo.has(key)) memo.set(key, build());
        const { data, error } = await (memo ? memo.get(key) : build());
        if (error) throw new Error(error.message);
        tiers[tier] = (data || [])
          // A class must never be its own evidence.
          .filter((row) => String(row.class_id) !== String(classId))
          .slice(0, PRIOR_TIER_LIMIT)
          .map((row) => ({ room: row.room, classDate: row.class_date }));
      } catch (err) {
        console.warn(`prior tier ${tier} failed:`, err.message);
      }
    }),
  );

  return tiers;
}

// ── settling ─────────────────────────────────────────────────────────────────

/**
 * Freeze the room a finished class actually happened in, then score its voters.
 *
 * Idempotent: an already-settled class is left alone, so a re-run or two
 * concurrent sweeps cannot double-score anyone.
 */
async function settleClass(classId, { force = false } = {}) {
  const { data: existing } = await supabase
    .from("classroom_settled")
    .select("class_id")
    .eq("class_id", classId)
    .maybeSingle();

  if (existing && !force) return { settled: false, reason: "already_settled" };

  const { data: rows, error } = await supabase
    .from("classroom_votes")
    .select("email, room, weight_at_vote, created_at, updated_at, class_start, class_end, batch, subject, weekday, slot_start, class_date")
    .eq("class_id", classId);

  if (error) throw new Error(error.message);
  if (!rows || !rows.length) return { settled: false, reason: "no_votes" };

  const first = rows[0];
  const classStartMs = Date.parse(first.class_start);
  const classEndMs = Date.parse(first.class_end);
  if (Date.now() <= classEndMs && !force) {
    return { settled: false, reason: "not_finished" };
  }

  const ballots = rows.map(toBallot);
  const label = pickLabel({
    prior: null, // settling records what people said, not what history guessed
    votes: ballots,
    classStartMs,
  });

  if (label.source !== "live") return { settled: false, reason: "no_consensus" };

  const winner = tallyVotes(ballots, classStartMs).byRoom[label.room];

  // One voter is enough to SHOW a room — a displayed label is provisional and
  // free to correct. Settling is not: it seeds the prior for every future
  // session of this course and moves each voter's accuracy record, so it holds
  // out for corroboration.
  if (winner.voters < SETTLE_VOTERS) {
    return { settled: false, reason: "needs_corroboration", room: label.room };
  }

  const { error: insertError } = await supabase.from("classroom_settled").upsert(
    {
      class_id: classId,
      batch: first.batch,
      subject: first.subject,
      weekday: first.weekday,
      slot_start: first.slot_start,
      class_date: first.class_date,
      room: label.room,
      vote_count: winner.voters,
      weight_sum: winner.weight,
      settled_at: new Date().toISOString(),
    },
    { onConflict: "class_id" },
  );

  if (insertError) throw new Error(insertError.message);

  await scoreVoters(rows, label.room);

  return { settled: true, room: label.room, voteCount: winner.voters };
}

/**
 * Move every voter of a settled class one step along their track record.
 *
 * Two queries for the whole class, not two per voter: a 40-person class used to
 * mean 80 sequential round trips inside a request that a student was waiting
 * on, since settling runs opportunistically on reads.
 */
async function scoreVoters(rows, settledRoom) {
  try {
    const emails = [...new Set(rows.map((row) => row.email))];
    if (!emails.length) return;

    const { data: existing, error } = await supabase
      .from("classroom_voter_stats")
      .select("email, correct, incorrect")
      .in("email", emails);

    if (error) throw new Error(error.message);

    const byEmail = {};
    for (const row of existing || []) byEmail[row.email] = row;

    const nowIso = new Date().toISOString();
    const updates = rows.map((row) => {
      const stats = byEmail[row.email] || { correct: 0, incorrect: 0 };
      const matched = row.room === settledRoom;
      const correct = (stats.correct || 0) + (matched ? 1 : 0);
      const incorrect = (stats.incorrect || 0) + (matched ? 0 : 1);

      return {
        email: row.email,
        correct,
        incorrect,
        weight: weightFor({ correct, incorrect }),
        updated_at: nowIso,
      };
    });

    const { error: upsertError } = await supabase
      .from("classroom_voter_stats")
      .upsert(updates, { onConflict: "email" });

    if (upsertError) throw new Error(upsertError.message);
  } catch (err) {
    console.warn("scoreVoters failed:", err.message);
  }
}

/**
 * Settle a bounded batch of finished-but-unsettled classes.
 *
 * Called opportunistically on reads so the feature needs no cron — Vercel
 * serverless has nowhere to run one. Bounded so a read never turns into a long
 * job, and errors are swallowed: a stuck sweep must not break a dashboard.
 */
async function sweepSettlements() {
  try {
    const nowIso = new Date().toISOString();

    const { data: finished, error } = await supabase
      .from("classroom_votes")
      .select("class_id, class_end")
      .lt("class_end", nowIso)
      .order("class_end", { ascending: false })
      .limit(SWEEP_SCAN);

    if (error) throw new Error(error.message);

    const candidates = [...new Set((finished || []).map((row) => row.class_id))];
    if (!candidates.length) return { swept: 0 };

    const { data: settled } = await supabase
      .from("classroom_settled")
      .select("class_id")
      .in("class_id", candidates);

    const done = new Set((settled || []).map((row) => row.class_id));
    const pending = candidates.filter((id) => !done.has(id)).slice(0, SWEEP_LIMIT);

    for (const classId of pending) {
      try {
        await settleClass(classId);
      } catch (err) {
        console.warn(`settleClass(${classId}) failed:`, err.message);
      }
    }

    return { swept: pending.length };
  } catch (err) {
    console.warn("sweepSettlements failed:", err.message);
    return { swept: 0 };
  }
}

// ── reads ────────────────────────────────────────────────────────────────────

/**
 * What each class card should display.
 *
 * `classes` carries the metadata because a class nobody has voted on yet has no
 * row anywhere — and that is exactly the case where the history prior matters
 * most. Only `batch` is ignored from the client (see resolveBatch).
 *
 * @param {Array<{classId, subject, classDate, startsAt, endsAt, batch}>} classes
 * @param {string} viewerEmail
 */
async function getClassroomStates(classes, viewerEmail) {
  const email = (viewerEmail || "").trim().toLowerCase();
  const classIds = classes.map((c) => String(c.classId));
  const votesByClass = await fetchVotes(classIds);
  const batch = email ? await resolveBatch(email, classes[0]?.batch) : null;
  const now = Date.now();
  const priorMemo = new Map();

  const states = await Promise.all(
    classes.map(async (meta) => {
      const classId = String(meta.classId);
      const startsAtMs = Date.parse(meta.startsAt);
      const endsAtMs = Date.parse(meta.endsAt);
      const rows = votesByClass[classId] || [];
      const ballots = rows.map(toBallot);

      const tiers = await fetchPriorTiers({
        classId,
        batch,
        subject: courseBatchFrom(meta),
        weekday: weekdayFrom(startsAtMs),
        slotStart: slotKeyFrom(startsAtMs),
        memo: priorMemo,
      });

      const label = pickLabel({
        prior: computePrior(tiers),
        votes: ballots,
        classStartMs: startsAtMs,
      });

      // Head counts per room for the picker. Weights stay server-side: knowing
      // whose vote counts double is exactly the information an abuser needs.
      const tallies = {};
      for (const [room, bucket] of Object.entries(
        tallyVotes(ballots, startsAtMs).byRoom,
      )) {
        tallies[room] = bucket.voters;
      }

      const mine = email ? rows.find((row) => row.email === email) : null;

      return {
        classId,
        room: label.room,
        source: label.source,
        voters: label.voters,
        dissent: label.dissent,
        tallies,
        myVote: mine ? mine.room : null,
        myVoteEdits: mine ? mine.edits || 0 : 0,
        votingOpen: isVotingOpen(now, startsAtMs, endsAtMs),
        rooms: ROOMS,
      };
    }),
  );

  return states;
}

// ── writes ───────────────────────────────────────────────────────────────────

/**
 * Record or change one student's vote.
 *
 * One row per (class_id, email) — the voter's current answer. Edits are
 * unlimited while the window is open, and uncapped: entering a whole published
 * week and then correcting it is the intended workflow, so a write budget would
 * refuse honest work to inconvenience an abuser who is already bounded by the
 * two-voter threshold and named in the audit trail.
 *
 * A class that has ended is closed to everyone, including its own voters — the
 * window check is what makes a past answer permanent.
 *
 * Every superseded answer is appended to classroom_vote_history rather than
 * overwritten away, so a flip-flopper swinging a label near class time leaves
 * an attributable trail. The daily write cap is what bounds the oscillation.
 *
 * `room === null` withdraws: the row is deleted, and the answer it held is
 * appended to history with `replaced_by = 'withdrawn'`. Deleting the row is
 * safe now that edits are unlimited — there is no per-row allowance left to
 * hand back — and it is the honest representation of "I no longer know", which
 * a sentinel room value would not be.
 *
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
async function castVote({ classId, email, room, meta }) {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return { ok: false, reason: "email_required" };

  const withdrawing = room === null || room === undefined || room === "";
  if (!withdrawing && !isKnownRoom(room)) return { ok: false, reason: "bad_room" };

  const startsAtMs = Date.parse(meta.startsAt);
  const endsAtMs = Date.parse(meta.endsAt);
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)) {
    return { ok: false, reason: "bad_times" };
  }

  // The server's own clock decides, never the client's.
  if (!isVotingOpen(Date.now(), startsAtMs, endsAtMs)) {
    return { ok: false, reason: "window_closed" };
  }

  const { data: existing, error: existingError } = await supabase
    .from("classroom_votes")
    .select("class_id, edits, room, weight_at_vote, created_at, updated_at")
    .eq("class_id", String(classId))
    .eq("email", cleanEmail)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  if (withdrawing) {
    // Nothing to take back is not an error — a double click must not 409.
    if (!existing) return { ok: true, unchanged: true };
    return withdrawVote(String(classId), cleanEmail, existing);
  }

  if (existing && existing.room === room) {
    return { ok: true, unchanged: true };
  }

  const batch = await resolveBatch(cleanEmail, meta.batch);
  const weight = weightFor(await fetchVoterStats(cleanEmail));
  const courseBatch = courseBatchFrom(meta);
  const nowIso = new Date().toISOString();

  const row = {
    class_id: String(classId),
    email: cleanEmail,
    room,
    batch,
    subject: courseBatch,
    lecture_title: (meta.lectureTitle || "").trim() || null,
    class_date: meta.classDate,
    weekday: weekdayFrom(startsAtMs),
    slot_start: slotKeyFrom(startsAtMs),
    class_start: new Date(startsAtMs).toISOString(),
    class_end: new Date(endsAtMs).toISOString(),
    weight_at_vote: weight,
    edits: existing ? (existing.edits || 0) + 1 : 0,
    updated_at: nowIso,
  };

  if (!existing) row.created_at = nowIso;

  const { error } = await supabase
    .from("classroom_votes")
    .upsert(row, { onConflict: "class_id,email" });

  if (error) throw new Error(error.message);

  // Appended after the write succeeds: losing an audit row is bad, but losing
  // the vote itself because the audit insert failed would be worse.
  if (existing) {
    await recordVoteHistory({
      classId: String(classId),
      email: cleanEmail,
      previous: existing,
      replacedBy: room,
      editNumber: row.edits,
    });
  }

  return { ok: true, edits: row.edits };
}

/**
 * Delete a voter's answer, keeping the trail.
 *
 * History is written BEFORE the delete here — the opposite order to an edit.
 * Once the row is gone the previous answer is unrecoverable, so if the audit
 * insert fails the withdrawal is refused rather than quietly losing evidence.
 */
async function withdrawVote(classId, email, existing) {
  await recordVoteHistory({
    classId,
    email,
    previous: existing,
    replacedBy: WITHDRAWN,
    editNumber: (existing.edits || 0) + 1,
    required: true,
  });

  const { error } = await supabase
    .from("classroom_votes")
    .delete()
    .eq("class_id", classId)
    .eq("email", email);

  if (error) throw new Error(error.message);

  return { ok: true, withdrawn: true };
}

/** Append the answer a voter just replaced. Never blocks the vote itself. */
async function recordVoteHistory({ classId, email, previous, replacedBy, editNumber, required }) {
  try {
    const { error } = await supabase.from("classroom_vote_history").insert({
      class_id: classId,
      email,
      room: previous.room,
      weight_at_vote: Number(previous.weight_at_vote) || 0,
      cast_at: previous.updated_at || previous.created_at,
      replaced_by: replacedBy,
      edit_number: editNumber,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn("recordVoteHistory failed:", err.message);
    // A withdrawal cannot proceed without its audit row (see withdrawVote).
    if (required) throw err;
  }
}

// ── admin ────────────────────────────────────────────────────────────────────

/** Full attribution — names and emails. Admin JWT only; never sent to a student. */
async function listVotesForAdmin({ classId, email }) {
  let query = supabase
    .from("classroom_votes")
    .select("class_id, email, room, batch, subject, lecture_title, class_date, class_start, weight_at_vote, edits, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (classId) query = query.eq("class_id", String(classId));
  if (email) query = query.eq("email", String(email).trim().toLowerCase());

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const emails = [...new Set((data || []).map((row) => row.email))];
  const names = {};

  if (emails.length) {
    const { data: users } = await supabase
      .from("extension_users")
      .select("email, name, cohort")
      .in("email", emails);

    for (const user of users || []) {
      names[user.email] = { name: user.name, cohort: user.cohort };
    }
  }

  return (data || []).map((row) => ({
    ...row,
    name: names[row.email]?.name || null,
    cohort: names[row.email]?.cohort || null,
  }));
}

/** Every superseded answer, newest first. Admin JWT only. */
async function listVoteHistoryForAdmin({ classId, email }) {
  let query = supabase
    .from("classroom_vote_history")
    .select("class_id, email, room, replaced_by, weight_at_vote, cast_at, replaced_at, edit_number")
    .order("replaced_at", { ascending: false })
    .limit(500);

  if (classId) query = query.eq("class_id", String(classId));
  if (email) query = query.eq("email", String(email).trim().toLowerCase());

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = {
  VOTE_WINDOW_MS,
  getClassroomStates,
  castVote,
  settleClass,
  sweepSettlements,
  listVotesForAdmin,
  listVoteHistoryForAdmin,
  slotKeyFrom,
  weekdayFrom,
};
