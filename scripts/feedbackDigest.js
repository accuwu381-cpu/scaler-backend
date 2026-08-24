#!/usr/bin/env node
// ============================================================
// feedbackDigest.js — Nightly "new feedback" email reminder
// ============================================================
//
// Reads the feedback Google Sheet, diffs it against the rows already seen on a
// previous run, and emails a digest of anything new. Run by
// .github/workflows/feedback-digest.yml on a nightly cron; runnable locally
// with `npm run feedback:digest`.
//
// State lives in scripts/state/feedback-seen.json, committed back by the
// workflow. Rows are keyed by a content hash rather than by row number or
// timestamp, so a row edited or re-sorted in the sheet does not re-alert, and a
// deleted row does not shift every later row into looking new.
//
// Flags:
//   --dry-run    print what would be sent; send no mail, write no state
//   --force      send a digest of the latest rows even when nothing is new
//   --bootstrap  on a first run (no state file), still email what is there
//
// Env:
//   GMAIL_APP_PASSWORD  (required) Gmail app password for the from-address
//   FEEDBACK_MAIL_FROM  default hindustanigamerritesh@gmail.com
//   FEEDBACK_MAIL_TO    default ritesh.24bcs10088@sst.scaler.com
//   GMAIL_USER          SMTP login; defaults to FEEDBACK_MAIL_FROM
//   FEEDBACK_SHEET_ID / FEEDBACK_SHEET_GID  override the sheet

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// dotenv is a backend dependency locally; in CI the values come from secrets.
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch {
  /* not installed in CI — env is already populated */
}

const { fetchEntries, SHEET_URL } = require("./lib/feedbackSheet");

const STATE_PATH = path.join(__dirname, "state", "feedback-seen.json");

/** Keep the state file from growing without bound; far above real volume. */
const MAX_SEEN = 2000;

/** How many rows a --force digest shows when nothing is actually new. */
const FORCE_PREVIEW_COUNT = 5;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);

const DRY_RUN = flag("dry-run");
const FORCE = flag("force");
const BOOTSTRAP_NOTIFY = flag("bootstrap") || process.env.FEEDBACK_NOTIFY_ON_BOOTSTRAP === "1";

const MAIL_FROM = process.env.FEEDBACK_MAIL_FROM || "hindustanigamerritesh@gmail.com";
const MAIL_TO = process.env.FEEDBACK_MAIL_TO || "ritesh.24bcs10088@sst.scaler.com";
const SMTP_USER = process.env.GMAIL_USER || MAIL_FROM;

// ── State ───────────────────────────────────────────────────────────────────

/** Content hash — stable across row moves, changes if the answer is edited. */
const entryKey = (entry) =>
  crypto
    .createHash("sha1")
    .update(`${entry.timestamp}|${entry.email}|${entry.message}`)
    .digest("hex")
    .slice(0, 12);

const readState = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return {
      exists: true,
      seen: new Set(Array.isArray(parsed.seen) ? parsed.seen : []),
    };
  } catch {
    // Missing or corrupt — treat as a first run rather than re-alerting on all.
    return { exists: false, seen: new Set() };
  }
};

const writeState = (keys) => {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(
    STATE_PATH,
    `${JSON.stringify(
      { updatedAt: new Date().toISOString(), count: keys.length, seen: keys.slice(-MAX_SEEN) },
      null,
      2,
    )}\n`,
  );
};

// ── Email ───────────────────────────────────────────────────────────────────

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const TYPE_COLOR = {
  bug: "#ff6b62",
  feature: "#7c9dff",
  feedback: "#3ddc63",
};

const typeColor = (type) => TYPE_COLOR[String(type).trim().toLowerCase()] || "#9aa4b2";

const stars = (rating) => (rating ? `${"★".repeat(rating)}${"☆".repeat(5 - rating)} ${rating}/5` : "no rating");

