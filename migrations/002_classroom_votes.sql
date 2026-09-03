-- Crowdsourced classroom allocation.
--
-- Scaler exposes no room/classroom field anywhere, so the room a class happens
-- in is collected from students. Three tables:
--
--   classroom_votes        one row per user per class (authoritative rows, not
--                          counters, so concurrent votes cannot lose a race)
--   classroom_settled      the room that won, written once a class has ended;
--                          the only thing the history prior and the accuracy
--                          scoring ever read
--   classroom_voter_stats  earned weight per voter, fully derivable from the
--                          two tables above
--
-- Purely additive: no existing table or endpoint is touched, so extension
-- builds that predate this feature are unaffected.
--
-- Safe to re-run.

-- ── One row per user per class ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_votes (
  class_id       text NOT NULL,
  email          text NOT NULL,
  room           text NOT NULL CHECK (room IN ('0C','1A','1B','2A','2B1','2B2','2C','online')),
  batch          text,                       -- server-derived, never trusted from the client
  subject        text,                       -- course/module when Scaler exposes one, else NULL
  lecture_title  text,                       -- diagnostic only, never a prior key
  class_date     date NOT NULL,
  weekday        smallint NOT NULL,          -- 0=Sunday .. 6=Saturday, prior tier 2
  slot_start     text NOT NULL,              -- 'HH:MM' 24h local, prior tier 2
  class_start    timestamptz NOT NULL,
  class_end      timestamptz NOT NULL,
  -- Snapshot of the voter's weight at cast time. Never rewritten, so
  -- recomputing voter stats later cannot retroactively change what a past
  -- class displayed.
  weight_at_vote numeric NOT NULL DEFAULT 0.5,
  edits          smallint NOT NULL DEFAULT 0,  -- 0 -> 1, then locked
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_votes_pkey PRIMARY KEY (class_id, email)
);

CREATE INDEX IF NOT EXISTS classroom_votes_class_idx
  ON public.classroom_votes (class_id);

-- Serves both the daily write cap and the admin "what has this person voted" view.
CREATE INDEX IF NOT EXISTS classroom_votes_email_idx
  ON public.classroom_votes (email, created_at DESC);

-- ── The settled room per class ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_settled (
  class_id   text PRIMARY KEY,
  batch      text,
  subject    text,
  weekday    smallint NOT NULL,
  slot_start text NOT NULL,
  class_date date NOT NULL,
  room       text NOT NULL,
  vote_count integer NOT NULL,
  weight_sum numeric NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now()
);

-- Prior tier 1: (batch, subject)
CREATE INDEX IF NOT EXISTS classroom_settled_subject_idx
  ON public.classroom_settled (batch, subject, class_date DESC);

-- Prior tier 2: (batch, weekday, slot_start)
CREATE INDEX IF NOT EXISTS classroom_settled_slot_idx
  ON public.classroom_settled (batch, weekday, slot_start, class_date DESC);

-- Prior tier 3: (batch)
CREATE INDEX IF NOT EXISTS classroom_settled_batch_idx
  ON public.classroom_settled (batch, class_date DESC);

-- ── Earned weight per voter ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_voter_stats (
  email      text PRIMARY KEY,
  correct    integer NOT NULL DEFAULT 0,
  incorrect  integer NOT NULL DEFAULT 0,
  weight     numeric NOT NULL DEFAULT 0.5,
  updated_at timestamptz NOT NULL DEFAULT now()
);
