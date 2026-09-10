-- Aggregate clicks on one-time custom-message CTAs.
--
-- The extension reports at most once per injected banner. The increment stays
-- inside Postgres so simultaneous clicks cannot overwrite each other.
-- Safe to re-run.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS click_count bigint NOT NULL DEFAULT 0;

ALTER TABLE public.test_messages
  ADD COLUMN IF NOT EXISTS click_count bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_message_click(
  p_message_id uuid,
  p_table_name text DEFAULT 'messages'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count bigint;
BEGIN
  IF p_table_name = 'messages' THEN
    UPDATE public.messages
    SET click_count = click_count + 1
    WHERE id = p_message_id AND one_time IS TRUE
    RETURNING click_count INTO updated_count;
  ELSIF p_table_name = 'test_messages' THEN
    UPDATE public.test_messages
    SET click_count = click_count + 1
    WHERE id = p_message_id AND one_time IS TRUE
    RETURNING click_count INTO updated_count;
  ELSE
    RAISE EXCEPTION 'Unsupported message table: %', p_table_name;
  END IF;

  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_message_click(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_message_click(uuid, text) TO service_role;
