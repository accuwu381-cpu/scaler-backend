const mongoose = require("mongoose");

/**
 * Serverless-safe Mongo connection.
 *
 * The previous version cached a plain `isConnected = true` boolean. On Vercel
 * that is a trap: the lambda connects, gets frozen, and its socket dies while
 * the flag stays true. On thaw `connectMongo()` returned immediately, every
 * query was queued against a dead connection, and the request died with
 * "Operation `x.find()` buffering timed out after 10000ms" — a 10 second stall
 * followed by a 500, on every request, until the instance was recycled.
 *
 * Two changes fix it:
 *   - trust `mongoose.connection.readyState`, not a boolean we maintain
 *   - cache the in-flight connect PROMISE so concurrent cold-start requests
 *     share one handshake instead of opening several
 *
 * The cache hangs off globalThis so it survives module re-evaluation between
 * invocations on the same instance.
 */
const STATE_DISCONNECTED = 0;
const STATE_CONNECTED = 1;
const STATE_CONNECTING = 2;

const cache = (globalThis.__scalerMongo ||= { promise: null });

async function connectMongo() {
  if (mongoose.connection.readyState === STATE_CONNECTED) return mongoose.connection;

  // A connect is already in flight (this instance is cold, or several requests
  // arrived at once) — wait on it rather than starting a second handshake.
  if (cache.promise) {
    try {
      return await cache.promise;
    } catch (err) {
      cache.promise = null; // let the next caller retry instead of inheriting
      throw err;
    }
  }

  const uri = process.env.MONGO_DB_URI;
  if (!uri) throw new Error("MONGO_DB_URI is not set in environment variables.");

  // readyState 2 without a cached promise means a previous instance's connect
  // is stuck; drop it so the fresh attempt below is not queued behind it.
  if (mongoose.connection.readyState === STATE_CONNECTING) {
    try {
      await mongoose.disconnect();
    } catch (_) {
      /* nothing useful to do — the fresh connect below is what matters */
    }
  }

  cache.promise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 8000,
      // Fail fast instead of parking an operation for 10s and then 500ing.
      bufferCommands: false,
    })
    .then((m) => {
      console.log("✅ MongoDB connected.");
      return m.connection;
    })
    .catch((err) => {
      cache.promise = null;
      throw err;
    });

  return cache.promise;
}

// A dropped socket must clear the cached promise, or every later call resolves
// against a connection that is already gone.
mongoose.connection.on("disconnected", () => {
  if (mongoose.connection.readyState === STATE_DISCONNECTED) cache.promise = null;
});
mongoose.connection.on("error", () => {
  cache.promise = null;
});

module.exports = { connectMongo };
