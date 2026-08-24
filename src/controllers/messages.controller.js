const supabase = require("../services/supabase");
const {
  parseEmail,
  getEmailDomain,
  buildAudienceContext,
  matchesAudience,
  audienceSpecificity,
} = require("../utils/email.utils");

const containsForbiddenTags = (msg) => {
  if (!msg) return false;
  const forbiddenTags = [
    /<\/?html\b[^>]*>/i,
    /<\/?body\b[^>]*>/i,
    /<\/?head\b[^>]*>/i,
    /<\/?iframe\b[^>]*>/i,
    /<\/?style\b[^>]*>/i,
    /<\/?meta\b[^>]*>/i,
    /<\/?title\b[^>]*>/i,
    /<\/?link\b[^>]*>/i,
  ];
  return forbiddenTags.some((tag) => tag.test(msg));
};

const table_name =
  process.env.NODE_ENV === "production" ? "messages" : "test_messages";

// How many active rows we pull before audience filtering. Filtering happens in
// JS, so the DB limit has to be generous enough that a targeted message is not
// hidden behind higher-priority broadcasts.
const ACTIVE_FETCH_LIMIT = 50;
// How many matching messages we hand back to the extension (it renders one).
const ACTIVE_RETURN_LIMIT = 2;

// Caps on the targeting arrays, so a bad admin payload can't blow up the row.
const MAX_TARGET_EMAILS = 500;
const MAX_TARGET_BATCHES = 50;
const MAX_TARGET_DOMAINS = 50;

