const verifyApiKey = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  const expectedKey = process.env.EXTENSION_API_KEY;

  if (token !== expectedKey) {
    return res.status(403).json({ error: "Forbidden: Invalid API Key" });
  }

  next();
};

module.exports = {
  verifyApiKey,
};
