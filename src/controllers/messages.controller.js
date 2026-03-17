const supabase = require("../services/supabase");

const containsForbiddenTags = (msg) => {
  if (!msg) return false;
  const forbiddenTags = [
    /<\/?html\b[^>]*>/i, 
    /<\/?body\b[^>]*>/i, 
    /<\/?head\b[^>]*>/i, 
    /<\/?script\b[^>]*>/i, 
    /<\/?iframe\b[^>]*>/i, 
    /<\/?style\b[^>]*>/i,
    /<\/?meta\b[^>]*>/i,
    /<\/?title\b[^>]*>/i,
    /<\/?link\b[^>]*>/i
  ];
  return forbiddenTags.some(tag => tag.test(msg));
};

const getActiveMessages = async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("is_active", true)
      .or(`start_time.is.null,start_time.lte.${now}`)
      .or(`end_time.is.null,end_time.gte.${now}`)
      .order("priority", { ascending: false })
      .limit(2);

    if (error) throw error;

    return res.status(200).json({ success: true, count: data.length, data });
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
      .from("messages")
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
      return res.status(400).json({ success: false, message: "Security Error: High-level HTML tags (html, body, script, iframe, etc.) are not allowed." });
    }

    const { data, error } = await supabase
      .from("messages")
      .insert([
        {
          type,
          msg,
          one_time: one_time || false,
          start_time: start_time || null,
          end_time: end_time || null,
          is_active: is_active !== undefined ? is_active : true,
          priority: priority || 0,
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
    const updates = req.body;

    if (updates.msg && containsForbiddenTags(updates.msg)) {
      return res.status(400).json({ success: false, message: "Security Error: High-level HTML tags (html, body, script, iframe, etc.) are not allowed." });
    }

    const { data, error } = await supabase
      .from("messages")
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

    const { error } = await supabase.from("messages").delete().eq("id", id);

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

module.exports = {
  getActiveMessages,
  getAllMessages,
  createMessage,
  updateMessage,
  deleteMessage,
};
