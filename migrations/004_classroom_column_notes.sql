-- Documentation-only migration: names what the columns actually hold.
--
-- `subject` was named before it was known what Scaler exposes. It does NOT hold
-- a subject or topic — it holds the COURSE BATCH (Scaler's `super_batch_name`,
-- e.g. "SST DevOps & Cloud 2028 Batch A"), which is the group that actually
-- shares a room and therefore the primary prediction key. `batch` holds the
-- wider degree cohort from extension_users, which can contain several course
-- batches sitting in different rooms at the same hour.
--
-- Renaming the column would break every deployed backend mid-flight, so the
-- meaning is recorded here instead. Safe to re-run; skip it entirely if your
-- Postgres role cannot COMMENT.

COMMENT ON COLUMN public.classroom_votes.subject IS
  'Course batch (Scaler super_batch_name), e.g. "SST DevOps & Cloud 2028 Batch A". NOT a subject/topic. Primary prediction key, always scoped to the batch column.';

COMMENT ON COLUMN public.classroom_votes.batch IS
  'Degree cohort, server-derived from extension_users.cohort. Never taken from the client.';

COMMENT ON COLUMN public.classroom_settled.subject IS
  'Course batch (Scaler super_batch_name). NOT a subject/topic.';

COMMENT ON COLUMN public.classroom_settled.batch IS
  'Degree cohort, server-derived from extension_users.cohort.';
