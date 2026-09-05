const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROOMS,
  ESTABLISH_VOTERS,
  OVERRIDE_VOTERS,
  SETTLE_VOTERS,
  weightFor,
  recencyFactor,
  computePrior,
  tallyVotes,
  pickLabel,
  isVotingOpen,
  VOTE_WINDOW_MS,
} = require("../src/services/classroomTrust");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = Date.parse("2026-09-02T08:30:00Z");

// ── weightFor ─────────────────────────────────────────────────────────────────

test("a voter with no settled history is worth half a vote", () => {
  assert.equal(weightFor({ correct: 0, incorrect: 0 }), 0.5);
});

test("a voter with no history at all is worth half a vote", () => {
  assert.equal(weightFor(null), 0.5);
});

test("two correct votes and no misses earns a full vote", () => {
  assert.equal(weightFor({ correct: 2, incorrect: 0 }), 1.0);
});

test("a long clean record earns the 1.25 cap", () => {
  assert.equal(weightFor({ correct: 8, incorrect: 0 }), 1.25);
});

test("the cap tolerates misses while accuracy stays at 0.9", () => {
  assert.equal(weightFor({ correct: 18, incorrect: 2 }), 1.25);
});

test("two misses below 50% accuracy drops a voter to a quarter vote", () => {
  assert.equal(weightFor({ correct: 1, incorrect: 2 }), 0.25);
});

test("four misses below 34% accuracy mutes a voter entirely", () => {
  assert.equal(weightFor({ correct: 1, incorrect: 4 }), 0);
});

test("many misses do not mute a voter whose accuracy stays reasonable", () => {
  assert.equal(weightFor({ correct: 5, incorrect: 4 }), 0.5);
});

test("one miss keeps a voter at the default weight, not the full vote", () => {
  assert.equal(weightFor({ correct: 2, incorrect: 1 }), 0.5);
});

// ── recencyFactor ─────────────────────────────────────────────────────────────

test("a vote cast during the class counts in full", () => {
  assert.equal(recencyFactor(START + 5 * MIN, START), 1.0);
});

test("a vote cast exactly 60 minutes before the class counts in full", () => {
  assert.equal(recencyFactor(START - 60 * MIN, START), 1.0);
});

test("a vote cast just over an hour early is discounted to 0.8", () => {
  assert.equal(recencyFactor(START - 61 * MIN, START), 0.8);
});

test("a vote cast exactly 6 hours early is still 0.8", () => {
  assert.equal(recencyFactor(START - 6 * HOUR, START), 0.8);
});

test("a vote cast more than 6 hours early falls to 0.6", () => {
  assert.equal(recencyFactor(START - 6 * HOUR - 1000, START), 0.6);
});

test("a vote cast a day early is worth 0.6", () => {
  assert.equal(recencyFactor(START - 24 * HOUR, START), 0.6);
});

test("a bulk entry a week ahead still counts, at the same floor", () => {
  // Deliberately not a lower tier: a timetable typed in from the published
  // schedule is real information, and with count-based thresholds this factor
  // only ever breaks ties between rooms.
  assert.equal(recencyFactor(START - 7 * 24 * HOUR, START), 0.6);
});

// ── computePrior ──────────────────────────────────────────────────────────────

const rows = (...roomsNewestFirst) =>
  roomsNewestFirst.map((room, i) => ({ room, classDate: `2026-08-${20 - i}` }));

test("no settled history anywhere yields no prior", () => {
  assert.equal(computePrior({ courseSlot: [], course: [], slot: [], batch: [] }), null);
});

test("the same course at the same hour is the strongest evidence there is", () => {
  // "SST DevOps & Cloud 2028 Batch A, Thursdays at 2pm" — the group that
  // actually shares a room, in the slot it shares it.
  assert.deepEqual(computePrior({ courseSlot: rows("2B1", "2B1", "2B1") }), {
    room: "2B1",
    weight: 1.5,
    tier: "courseSlot",
  });
});

test("two of three identical course-slot sessions give a weak prior", () => {
  assert.deepEqual(computePrior({ courseSlot: rows("2B1", "1A", "2B1") }), {
    room: "2B1",
    weight: 1.0,
    tier: "courseSlot",
  });
});

