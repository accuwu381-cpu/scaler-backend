const supabase = require("../services/supabase");

/**
 * Parse batch year and course from email.
 * Email format: name.{year}{course}{rollno}@sst.scaler.com
 * Example: ritesh.24bcs10088@sst.scaler.com -> batch: '24', course: 'bcs', roll: '10088'
 */
const parseEmail = (email) => {
  try {
    const localPart = email.split("@")[0]; // e.g. ritesh.24bcs10088
    const dotIdx = localPart.lastIndexOf(".");
    if (dotIdx === -1) return null;
    const code = localPart.slice(dotIdx + 1); // e.g. 24bcs10088

    // Match: (2 digit year)(2-3 letter course)(5 digit roll)
    const match = code.match(/^(\d{2})([a-zA-Z]+)(\d{5})$/);
    if (!match) return null;

    return {
      batch: match[1],        // "24"
      course: match[2].toLowerCase(), // "bcs"
      rollNumber: match[3],   // "10088"
    };
  } catch {
    return null;
  }
};

/**
 * GET /api/users
 * Fetch all extension users. Protected by JWT auth.
 */
const getAllUsers = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("extension_users")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Enrich with parsed email fields
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
    console.error("Error fetching users:", error);
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
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const { data, error } = await supabase
      .from("extension_users")
      .update({ last_seen: new Date().toISOString() })
      .eq("email", email)
      .select();

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
    const { email, type } = req.body;

    const allowed = ["video", "audio", "transcript"];
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });
    if (!allowed.includes(type)) return res.status(400).json({ success: false, message: "Invalid type. Must be video, audio, or transcript." });

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

module.exports = { getAllUsers, pingUser, trackDownload };

