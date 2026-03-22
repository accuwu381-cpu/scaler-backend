const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const token = req.cookies.adminToken;

  if (!token) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Access denied. Please login first." });
  }

  const JWT_SECRET = process.env.JWT_SECRET;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // add decoded payload to request
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

module.exports = {
  verifyToken,
};
