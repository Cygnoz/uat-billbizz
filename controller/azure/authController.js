const axios = require("axios");
const jwt = require("jsonwebtoken");
const User = require("../../database/model/user");
const config = require("./config/azureB2C");

exports.registerUser = async (req, res) => {
  const { email, password, displayName } = req.body;
  try {
    const response = await axios.post(`${config.graphApiUrl}/users`, {
      accountEnabled: true,
      displayName,
      mailNickname: email.split("@")[0],
      userPrincipalName: email,
      passwordProfile: { forceChangePasswordNextSignIn: false, password },
    }, { headers: { Authorization: `Bearer ${config.clientSecret}` } });

    res.json({ message: "User created", user: response.data });
  } catch (error) {
    res.status(400).json({ error: error.response.data });
  }
};

exports.signInUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const response = await axios.post(`${config.authority}/oauth2/token`, {
      grant_type: "password",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "openid",
      username: email,
      password,
    });

    const user = await User.findOneAndUpdate(
      { email },
      { accessToken: response.data.access_token, refreshToken: response.data.refresh_token },
      { upsert: true, new: true }
    );

    res.json({ user, token: response.data.access_token });
  } catch (error) {
    res.status(400).json({ error: error.response.data });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const response = await axios.post(`${config.authority}/oauth2/token`, {
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: req.body.refreshToken,
    });

    res.json({ accessToken: response.data.access_token });
  } catch (error) {
    res.status(400).json({ error: error.response.data });
  }
};

exports.logoutUser = async (req, res) => {
  res.json({ message: "User logged out" });
};
