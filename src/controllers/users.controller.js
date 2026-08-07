const supabase = require("../services/supabase");
// parseEmail is shared with the messages controller (audience targeting).
const { parseEmail } = require("../utils/email.utils");

// ─── Helpers for query building ──────────────────────────────────────────────

/**
 * Allowed sort columns that map directly to Supabase columns.
 * 'rollNumber' is NOT here because it's derived from email.
 */
const SORTABLE_COLUMNS = [
  "name",
  "email",
  "cgr_score",
  "last_seen",
  "created_at",
  "video",
  "audio",
  "transcript",
];

/**
 * Apply shared filter logic to a Supabase query builder.
 * Used by both getPaginatedUsers and exportUsers so filters stay consistent.
 */
const applyFilters = (query, { search, gender, cohort, country, batch, activeOnly }) => {
  // Text search on name and email (email contains roll number anyway)
  if (search) {
    const q = `%${search}%`;
    query = query.or(`name.ilike.${q},email.ilike.${q}`);
  }

  // Gender filter
  if (gender && gender !== "all") {
    if (gender === "not_guessed") {
      query = query.is("gender", null);
    } else {
      query = query.eq("gender", gender);
    }
  }

  // Cohort filter
  if (cohort && cohort !== "all") {
    query = query.eq("cohort", cohort);
  }

  // Country filter
  if (country && country !== "all") {
    query = query.eq("country", country);
  }

  // Batch filter — batch is derived from email pattern: name.{YY}{course}{roll}@sst.scaler.com
  // e.g. batch "24" → emails matching %.24%@sst.scaler.com
  if (batch && batch !== "all") {
    query = query.ilike("email", `%.${batch}%@sst.scaler.com`);
  }

  // Active-only filter: last_seen within the last 7 days
  if (activeOnly === "true") {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("last_seen", sevenDaysAgo);
  }

  return query;
};

/**
 * GET /api/users
 * Server-side paginated, filtered, sorted user listing.
 * Protected by JWT auth.
 *
 * Query params:
 *   page (default 1), limit (default 100),
 *   search, gender, cohort, country, batch, activeOnly,
 *   sortField (default "created_at"), sortDir (default "desc")
 */
