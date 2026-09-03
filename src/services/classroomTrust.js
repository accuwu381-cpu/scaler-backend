// ============================================================
// services/classroomTrust.js — pure trust math for classroom votes
// ─────────────────────────────────────────────────────────────
// No I/O, no Supabase, no clock reads: every function takes its inputs and
// returns a value, which is why the whole trust model is unit-testable
// (tests/classroomTrust.test.js).
//
// The problem this solves: a room label is a single mutable value crowdsourced
// from a few dozen students, with no way to verify anyone is actually standing
// in the room. Raw majority is unsafe at that scale — two people can move it.
// So a label moves only when enough *earned* weight, cast close enough to the
// class, agrees.
// ============================================================

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Every votable value. `online` is a real answer, not a placeholder. */
const ROOMS = ["0C", "1A", "1B", "2A", "2B1", "2B2", "2C", "online"];

/** Voting opens this far before a class starts and closes at its end. */
const VOTE_WINDOW_MS = 24 * HOUR_MS;

// Thresholds are counts of people, not sums of weight. Weight still decides
// which room leads when heads are tied, and a muted voter still counts as
// nobody — but "two people agree" is a rule a student can hold in their head,
// and a rule nobody understands is a rule nobody trusts.

/** Voters needed to put a room on a class that has no room at all. */
const ESTABLISH_VOTERS = 1;

/** Voters needed to replace a room that is already showing. */
const OVERRIDE_VOTERS = 2;

/**
 * Voters needed before a finished class is written into permanent history.
 *
 * Deliberately stricter than ESTABLISH_VOTERS. A displayed room is provisional
 * and costs nothing to correct; a settled room seeds the prior for every future
 * session of that course AND moves the voters' accuracy records. One person's
 * word is enough to help their classmates today, not enough to become history.
 */
const SETTLE_VOTERS = 2;

/** Sums of 0.6-style factors drift in binary; keep comparisons predictable. */
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * How much one voter's ballot is worth, from their settled track record.
 *
 * Evaluated top-down, first match wins. A muted voter (0) still has their vote
 * stored and still gets scored at settling — they are simply not counted, and
 * are never told, because telling them turns muting into a puzzle to solve.
 *
 * @param {{correct?: number, incorrect?: number}|null} stats
 * @returns {number}
 */
function weightFor(stats) {
  const correct = stats?.correct || 0;
  const incorrect = stats?.incorrect || 0;
  const total = correct + incorrect;
  const accuracy = total ? correct / total : 0;

  if (incorrect >= 4 && accuracy < 0.34) return 0;
  if (incorrect >= 2 && accuracy < 0.5) return 0.25;
  if (correct >= 8 && accuracy >= 0.9) return 1.25;
  if (correct >= 2 && incorrect === 0) return 1.0;
  return 0.5;
}

/**
 * Discount for how far ahead of the class a vote was cast.
 *
 * A vote from someone in the corridor is better evidence than one from
 * yesterday evening — but yesterday evening still carries real information
 * (a notice board, a message in the batch group), so it is discounted, not
 * discarded.
 *
 * @param {number} castMs      when the vote was cast
 * @param {number} classStartMs
 * @returns {1|0.8|0.6}
 */
function recencyFactor(castMs, classStartMs) {
  const lead = classStartMs - castMs; // negative once the class has started
  if (lead <= 60 * MINUTE_MS) return 1.0;
  if (lead <= 6 * HOUR_MS) return 0.8;
  return 0.6;
}

/**
 * Mode of a newest-first list of settled rooms, ties broken by recency.
 * Returns null when nothing repeats — three different rooms is no evidence.
 */
function _mode(roomsNewestFirst) {
  const counts = new Map();
  roomsNewestFirst.forEach((room) => {
    counts.set(room, (counts.get(room) || 0) + 1);
  });

  let best = null;
  let bestCount = 0;
  // Iterating newest-first means the first room to reach a count wins the tie.
  for (const room of roomsNewestFirst) {
    const count = counts.get(room);
    if (count > bestCount) {
      best = room;
      bestCount = count;
    }
  }

  return bestCount >= 2 ? { room: best, count: bestCount } : null;
}

/**
 * The history-based prediction, from the most specific tier that has evidence.
 *
 * Tiers, in order: the same course for this batch, then the same weekday+slot
 * for this batch, then anything this batch has done. The batch-wide tier is the
 * weakest claim about *this* class, so it is penalised.
 *
 * @param {{subject?: Array, slot?: Array, batch?: Array}} tiers
 *        each an array of `{room}` rows ordered newest first
 * @returns {{room: string, weight: number, tier: string}|null}
 */
