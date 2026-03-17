const loginAdmin = (req, res) => {
  const { username, password } = req.body;

  // Predefined Admin Credentials
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // Return a dummy token for now
    return res
      .status(200)
      .json({ success: true, token: "admin_dummy_token_123" });
  }

  return res
    .status(401)
    .json({ success: false, message: "Invalid credentials" });
};

module.exports = { loginAdmin };