const getPaginatedUsers = async (req, res) => {
  try {
    const {
      page = "1",
      limit = "100",
      search = "",
      gender = "all",
      cohort = "all",
      country = "all",
      batch = "all",
      activeOnly = "false",
      sortField = "created_at",
      sortDir = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
    const offset = (pageNum - 1) * limitNum;

    // Validate sort field
    const safeSortField = SORTABLE_COLUMNS.includes(sortField) ? sortField : "created_at";
    const ascending = sortDir === "asc";

    // ── Main data query ────────────────────────────────────────────────────
    let dataQuery = supabase
      .from("extension_users")
      .select("*", { count: "exact" });

    dataQuery = applyFilters(dataQuery, { search, gender, cohort, country, batch, activeOnly });
    dataQuery = dataQuery
      .order(safeSortField, { ascending, nullsFirst: false })
      .range(offset, offset + limitNum - 1);

    const { data, error, count } = await dataQuery;
    if (error) throw error;

    // ── Stats query (same filters, no pagination) ──────────────────────────
    // Fetch only the columns needed for aggregation
    let statsQuery = supabase
      .from("extension_users")
      .select("gender, video, audio, transcript");

    statsQuery = applyFilters(statsQuery, { search, gender, cohort, country, batch, activeOnly });

    const { data: statsRows, error: statsError } = await statsQuery;
    if (statsError) throw statsError;

    const stats = {
      total: count ?? 0,
      male: 0,
      female: 0,
      unknown: 0,
      totalVideo: 0,
      totalAudio: 0,
      totalTranscript: 0,
    };

    for (const row of statsRows) {
      if (row.gender === "male") stats.male++;
      else if (row.gender === "female") stats.female++;
      else stats.unknown++;
      stats.totalVideo += row.video ?? 0;
      stats.totalAudio += row.audio ?? 0;
      stats.totalTranscript += row.transcript ?? 0;
    }

    // Enrich the current page with parsed email fields
    const enriched = data.map((user) => {
      const parsed = parseEmail(user.email);
      return {
        ...user,
        batch: parsed?.batch ?? null,
        course: parsed?.course ?? null,
        rollNumber: parsed?.rollNumber ?? null,
      };
    });

    const totalPages = Math.ceil((count ?? 0) / limitNum);

    return res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count ?? 0,
        totalPages,
      },
      stats,
    });
  } catch (error) {
    console.error("Error fetching paginated users:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/users/filters
 * Returns distinct values for filter dropdowns.
 * Protected by JWT auth.
 */
const getFilterOptions = async (req, res) => {
  try {
    // Fetch distinct cohorts
    const { data: cohortRows, error: cohortErr } = await supabase
      .from("extension_users")
      .select("cohort")
      .not("cohort", "is", null)
      .order("cohort", { ascending: true });
    if (cohortErr) throw cohortErr;
    const cohorts = [...new Set(cohortRows.map((r) => r.cohort))];

    // Fetch distinct countries
    const { data: countryRows, error: countryErr } = await supabase
      .from("extension_users")
      .select("country")
      .not("country", "is", null)
      .order("country", { ascending: true });
    if (countryErr) throw countryErr;
    const countries = [...new Set(countryRows.map((r) => r.country))];

    // Derive distinct batches from emails
    const { data: emailRows, error: emailErr } = await supabase
      .from("extension_users")
      .select("email");
    if (emailErr) throw emailErr;

    const batchSet = new Set();
    for (const row of emailRows) {
      const parsed = parseEmail(row.email);
      if (parsed?.batch) batchSet.add(parsed.batch);
    }
    const batches = [...batchSet].sort();

    return res.status(200).json({
      success: true,
      cohorts,
      countries,
      batches,
    });
  } catch (error) {
    console.error("Error fetching filter options:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/users/export
 * Returns ALL users matching the given filters (no pagination).
 * Capped at 10 000 rows for safety. Used for CSV export.
 * Protected by JWT auth.
 */
const exportUsers = async (req, res) => {
  try {
    const {
      search = "",
      gender = "all",
      cohort = "all",
      country = "all",
      batch = "all",
      activeOnly = "false",
      sortField = "created_at",
      sortDir = "desc",
    } = req.query;

    const safeSortField = SORTABLE_COLUMNS.includes(sortField) ? sortField : "created_at";
    const ascending = sortDir === "asc";

    let query = supabase
      .from("extension_users")
      .select("*");

    query = applyFilters(query, { search, gender, cohort, country, batch, activeOnly });
    query = query
      .order(safeSortField, { ascending, nullsFirst: false })
      .limit(10000);

    const { data, error } = await query;
    if (error) throw error;

    const enriched = data.map((user) => {
      const parsed = parseEmail(user.email);
      return {
        ...user,
        batch: parsed?.batch ?? null,
        course: parsed?.course ?? null,
        rollNumber: parsed?.rollNumber ?? null,
      };
    });

    return res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched,
    });
  } catch (error) {
    console.error("Error exporting users:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * POST /api/users/ping
 * Updates the last_seen timestamp for a user.
 * Public endpoint used by the extension.
 */
const pingUser = async (req, res) => {
  try {
    const { email } = req.body;
    console.log("[Ping Debug] Incoming ping request for email:", email);
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    // Debug check: does the user exist at all?
    const { data: existingUser, error: checkError } = await supabase
      .from("extension_users")
      .select("*")
      .eq("email", email);
    console.log("[Ping Debug] Check existing user query result:", { existingUser, checkError });

    const { data, error } = await supabase
      .from("extension_users")
      .update({ last_seen: new Date().toISOString() })
      .eq("email", email)
      .select();

    console.log("[Ping Debug] Update user result:", { data, error });

    if (error) throw error;
    if (!data.length) return res.status(404).json({ success: false, message: "User not found" });

    return res.status(200).json({ success: true, message: "Last seen updated" });
  } catch (error) {
    console.error("Error pinging user:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * POST /api/users/download
 * Increments the download counter (video | audio | transcript) for a user.
 * Public endpoint — called by the extension.
 */
const trackDownload = async (req, res) => {
  try {
    const { email, type, lecture, lectureSlug } = req.body;

    const allowed = ["video", "audio", "transcript"];
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });
    if (!allowed.includes(type)) return res.status(400).json({ success: false, message: "Invalid type. Must be video, audio, or transcript." });

    // Insert into separate tracking table
    if (lecture || lectureSlug) {
      const { error: insertError } = await supabase
        .from("download_history")
        .insert([{ email, type, lecture, lecture_slug: lectureSlug || null }]);
      
      if (insertError) {
        console.error("Error inserting into download_history:", insertError);
        // non-blocking for the counter
      }
    }

    // Fetch current count first, then increment
    const { data: user, error: fetchError } = await supabase
      .from("extension_users")
      .select(`${type}`)
      .eq("email", email)
      .single();

    if (fetchError || !user) return res.status(404).json({ success: false, message: "User not found" });

    const newCount = (user[type] ?? 0) + 1;

    const { error: updateError } = await supabase
      .from("extension_users")
      .update({ [type]: newCount })
      .eq("email", email);

    if (updateError) throw updateError;

    return res.status(200).json({ success: true, type, count: newCount });
  } catch (error) {
    console.error("Error tracking download:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { getPaginatedUsers, getFilterOptions, exportUsers, pingUser, trackDownload };