function computePrior(tiers) {
  const order = [
    ["subject", tiers?.subject, 0],
    ["slot", tiers?.slot, 0],
    ["batch", tiers?.batch, 0.5],
  ];

  for (const [tier, rows, penalty] of order) {
    const recent = (rows || []).slice(0, 3).map((row) => row.room);
    if (recent.length < 2) continue;

    const mode = _mode(recent);
    if (!mode) continue;

    const base = mode.count >= 3 ? 1.5 : 1.0;
    return { room: mode.room, weight: round4(base - penalty), tier };
  }

  return null;
}

/**
 * Aggregate ballots into per-room weight and head counts.
 *
 * Muted voters are dropped here rather than at read time in the caller, so
 * they cannot leak into a displayed count either.
 *
 * `castAtMs` is when the voter's CURRENT answer was given. For an edited vote
 * that is the edit, not the first cast: someone who guessed a day early and
 * corrected themselves from the corridor is corridor-grade evidence now.
 * `createdAtMs` is accepted as a fallback so a caller that has only the
 * original timestamp still gets a sane discount instead of silently scoring 0.
 *
 * @param {Array<{email: string, room: string, weightAtVote: number, castAtMs: number}>} votes
 * @param {number} classStartMs
 * @returns {{byRoom: Object, top: {room: string, weight: number, voters: number}|null}}
 */
function tallyVotes(votes, classStartMs) {
  const byRoom = {};

  (votes || []).forEach((vote) => {
    const castAt = vote.castAtMs ?? vote.createdAtMs;
    const effective = round4(
      (vote.weightAtVote || 0) * recencyFactor(castAt, classStartMs),
    );
    if (effective <= 0) return;

    const bucket = (byRoom[vote.room] ||= { weight: 0, voters: 0 });
    bucket.weight = round4(bucket.weight + effective);
    bucket.voters += 1;
  });

  const top = _rankRooms(byRoom)[0] || null;
  return { byRoom, top };
}

/**
 * Rooms strongest first: head count, then weight, then name — always stable.
 *
 * Heads lead because the card promises the majority. Weight breaks ties, which
 * is what makes an even split resolve toward the fresher, better-earned report
 * rather than toward whichever row the database happened to return first.
 */
function _rankRooms(byRoom, excludeRoom) {
  return Object.entries(byRoom)
    .filter(([room]) => room !== excludeRoom)
    .map(([room, bucket]) => ({ room, ...bucket }))
    .sort(
      (a, b) =>
        b.voters - a.voters || b.weight - a.weight || a.room.localeCompare(b.room),
    );
}

/**
 * Decide what a class card should say.
 *
 * The label is recomputed from scratch on every read — nothing is persisted —
 * so there is no stored label to drift, and a vote being withdrawn or a class
 * settling can never leave a stale value behind. That also means the standing
 * value a challenger has to beat is always the *prior*: among live rooms the
 * strongest simply wins, because they are all live evidence of the same kind.
 *
 * @param {{prior: object|null, votes: Array, classStartMs: number}} input
 * @returns {{room: string|null, source: "live"|"history"|"none", voters: number,
 *            dissent: {room: string, voters: number}|null}}
 */
function pickLabel({ prior, votes, classStartMs }) {
  const { byRoom, top } = tallyVotes(votes, classStartMs);

  const fallback = () => {
    const room = prior ? prior.room : null;
    const runnerUp = _rankRooms(byRoom, room)[0];
    return {
      room,
      source: prior ? "history" : "none",
      voters: room ? byRoom[room]?.voters || 0 : 0,
      dissent: runnerUp ? { room: runnerUp.room, voters: runnerUp.voters } : null,
    };
  };

  if (!top) return fallback();

  // Nothing is showing yet, or the votes agree with what is: one person is
  // enough. Contradicting a room that is already on the card needs two, so no
  // single student can move a crowd — including a student who is simply wrong.
  const agreesWithPrior = prior && prior.room === top.room;
  const needed = !prior || agreesWithPrior ? ESTABLISH_VOTERS : OVERRIDE_VOTERS;

  if (top.voters < needed) return fallback();

  const runnerUp = _rankRooms(byRoom, top.room)[0];
  return {
    room: top.room,
    source: "live",
    voters: top.voters,
    dissent: runnerUp ? { room: runnerUp.room, voters: runnerUp.voters } : null,
  };
}

/** True while a class is inside its voting window. */
function isVotingOpen(nowMs, classStartMs, classEndMs) {
  return nowMs >= classStartMs - VOTE_WINDOW_MS && nowMs <= classEndMs;
}

module.exports = {
  ROOMS,
  VOTE_WINDOW_MS,
  ESTABLISH_VOTERS,
  OVERRIDE_VOTERS,
  SETTLE_VOTERS,
  weightFor,
  recencyFactor,
  computePrior,
  tallyVotes,
  pickLabel,
  isVotingOpen,
};
