// ============================================================
// feedbackSheet.js — Read the feedback Google Sheet as JSON
// ============================================================
//
// The form responses live in a Google Sheet. Its `gviz/tq` endpoint exports
// CSV without auth as long as the sheet stays "anyone with the link can view",
// so no Google service account is needed here.
//
// This mirrors the parser the frontend proxy uses (frontend/src/app/api/
// feedback/sheet.ts). The two live in separate repos, so the logic is
// duplicated on purpose — keep them in step when a form question changes.

const SHEET_ID = process.env.FEEDBACK_SHEET_ID || "1_rfAh9gImOj_8_sOnDw6qmS8tsKOX24fWSKJqoGbUew";
const SHEET_GID = process.env.FEEDBACK_SHEET_GID || "233041605";

const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`;

/**
 * RFC-4180 CSV reader. Form answers are free text, so fields routinely carry
 * commas, newlines and `""` escaped quotes — a `split(",")` mangles all three.
 */
const parseCSV = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  // Strip a UTF-8 BOM so the first header doesn't gain an invisible prefix.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const char = src[i];

    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += char;
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
};

/**
 * Locate a column by keyword instead of position, so renaming or reordering a
 * form question doesn't silently shift every value one column left.
 */
const findColumn = (headers, keywords, fallback) => {
  const index = headers.findIndex((h) => {
    const lower = String(h).toLowerCase();
    return keywords.some((k) => lower.includes(k));
  });
  return index === -1 ? fallback : index;
};

/** Turn the raw sheet CSV into oldest-first entries. */
const toEntries = (csv) => {
  const [headers = [], ...dataRows] = parseCSV(csv);

  const col = {
    timestamp: findColumn(headers, ["timestamp", "date"], 0),
    email: findColumn(headers, ["email"], 1),
    rating: findColumn(headers, ["rate", "rating"], 2),
    type: findColumn(headers, ["it's a", "it’s a", "type", "category"], 3),
    message: findColumn(headers, ["describe", "issue", "message", "detail"], 4),
  };

  const cell = (row, index) => String(row[index] ?? "").trim();

  return dataRows.map((row) => {
    const rating = Number(cell(row, col.rating));
    return {
      timestamp: cell(row, col.timestamp),
      email: cell(row, col.email),
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      type: cell(row, col.type) || "Other",
      message: cell(row, col.message),
    };
  });
};

/** Fetch + parse. Throws with a readable reason so the workflow log is useful. */
const fetchEntries = async () => {
  const res = await fetch(CSV_URL, { headers: { Accept: "text/csv" } });

  if (!res.ok) {
    throw new Error(
      `Google Sheets returned ${res.status}. Is the sheet shared as "anyone with the link can view"?`,
    );
  }

  const body = await res.text();

  // A permission failure comes back as 200 + an HTML sign-in page.
  if (body.trimStart().startsWith("<")) {
    throw new Error(
      'Sheet is not publicly readable — share it as "anyone with the link can view".',
    );
  }

  return toEntries(body);
};

module.exports = { CSV_URL, SHEET_URL, parseCSV, findColumn, toEntries, fetchEntries };
