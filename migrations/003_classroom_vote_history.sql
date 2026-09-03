-- Vote edit history.
--
-- classroom_votes holds one row per (class_id, email) — the voter's CURRENT
-- answer. Changing your mind is legitimate and common: a room genuinely moves,
-- or you guessed from a notice board and then saw the door. So edits are
-- unlimited while the vote window is open, and every superseded answer is
-- appended here instead of being overwritten into nothing.
--
-- This is also the audit trail: a flip-flopper trying to swing a label near
-- class time leaves one row per flip, with names attached.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.classroom_vote_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id       text NOT NULL,
  email          text NOT NULL,
  -- The answer being replaced, and what it was worth at the moment it was cast.
  room           text NOT NULL,
  weight_at_vote numeric NOT NULL,
  cast_at        timestamptz NOT NULL,     -- when the superseded answer was given
  replaced_by    text NOT NULL,            -- the room it was changed to
  replaced_at    timestamptz NOT NULL DEFAULT now(),
  edit_number    smallint NOT NULL         -- 1 for the first change, 2 for the next…
);

CREATE INDEX IF NOT EXISTS classroom_vote_history_class_idx
  ON public.classroom_vote_history (class_id, replaced_at DESC);

CREATE INDEX IF NOT EXISTS classroom_vote_history_email_idx
  ON public.classroom_vote_history (email, replaced_at DESC);
