const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
// Server-side code uses the service-role key: the anon key is meant for browser
// clients and is refused by row-level security on writes (message CRUD failed
// with "new row violates row-level security policy"). This key bypasses RLS, so
// every query here must stay scoped by the controller — access control for the
// admin routes is the JWT in auth.middleware.js, not RLS.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("⚠️ Missing Supabase credentials in environment variables!");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
