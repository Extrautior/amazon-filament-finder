const crypto = require("crypto");
const { APP_PASSWORD, SESSION_COOKIE_NAME } = require("./config");

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((cookies, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(rest.join("=") || "");
    return cookies;
  }, {});
}

function expectedSessionToken() {
  if (!APP_PASSWORD) {
    return "";
  }

  return crypto.createHmac("sha256", APP_PASSWORD).update("shared-session").digest("hex");
}

function isAuthenticated(req) {
  if (!APP_PASSWORD) {
    return true;
  }

  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE_NAME] === expectedSessionToken();
}

function sessionCookieHeader(token, maxAgeSeconds) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function setAuthCookie(res) {
  res.setHeader("Set-Cookie", sessionCookieHeader(expectedSessionToken(), 60 * 60 * 24 * 14));
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", sessionCookieHeader("", 0));
}

function validatePassword(password) {
  if (!APP_PASSWORD) {
    return true;
  }

  return String(password || "") === APP_PASSWORD;
}

module.exports = {
  clearAuthCookie,
  isAuthenticated,
  parseCookies,
  setAuthCookie,
  validatePassword
};
