// ============================================================
// api/[[...path]].js — Vercel serverless entrypoint
// ─────────────────────────────────────────────────────────────
// Every /api/* request lands here through Vercel's FILESYSTEM routing, which
// hands the function the original request URL. That is the whole point of this
// file.
//
// The filename must be the catch-all form `[...path].js`. The optional
// catch-all `[[...path]].js` is a Next.js convention: Vercel Functions parse it
// as a single dynamic segment named "[...path]", so /api/messages reached this
// handler but /api/messages/active did not.
//
// The previous setup routed with a catch-all rewrite in vercel.json:
//
//   { "source": "/(.*)", "destination": "/server.js" }
//
// A rewrite replaces the request PATH with the destination. It worked for
// months, then a nightly chore commit triggered a rebuild on a newer Vercel
// builder and Express started receiving "/server.js" for every request —
// "Cannot GET /server.js", a total API outage with no code change behind it.
// Because the original path is destroyed before Express sees it, no middleware
// can recover it; the routing itself has to stop rewriting.
//
// Local development is unchanged and still runs server.js.
// ============================================================

module.exports = require("../src/app");
