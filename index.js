// ============================================================
// index.js — Vercel serverless entrypoint
// ─────────────────────────────────────────────────────────────
// vercel.json builds THIS file with @vercel/node and routes every request to
// it, which passes the original request URL through to Express untouched.
//
// Why not the other approaches:
//   - `rewrites` with a catch-all destination replaces the request PATH, so
//     Express received "/server.js" for every request. That is the outage of
//     2026-09-05: months of working deploys, then a nightly rebuild on a newer
//     builder applied the rewrite this way and every route 404'd.
//   - Filesystem routing via api/[...path].js only ever matched ONE segment
//     here: /api/messages reached Express, /api/messages/active did not.
//
// server.js still exists and still calls app.listen() for local development;
// this file must NOT listen, it only exports the app.
// ============================================================

module.exports = require("./src/app");
