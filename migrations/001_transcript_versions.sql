-- Transcript versioning.
--
-- Replaces the single-transcript-per-lecture cache. The old cache kept
-- whichever transcript had the most BYTES, which systematically preferred the
-- worst output: hallucination loops produce more text, and UTF-8 makes
-- non-Latin scripts ~3x heavier than ASCII, so a wrong-language transcript
-- almost always beat a correct English one. Now every generation is kept and
-- users vote.
--
-- Safe to re-run.

-- ── One row per stored transcript version (metadata only; text lives in Mongo)
CREATE TABLE IF NOT EXISTS public.transcript_versions (
  id             text PRIMARY KEY,              -- sha256(text) prefix, from the extension
  lecture_id     text NOT NULL,
  title          text,
  class_id       text,
  provider       text,
  model          text,
  generated_by   text,
  char_count     integer,
  download_count integer NOT NULL DEFAULT 0,
  created_at     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_versions_lecture_idx
  ON public.transcript_versions (lecture_id, created_at DESC);

-- ── One vote per user per version. Authoritative rows, not counter columns, so
--    concurrent votes cannot lose a race; tallies are aggregated on read.
CREATE TABLE IF NOT EXISTS public.transcript_version_votes (
  version_id text NOT NULL,
  lecture_id text NOT NULL,
  email      text NOT NULL,
  vote       text NOT NULL CHECK (vote IN ('up', 'down')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT transcript_version_votes_pkey PRIMARY KEY (version_id, email)
);

CREATE INDEX IF NOT EXISTS transcript_version_votes_lecture_idx
  ON public.transcript_version_votes (lecture_id);

-- ── download_history records which version was served.
--    version_id is transcript-only like provider/model/source, so the existing
--    CHECK has to be recreated to cover it.
ALTER TABLE public.download_history
  DROP CONSTRAINT IF EXISTS download_history_transcript_only_meta;

ALTER TABLE public.download_history
  ADD COLUMN IF NOT EXISTS version_id text;

ALTER TABLE public.download_history
  ADD CONSTRAINT download_history_transcript_only_meta
  CHECK (
    type = 'transcript'
    OR (provider IS NULL AND model IS NULL AND source IS NULL AND version_id IS NULL)
  );