// Columns an admin is allowed to write through create/update.
const WRITABLE_COLUMNS = [
  "type",
  "msg",
  "one_time",
  "start_time",
  "end_time",
  "is_active",
  "priority",
  "target_emails",
  "target_batches",
  "target_domains",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize one targeting array: trim, drop empties, optionally lowercase,
 * dedupe. Throws an Error (message is user-facing) on a bad shape.
 */
const normalizeTargetArray = (value, { field, max, lowercase, validate }) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings.`);
  }

  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new Error(`${field} must contain strings only.`);
    }
    let item = raw.trim();
    if (!item) continue;
    if (lowercase) item = item.toLowerCase();
    if (validate && !validate(item)) {
      throw new Error(`${field} contains an invalid value: "${item}".`);
    }
    seen.add(item);
  }

  const list = [...seen];
  if (list.length > max) {
    throw new Error(`${field} accepts at most ${max} entries.`);
  }
  return list;
};

/**
 * Pull the audience targeting fields out of a request body.
 * Only the keys actually present are returned, so a PUT that omits them
 * leaves the stored audience untouched.
 */
const normalizeTargets = (body, { fillDefaults }) => {
  const out = {};

  const specs = [
    {
      key: "target_emails",
      max: MAX_TARGET_EMAILS,
      lowercase: true,
      validate: (v) => EMAIL_PATTERN.test(v),
    },
    { key: "target_batches", max: MAX_TARGET_BATCHES, lowercase: false },
    { key: "target_domains", max: MAX_TARGET_DOMAINS, lowercase: true },
  ];

  for (const spec of specs) {
    if (body[spec.key] === undefined && !fillDefaults) continue;
    out[spec.key] = normalizeTargetArray(body[spec.key], {
      field: spec.key,
      max: spec.max,
      lowercase: spec.lowercase,
      validate: spec.validate,
    });
  }

  return out;
};

const getActiveMessages = async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from(table_name)
      .select("*")
      .eq("is_active", true)
      .or(`start_time.is.null,start_time.lte.${now}`)
      .or(`end_time.is.null,end_time.gte.${now}`)
      .order("priority", { ascending: false })
      .limit(ACTIVE_FETCH_LIMIT);

    if (error) throw error;

    // Audience filtering. The email is supplied by the extension and trusted —
    // same model as /api/users/ping and /api/messages/sync-user. A caller with
    // no email only ever receives broadcast messages.
    const audience = buildAudienceContext(req.query.email);
    const matched = data
      .filter((msg) => matchesAudience(msg, audience))
      // The extension renders only the first message, so the more narrowly
      // addressed one wins: specific user > batch/domain > broadcast, and
      // priority decides within the same specificity tier.
      .sort(
        (a, b) =>
          audienceSpecificity(b) - audienceSpecificity(a) ||
          (b.priority || 0) - (a.priority || 0),
      )
      .slice(0, ACTIVE_RETURN_LIMIT);

    return res
      .status(200)
      .json({ success: true, count: matched.length, data: matched });
  } catch (error) {
    console.error("Error fetching active messages:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

const getAllMessages = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(table_name)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("Error fetching all messages:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

const createMessage = async (req, res) => {
  try {
    const { type, msg, one_time, start_time, end_time, is_active, priority } =
      req.body;

    if (containsForbiddenTags(msg)) {
      return res.status(400).json({
        success: false,
        message:
          "Security Error: High-level HTML tags (html, body, iframe, etc.) are not allowed.",
      });
    }

    let targets;
    try {
      targets = normalizeTargets(req.body, { fillDefaults: true });
    } catch (validationError) {
      return res
        .status(400)
        .json({ success: false, message: validationError.message });
    }

    const { data, error } = await supabase
      .from(table_name)
      .insert([
        {
          type,
          msg,
          one_time: one_time || false,
          start_time: start_time || null,
          end_time: end_time || null,
          is_active: is_active !== undefined ? is_active : true,
          priority: priority || 0,
          ...targets,
        },
      ])
      .select();

    if (error) throw error;

    return res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error("Error creating message:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

const updateMessage = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.body.msg && containsForbiddenTags(req.body.msg)) {
      return res.status(400).json({
        success: false,
        message:
          "Security Error: High-level HTML tags (html, body, iframe, etc.) are not allowed.",
      });
    }

    // Whitelist the columns an admin can write, then re-run the same audience
    // normalization as create so an edit can't store a raw/unvalidated array.
    const updates = {};
    for (const column of WRITABLE_COLUMNS) {
      if (req.body[column] !== undefined) updates[column] = req.body[column];
    }

    try {
      Object.assign(updates, normalizeTargets(req.body, { fillDefaults: false }));
    } catch (validationError) {
      return res
        .status(400)
        .json({ success: false, message: validationError.message });
    }

    if (!Object.keys(updates).length) {
      return res
        .status(400)
        .json({ success: false, message: "No updatable fields provided." });
    }

    const { data, error } = await supabase
      .from(table_name)
      .update(updates)
      .eq("id", id)
      .select();

    if (error) throw error;

    if (!data.length) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });
    }

    return res.status(200).json({ success: true, data: data[0] });
  } catch (error) {
    console.error("Error updating message:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase.from(table_name).delete().eq("id", id);

    if (error) throw error;

    return res
      .status(200)
      .json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    console.error("Error deleting message:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/messages/audience-preview
 * Query: batches, domains, emails — each a comma-separated list.
 * Returns how many synced users the given audience would reach, so the admin
 * sees the blast radius before saving. Admin-only.
 */
const PREVIEW_PAGE_SIZE = 1000;
const PREVIEW_MAX_ROWS = 20000;

const previewAudience = async (req, res) => {
  try {
    const splitParam = (value) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];

    const target = {
      target_batches: splitParam(req.query.batches),
      target_domains: splitParam(req.query.domains),
      target_emails: splitParam(req.query.emails),
    };

    const isBroadcast =
      !target.target_batches.length &&
      !target.target_domains.length &&
      !target.target_emails.length;

    if (isBroadcast) {
      const { count, error } = await supabase
        .from("extension_users")
        .select("email", { count: "exact", head: true });
      if (error) throw error;
      return res
        .status(200)
        .json({ success: true, broadcast: true, count: count || 0 });
    }

    // Paged scan — PostgREST caps a plain select at 1000 rows.
    let matches = 0;
    let scanned = 0;
    for (let from = 0; from < PREVIEW_MAX_ROWS; from += PREVIEW_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("extension_users")
        .select("email")
        .range(from, from + PREVIEW_PAGE_SIZE - 1);
      if (error) throw error;
      if (!data.length) break;

      for (const row of data) {
        if (!row.email) continue;
        const email = row.email.trim().toLowerCase();
        const matched = matchesAudience(target, {
          email,
          batch: parseEmail(email)?.batch ?? null,
          domain: getEmailDomain(email),
        });
        if (matched) matches++;
      }

      scanned += data.length;
      if (data.length < PREVIEW_PAGE_SIZE) break;
    }

    return res
      .status(200)
      .json({ success: true, broadcast: false, count: matches, scanned });
  } catch (error) {
    console.error("Error previewing audience:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * Synchronizes user profile information from the extension to Supabase.
 * Uses 'upsert' to prevent duplicate entries for the same user email.
 */
const syncUser = async (req, res) => {
  try {
    const {
      scaler_id,
      name,
      gender,
      email,
      orgyear,
      cohort,
      linkedin_profile,
      slug,
      role,
      country,
      cgr_score,
      avatar_file_name,
    } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    const { data, error } = await supabase
      .from("extension_users")
      .upsert(
        {
          scaler_id,
          name,
          gender,
          email,
          orgyear,
          cohort,
          linkedin_profile,
          slug,
          role,
          country,
          cgr_score,
          avatar_file_name,
          last_sync: new Date().toISOString(),
        },
        { onConflict: "email" },
      )
      .select();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: "User synced successfully",
      data: data[0],
    });
  } catch (error) {
    console.error("Error syncing user:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = {
  getActiveMessages,
  getAllMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  previewAudience,
  syncUser,
};