test("with no history for that hour, the course's other sessions are used", () => {
  const prior = computePrior({
    courseSlot: rows("0C"),
    course: rows("2B1", "2B1", "2B1"),
  });
  assert.deepEqual(prior, { room: "2B1", weight: 1.5, tier: "course" });
});

test("an unknown course falls back to the cohort's habits for that hour", () => {
  const prior = computePrior({
    course: rows("0C", "1A", "2C"),
    slot: rows("2B1", "2B1", "2B1"),
  });
  assert.deepEqual(prior, { room: "2B1", weight: 1.5, tier: "slot" });
});

test("the tiers are tried most specific first", () => {
  // Every tier has evidence; the course-slot tier must win.
  const prior = computePrior({
    courseSlot: rows("0C", "0C"),
    course: rows("1A", "1A", "1A"),
    slot: rows("2A", "2A", "2A"),
    batch: rows("2C", "2C", "2C"),
  });
  assert.equal(prior.tier, "courseSlot");
  assert.equal(prior.room, "0C");
});

test("only the three most recent sessions in a tier are considered", () => {
  // Four rows: the oldest 2B2 must be ignored, leaving 1A twice out of three.
  const prior = computePrior({ courseSlot: rows("1A", "2C", "1A", "2B2") });
  assert.deepEqual(prior, { room: "1A", weight: 1.0, tier: "courseSlot" });
});

test("the batch-wide tier is penalised by half a point", () => {
  assert.deepEqual(computePrior({ batch: rows("2A", "2A", "2A") }), {
    room: "2A",
    weight: 1.0,
    tier: "batch",
  });
});

test("a weak batch-wide prior is worth only half a point", () => {
  assert.deepEqual(computePrior({ batch: rows("2A", "1B", "2A") }), {
    room: "2A",
    weight: 0.5,
    tier: "batch",
  });
});

test("a tie inside a tier is broken by the most recent session", () => {
  const prior = computePrior({ courseSlot: rows("1A", "2B1", "2B1", "1A") });
  // Newest-first 1A, 2B1, 2B1 -> 2B1 wins on count, not recency.
  assert.equal(prior.room, "2B1");
  const tied = computePrior({ courseSlot: rows("1A", "2B1") });
  assert.equal(tied, null, "a 1-1 split is no evidence at all");
});

// ── tallyVotes ────────────────────────────────────────────────────────────────

// `castAtMs` is when the CURRENT answer was given, not when the voter first
// touched the class: an edited vote is evidence as of its edit.
const vote = (email, room, weight, castMs) => ({
  email,
  room,
  weightAtVote: weight,
  castAtMs: castMs,
});

test("a tally sums effective weight and counts distinct voters per room", () => {
  const tally = tallyVotes(
    [
      vote("a@x.com", "2B1", 1.0, START - 10 * MIN),
      vote("b@x.com", "2B1", 1.0, START - 10 * MIN),
      vote("c@x.com", "1A", 0.5, START - 10 * MIN),
    ],
    START,
  );
  assert.deepEqual(tally.byRoom["2B1"], { weight: 2.0, voters: 2 });
  assert.deepEqual(tally.byRoom["1A"], { weight: 0.5, voters: 1 });
  assert.equal(tally.top.room, "2B1");
});

test("a muted voter contributes neither weight nor a head count", () => {
  const tally = tallyVotes(
    [
      vote("muted@x.com", "0C", 0, START - 10 * MIN),
      vote("also@x.com", "0C", 0, START - 10 * MIN),
    ],
    START,
  );
  assert.equal(tally.byRoom["0C"], undefined);
  assert.equal(tally.top, null);
});

test("an early vote is tallied at its discounted weight", () => {
  const tally = tallyVotes([vote("a@x.com", "1B", 1.0, START - 20 * HOUR)], START);
  assert.equal(tally.byRoom["1B"].weight, 0.6);
});

// ── pickLabel ─────────────────────────────────────────────────────────────────

const at = (offsetMs) => START + offsetMs;

test("with nothing else known, one vote is enough to show a room", () => {
  // Somebody standing in the doorway beats showing "Room : ?" to everyone.
  const label = pickLabel({
    prior: null,
    votes: [vote("a@x.com", "1A", 0.5, at(-10 * MIN))],
    classStartMs: START,
  });
  assert.equal(label.source, "live");
  assert.equal(label.room, "1A");
  assert.equal(label.voters, 1);
});

