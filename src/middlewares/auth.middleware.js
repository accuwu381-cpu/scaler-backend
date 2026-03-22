const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const token = req.cookies.adminToken;

  if (!token) {
    return res
      .status(401)
      .json({ error: "Abe chutiye 😑, bakchodi karne ki aadat nahi gai teri" });
  }

  const JWT_SECRET = process.env.JWT_SECRET;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // add decoded payload to request
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ error: "Abe chutiye 😑, bakchodi karne ki aadat nahi gai teri" });
  }
};

module.exports = {
  verifyToken,
};
