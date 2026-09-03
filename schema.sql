-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.extension_users (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  email text NOT NULL UNIQUE,
  name text,
  gender text,
  orgyear integer,
  cohort text,
  last_sync timestamp with time zone DEFAULT timezone('utc'::text, now()),
  scaler_id text,
  linkedin_profile text,
  slug text,
  role text,
  country text,
  cgr_score numeric,
  avatar_file_name text,
  last_seen timestamp with time zone DEFAULT now(),
  video integer DEFAULT 0,
  audio integer DEFAULT 0,
  transcript integer DEFAULT 0,
  phone_number text,
  CONSTRAINT extension_users_pkey PRIMARY KEY (id)
);
CREATE TABLE public.download_history (
  lecture text NOT NULL,
  email text NOT NULL,
  type text NOT NULL,
  timestamp timestamp with time zone NOT NULL DEFAULT now(),
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  lecture_slug text,
  -- Transcription attribution. Only meaningful when type = 'transcript';
  -- NULL on video/audio rows. source is 'cache' (served from the shared
  -- transcript cache, no API call) or 'generated' (this download ran the model).
  provider text,
  model text,
  source text,
  version_id text,
  CONSTRAINT download_history_transcript_only_meta CHECK (type = 'transcript' OR (provider IS NULL AND model IS NULL AND source IS NULL AND version_id IS NULL))
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type character varying NOT NULL,
  msg text NOT NULL,
  one_time boolean DEFAULT false,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  is_active boolean DEFAULT true,
  priority integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  target_emails ARRAY NOT NULL DEFAULT '{}'::text[],
  target_batches ARRAY NOT NULL DEFAULT '{}'::text[],
  target_domains ARRAY NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT messages_pkey PRIMARY KEY (id)
);
CREATE TABLE public.test_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type character varying NOT NULL,
  msg text NOT NULL,
  one_time boolean DEFAULT false,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  is_active boolean DEFAULT true,
  priority integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  target_emails ARRAY NOT NULL DEFAULT '{}'::text[],
  target_batches ARRAY NOT NULL DEFAULT '{}'::text[],
  target_domains ARRAY NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT test_messages_pkey PRIMARY KEY (id)
);
CREATE TABLE public.transcripts (
  id bigint NOT NULL DEFAULT nextval('transcripts_id_seq'::regclass),
  lecture_id text NOT NULL UNIQUE,
  title text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  class_id bigint,
  generated_by text,
  provider text,
  model text,
  CONSTRAINT transcripts_pkey PRIMARY KEY (id)
);
-- One row per stored transcript version; the text itself lives in MongoDB.
-- Lectures keep every version ever generated — see migrations/001.
CREATE TABLE public.transcript_versions (
  id text NOT NULL,
  lecture_id text NOT NULL,
  title text,
  class_id text,
  provider text,
  model text,
  generated_by text,
  char_count integer,
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT transcript_versions_pkey PRIMARY KEY (id)
);
-- One vote per user per version. Tallies are aggregated on read rather than
-- kept in counter columns, so concurrent votes cannot lose a race.
CREATE TABLE public.transcript_version_votes (
  version_id text NOT NULL,
  lecture_id text NOT NULL,
  email text NOT NULL,
  vote text NOT NULL CHECK (vote IN ('up', 'down')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT transcript_version_votes_pkey PRIMARY KEY (version_id, email)
);
CREATE TABLE public.summaries (
  lecture_id text NOT NULL,
  class_id text,
  title text,
  model text,
  generated_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT summaries_pkey PRIMARY KEY (lecture_id)
);
-- ── Crowdsourced classroom allocation (migrations/002, 003) ──────────────────
-- One row per user per class: their CURRENT answer. Edits are unlimited while
-- the vote window is open; superseded answers move to classroom_vote_history.
CREATE TABLE public.classroom_votes (
  class_id       text NOT NULL,
  email          text NOT NULL,
  room           text NOT NULL CHECK (room IN ('0C','1A','1B','2A','2B1','2B2','2C','online')),
  batch          text,
  subject        text,
  lecture_title  text,
  class_date     date NOT NULL,
  weekday        smallint NOT NULL,
  slot_start     text NOT NULL,
  class_start    timestamptz NOT NULL,
  class_end      timestamptz NOT NULL,
  weight_at_vote numeric NOT NULL DEFAULT 0.5,
  edits          smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_votes_pkey PRIMARY KEY (class_id, email)
);
-- The room a finished class actually happened in. The only table the history
-- prior and the voter accuracy scoring read.
CREATE TABLE public.classroom_settled (
  class_id   text NOT NULL,
  batch      text,
  subject    text,
  weekday    smallint NOT NULL,
  slot_start text NOT NULL,
  class_date date NOT NULL,
  room       text NOT NULL,
  vote_count integer NOT NULL,
  weight_sum numeric NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_settled_pkey PRIMARY KEY (class_id)
);
-- Earned vote weight, fully derivable from the two tables above.
CREATE TABLE public.classroom_voter_stats (
  email      text NOT NULL,
  correct    integer NOT NULL DEFAULT 0,
  incorrect  integer NOT NULL DEFAULT 0,
  weight     numeric NOT NULL DEFAULT 0.5,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_voter_stats_pkey PRIMARY KEY (email)
);
-- Append-only audit trail of replaced answers.
CREATE TABLE public.classroom_vote_history (
  id             bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  class_id       text NOT NULL,
  email          text NOT NULL,
  room           text NOT NULL,
  weight_at_vote numeric NOT NULL,
  cast_at        timestamptz NOT NULL,
  replaced_by    text NOT NULL,
  replaced_at    timestamptz NOT NULL DEFAULT now(),
  edit_number    smallint NOT NULL,
  CONSTRAINT classroom_vote_history_pkey PRIMARY KEY (id)
);