test("one vote a day early still establishes a label", () => {
  const label = pickLabel({
    prior: null,
    votes: [vote("a@x.com", "2B1", 0.5, at(-20 * HOUR))],
    classStartMs: START,
  });
  assert.equal(label.source, "live");
  assert.equal(label.room, "2B1");
});

test("a muted voter alone establishes nothing", () => {
  const label = pickLabel({
    prior: null,
    votes: [vote("banned@x.com", "0C", 0, at(-10 * MIN))],
    classStartMs: START,
  });
  assert.equal(label.source, "none");
  assert.equal(label.room, null);
});

test("two established voters a day early do establish a label", () => {
  const label = pickLabel({
    prior: null,
    votes: [
      vote("a@x.com", "2B1", 1.0, at(-20 * HOUR)),
      vote("b@x.com", "2B1", 1.0, at(-20 * HOUR)),
    ],
    classStartMs: START,
  });
  assert.equal(label.source, "live");
  assert.equal(label.room, "2B1");
});

test("with no votes the history prior holds the label", () => {
  const label = pickLabel({
    prior: { room: "2B1", weight: 1.5, tier: "subject" },
    votes: [],
    classStartMs: START,
  });
  assert.equal(label.source, "history");
  assert.equal(label.room, "2B1");
  assert.equal(label.dissent, null);
});

test("one dissenting voter shows up beside the prior without moving it", () => {
  const label = pickLabel({
    prior: { room: "2B1", weight: 1.5, tier: "subject" },
    votes: [vote("a@x.com", "1A", 1.0, at(-10 * MIN))],
    classStartMs: START,
  });
  assert.equal(label.room, "2B1");
  assert.equal(label.source, "history");
  assert.deepEqual(label.dissent, { room: "1A", voters: 1 });
});

test("two people agreeing overturn a prior, however strong it was", () => {
  const label = pickLabel({
    prior: { room: "2B1", weight: 1.5, tier: "subject" },
    votes: [
      vote("a@x.com", "1A", 0.5, at(-10 * MIN)),
      vote("b@x.com", "1A", 0.5, at(-10 * MIN)),
    ],
    classStartMs: START,
  });
  assert.equal(label.room, "1A");
  assert.equal(label.source, "live");
});

test("one voter cannot overturn a prior on their own", () => {
  const label = pickLabel({
    prior: { room: "2B1", weight: 1.0, tier: "slot" },
    votes: [vote("a@x.com", "1A", 1.25, at(-10 * MIN))],
    classStartMs: START,
  });
  assert.equal(label.room, "2B1");
  assert.equal(label.source, "history");
  assert.deepEqual(label.dissent, { room: "1A", voters: 1 });
});

test("two voters split one-one leave a prior standing", () => {
  const label = pickLabel({
    prior: { room: "2B1", weight: 1.0, tier: "slot" },
    votes: [
      vote("a@x.com", "1A", 1.0, at(-10 * MIN)),
      vote("b@x.com", "2C", 1.0, at(-10 * MIN)),
    ],
    classStartMs: START,
  });
  assert.equal(label.room, "2B1", "neither challenger reached two voters");
  assert.equal(label.source, "history");
});

test("the room with the most people wins, not the most trusted single voter", () => {
  // "Show the majority" means heads first; weight only breaks ties.
  const label = pickLabel({
    prior: null,
    votes: [
      vote("trusted@x.com", "0C", 1.25, at(-10 * MIN)),
      vote("a@x.com", "1A", 0.5, at(-10 * MIN)),
      vote("b@x.com", "1A", 0.5, at(-10 * MIN)),
    ],
    classStartMs: START,
  });
  assert.equal(label.room, "1A");
  assert.equal(label.voters, 2);
  assert.deepEqual(label.dissent, { room: "0C", voters: 1 });
});

test("an even split is broken by weight, so the fresher report wins", () => {
  const label = pickLabel({
    prior: null,
    votes: [
      vote("a@x.com", "1A", 1.0, at(-20 * HOUR)),
      vote("b@x.com", "2C", 1.0, at(-5 * MIN)),
    ],
    classStartMs: START,
  });
  assert.equal(label.room, "2C");
});

