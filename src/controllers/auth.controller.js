const jwt = require("jsonwebtoken");

const loginAdmin = (req, res) => {
  const { username, password } = req.body;

  // Predefined Admin Credentials
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // Generate a JWT token valid for 10 minutes
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "10m" });

    // Set JWT as a secure cookie
    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "Lax",
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    return res.status(200).json({ success: true, message: "Logged in successfully" });
  }

  return res
    .status(401)
    .json({ success: false, message: "Invalid credentials" });
};

const logoutAdmin = (req, res) => {
  res.clearCookie("adminToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "Lax",
  });
  return res.status(200).json({ success: true, message: "Logged out successfully" });
};

module.exports = { loginAdmin, logoutAdmin };
