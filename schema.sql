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