test("three established voters overturn a strong prior in one round", () => {
  const label = pickLabel({
    prior: { room: "2B1", weight: 1.5, tier: "subject" },
    votes: [
      vote("a@x.com", "1A", 1.0, at(-10 * MIN)),
      vote("b@x.com", "1A", 1.0, at(-10 * MIN)),
      vote("c@x.com", "1A", 1.0, at(-10 * MIN)),
    ],
    classStartMs: START,
  });
  assert.equal(label.room, "1A");
  assert.equal(label.source, "live");
  assert.deepEqual(label.dissent, null);
});

test("live votes that agree with the prior upgrade the label to live", () => {
  const label = pickLabel({
    prior: { room: "2B1", weight: 1.5, tier: "subject" },
    votes: [
      vote("a@x.com", "2B1", 0.5, at(-10 * MIN)),
      vote("b@x.com", "2B1", 0.5, at(-10 * MIN)),
    ],
    classStartMs: START,
  });
  assert.equal(label.room, "2B1");
  assert.equal(label.source, "live");
  assert.equal(label.voters, 2);
});

test("the dissent line reports the strongest losing room only", () => {
  const label = pickLabel({
    prior: null,
    votes: [
      vote("a@x.com", "2B1", 1.0, at(-10 * MIN)),
      vote("b@x.com", "2B1", 1.0, at(-10 * MIN)),
      vote("c@x.com", "1A", 1.0, at(-10 * MIN)),
      vote("d@x.com", "0C", 0.5, at(-10 * MIN)),
    ],
    classStartMs: START,
  });
  assert.equal(label.room, "2B1");
  assert.deepEqual(label.dissent, { room: "1A", voters: 1 });
});

// ── isVotingOpen ──────────────────────────────────────────────────────────────

const END = START + 2 * HOUR;

test("voting opens a week before the class starts", () => {
  // The whole week's timetable is published at once, so one person can enter
  // every room for the week instead of everyone re-reporting each morning.
  assert.equal(isVotingOpen(START - 7 * 24 * HOUR, START, END), true);
});

test("voting is closed a second before the week-long window", () => {
  assert.equal(isVotingOpen(START - 7 * 24 * HOUR - 1000, START, END), false);
});

test("a vote three days ahead is inside the window", () => {
  assert.equal(isVotingOpen(START - 3 * 24 * HOUR, START, END), true);
});

test("voting is open while the class is running", () => {
  assert.equal(isVotingOpen(START + 30 * MIN, START, END), true);
});

test("voting closes when the class ends", () => {
  assert.equal(isVotingOpen(END, START, END), true);
  assert.equal(isVotingOpen(END + 1000, START, END), false);
});

test("a past class is closed to its own voters too", () => {
  // The window is what makes an answer permanent: once the class is over
  // nobody can revise what they said, including the people who said it.
  const yesterday = START - 24 * HOUR;
  assert.equal(isVotingOpen(Date.now(), yesterday, yesterday + 2 * HOUR), false);
});

test("the thresholds are one voter to establish, two to override", () => {
  assert.equal(ESTABLISH_VOTERS, 1);
  assert.equal(OVERRIDE_VOTERS, 2);
  assert.equal(SETTLE_VOTERS, 2);
});

test("the window constant is a week", () => {
  assert.equal(VOTE_WINDOW_MS, 7 * 24 * HOUR);
});

test("every room the schema allows is offered, online included", () => {
  assert.deepEqual(ROOMS, ["0C", "1A", "1B", "2A", "2B1", "2B2", "2C", "online"]);
});

test("an edited vote is weighted from the edit, not the original cast", () => {
  // Voted a day early (0.6), changed their mind from the corridor (1.0).
  const edited = tallyVotes(
    [{ email: "a@x.com", room: "1A", weightAtVote: 1.0, castAtMs: START - 10 * MIN }],
    START,
  );
  assert.equal(edited.byRoom["1A"].weight, 1.0);
});

test("a vote carrying only a legacy createdAtMs is not silently zeroed", () => {
  // Defensive: rows written before the rename must not lose their recency.
  const legacy = tallyVotes(
    [{ email: "a@x.com", room: "1A", weightAtVote: 1.0, createdAtMs: START - 20 * HOUR }],
    START,
  );
  assert.equal(legacy.byRoom["1A"].weight, 0.6);
});
