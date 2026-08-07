// ============================================================
// email.utils.js — Email parsing + message audience matching
// ============================================================

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
      batch: match[1], // "24"
      course: match[2].toLowerCase(), // "bcs"
      rollNumber: match[3], // "10088"
    };
  } catch {
    return null;
  }
};

/**
 * Extract the lowercased domain part of an email.
 * "Ritesh.24bcs10088@SST.Scaler.com" -> "sst.scaler.com"
 */
const getEmailDomain = (email) => {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
};

/**
 * Build the audience descriptor for a caller email.
 * Returns { email, batch, domain } with null members when unknown/anonymous.
 */
const buildAudienceContext = (rawEmail) => {
  const email =
    typeof rawEmail === "string" && rawEmail.trim()
      ? rawEmail.trim().toLowerCase()
      : null;

  if (!email) return { email: null, batch: null, domain: null };

  return {
    email,
    batch: parseEmail(email)?.batch ?? null,
    domain: getEmailDomain(email),
  };
};

const asList = (value) => (Array.isArray(value) ? value : []);
const hasItems = (value) => asList(value).length > 0;

/**
 * Does this message row target the given user?
 *
 * Semantics (OR / union):
 *   - All three target arrays empty  -> broadcast, everyone matches.
 *   - Otherwise the user matches if ANY populated dimension matches:
 *       target_emails  contains their email        (case-insensitive)
 *       target_batches contains their batch        ("24", string compare)
 *       target_domains contains their email domain (case-insensitive)
 *   - An anonymous caller (no email) only ever matches broadcast messages.
 */
const matchesAudience = (msgRow, ctx) => {
  const emails = asList(msgRow?.target_emails);
  const batches = asList(msgRow?.target_batches);
  const domains = asList(msgRow?.target_domains);

  // Broadcast — no targeting configured.
  if (!emails.length && !batches.length && !domains.length) return true;

  const { email, batch, domain } = ctx || {};
  if (!email) return false;

  if (emails.some((e) => String(e).trim().toLowerCase() === email)) return true;
  if (batch && batches.some((b) => String(b).trim() === batch)) return true;
  if (domain && domains.some((d) => String(d).trim().toLowerCase() === domain))
    return true;

  return false;
};

/**
 * How narrowly a message is addressed. Used to break the priority tie so a
 * message aimed at one person is not buried under a general banner:
 *   2 = specific emails, 1 = batch/domain, 0 = broadcast.
 */
const audienceSpecificity = (msgRow) => {
  if (hasItems(msgRow?.target_emails)) return 2;
  if (hasItems(msgRow?.target_batches) || hasItems(msgRow?.target_domains)) {
    return 1;
  }
  return 0;
};

module.exports = {
  parseEmail,
  getEmailDomain,
  buildAudienceContext,
  matchesAudience,
  audienceSpecificity,
  hasItems,
};
