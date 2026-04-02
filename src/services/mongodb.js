const mongoose = require("mongoose");

let isConnected = false;

async function connectMongo() {
  if (isConnected) return;

  const uri = process.env.MONGO_DB_URI;
  if (!uri) throw new Error("MONGO_DB_URI is not set in environment variables.");

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  });

  isConnected = true;
  console.log("✅ MongoDB connected.");
}

module.exports = { connectMongo };