const buildHtml = (entries, { forced }) => {
  const cards = entries
    .map(
      (entry) => `
      <tr><td style="padding:0 0 14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="border:1px solid #e3e6ea;border-radius:10px;border-collapse:separate">
          <tr><td style="padding:14px 16px">
            <div style="font:600 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111">
              ${escapeHtml(entry.email || "Anonymous")}
            </div>
            <div style="font:12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b7280;margin:2px 0 10px">
              ${escapeHtml(entry.timestamp || "unknown time")}
              &nbsp;·&nbsp; <span style="color:#c98a00">${escapeHtml(stars(entry.rating))}</span>
              &nbsp;·&nbsp; <span style="color:${typeColor(entry.type)};font-weight:600">${escapeHtml(entry.type)}</span>
            </div>
            <div style="font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;white-space:pre-wrap">${escapeHtml(
              entry.message || "No details provided.",
            )}</div>
          </td></tr>
        </table>
      </td></tr>`,
    )
    .join("");

  const heading = forced
    ? `Latest ${entries.length} feedback response${entries.length === 1 ? "" : "s"} (manual run — nothing new)`
    : `${entries.length} new feedback response${entries.length === 1 ? "" : "s"}`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
        <tr><td style="font:600 18px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding-bottom:4px">
          Scaler++ feedback
        </td></tr>
        <tr><td style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b7280;padding-bottom:18px">
          ${escapeHtml(heading)}
        </td></tr>
        ${cards}
        <tr><td style="padding-top:6px">
          <a href="${SHEET_URL}" style="font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;color:#2b5cff;text-decoration:none">
            Open the responses sheet →
          </a>
        </td></tr>
        <tr><td style="font:12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#9aa4b2;padding-top:14px">
          Sent by the nightly feedback-digest workflow.
        </td></tr>
      </table>
    </td></tr>
  </table>`;
};

const buildText = (entries) =>
  entries
    .map(
      (entry) =>
        `— ${entry.email || "Anonymous"} · ${entry.timestamp} · ${stars(entry.rating)} · ${entry.type}\n${
          entry.message || "No details provided."
        }`,
    )
    .join("\n\n") + `\n\nSheet: ${SHEET_URL}\n`;

const sendMail = async (entries, { forced }) => {
  const password = process.env.GMAIL_APP_PASSWORD;
  if (!password) throw new Error("GMAIL_APP_PASSWORD is not set");

  // Required only for the digest, so it is resolved lazily — the sheet fetch
  // and diff still work (e.g. --dry-run) without the module installed.
  const nodemailer = require("nodemailer");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: SMTP_USER, pass: password },
  });

  const subject = forced
    ? `Scaler++ feedback · latest ${entries.length} (no new responses)`
    : `Scaler++ feedback · ${entries.length} new response${entries.length === 1 ? "" : "s"}`;

  const info = await transporter.sendMail({
    from: `Scaler++ Feedback <${MAIL_FROM}>`,
    to: MAIL_TO,
    replyTo: entries[0]?.email || undefined,
    subject,
    text: buildText(entries),
    html: buildHtml(entries, { forced }),
  });

  return info.messageId;
};

// ── Main ────────────────────────────────────────────────────────────────────

const emitOutput = (key, value) => {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${key}=${value}\n`);
};

const main = async () => {
  const entries = await fetchEntries();
  const state = readState();

  const keys = entries.map(entryKey);
  const fresh = entries.filter((_, i) => !state.seen.has(keys[i]));

  console.log(`Sheet rows: ${entries.length} · already seen: ${state.seen.size} · new: ${fresh.length}`);

  // First run with no state: record the sheet as-is instead of emailing every
  // historical response. Pass --bootstrap to mail them anyway.
  const bootstrapSkip = !state.exists && !BOOTSTRAP_NOTIFY && fresh.length > 0;

  let toSend = [];
  let forced = false;

  if (bootstrapSkip) {
    console.log("First run — recording current rows as seen, no email sent (use --bootstrap to override).");
  } else if (fresh.length) {
    toSend = fresh.slice().reverse(); // newest first in the email
  } else if (FORCE) {
    toSend = entries.slice(-FORCE_PREVIEW_COUNT).reverse();
    forced = true;
    console.log("Nothing new — --force, so sending a preview of the latest rows.");
  } else {
    console.log("Nothing new — no email sent.");
  }

  emitOutput("new_count", fresh.length);

  if (DRY_RUN) {
    console.log(`[dry-run] would ${toSend.length ? `email ${toSend.length} row(s) to ${MAIL_TO}` : "send nothing"}; state not written.`);
    if (toSend.length) console.log(buildText(toSend));
    return;
  }

  if (toSend.length) {
    const messageId = await sendMail(toSend, { forced });
    console.log(`Emailed ${toSend.length} row(s) to ${MAIL_TO} (${messageId}).`);
  }

  // Written after a successful send so a mail failure retries the same rows
  // on the next run instead of swallowing them.
  writeState(keys);
  console.log(`State updated: ${keys.length} row(s) recorded.`);
};

main().catch((err) => {
  console.error(`feedbackDigest failed: ${err.message}`);
  process.exit(1);
});
