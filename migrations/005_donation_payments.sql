CREATE TABLE IF NOT EXISTS public.donation_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  amount_rupees numeric(10, 2) NOT NULL CHECK (amount_rupees > 0),
  supporter_name text,
  message text,
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  upi_id text NOT NULL DEFAULT '7218548912@sbi',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT donation_payments_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS donation_payments_status_created_idx
  ON public.donation_payments (status, created_at DESC);
