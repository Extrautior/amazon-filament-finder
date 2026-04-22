const fs = require("fs");
const path = require("path");
const os = require("os");

const MATERIALS = ["PLA", "PETG", "ABS", "TPU"];
const DEFAULT_MARKETPLACE = "amazon.com";
const SEARCH_BASE_URL = "https://www.amazon.com/s";
const SEARCH_TERMS = {
  PLA: "PLA filament",
  PETG: "PETG filament",
  ABS: "ABS filament",
  TPU: "TPU filament"
};

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function splitBrowserArgs(value) {
  return String(value || "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hoursFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = String(raw)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23)
    .sort((left, right) => left - right);

  return parsed.length ? [...new Set(parsed)] : fallback;
}

function stringFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") {
    return fallback;
  }
  return String(raw).trim();
}

const DATA_DIR = ensureDir(process.env.DATA_DIR || path.join(os.homedir(), ".amazon-filament-finder"));
const AMAZON_SESSION_DIR = ensureDir(process.env.AMAZON_SESSION_DIR || path.join(DATA_DIR, "amazon-session"));
const LOG_DIR = ensureDir(path.join(DATA_DIR, "logs"));

module.exports = {
  MATERIALS,
  DEFAULT_MARKETPLACE,
  SEARCH_BASE_URL,
  SEARCH_TERMS,
  APP_PASSWORD: process.env.APP_PASSWORD || "",
  PORT: numberFromEnv("PORT", 3017),
  RESULT_LIMIT: numberFromEnv("RESULT_LIMIT", 20),
  DEFAULT_TIMEOUT_MS: numberFromEnv("SEARCH_TIMEOUT_MS", 30000),
  DATA_DIR,
  AMAZON_SESSION_DIR,
  LOG_DIR,
  HEADLESS: boolFromEnv("HEADLESS", true),
  AUTO_REFRESH_ENABLED: boolFromEnv("AUTO_REFRESH_ENABLED", true),
  AUTO_REFRESH_TIMEZONE: process.env.AUTO_REFRESH_TIMEZONE || "Asia/Jerusalem",
  AUTO_REFRESH_HOURS: hoursFromEnv("AUTO_REFRESH_HOURS", [8, 20]),
  DEAL_NOTIFICATIONS_ENABLED: boolFromEnv("DEAL_NOTIFICATIONS_ENABLED", false),
  DISCORD_WEBHOOK_URL: stringFromEnv("DISCORD_WEBHOOK_URL", ""),
  DEAL_NOTIFICATION_RETENTION_DAYS: numberFromEnv("DEAL_NOTIFICATION_RETENTION_DAYS", 14),
  DEAL_NOTIFICATION_MAX_ITEMS: numberFromEnv("DEAL_NOTIFICATION_MAX_ITEMS", 8),
  SESSION_COOKIE_NAME: "amazon_filament_finder_session",
  BROWSER_CHANNEL: process.env.BROWSER_CHANNEL || "",
  BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH || "",
  BROWSER_ARGS: [
    "--disable-dev-shm-usage",
    "--disable-gpu",
    ...splitBrowserArgs(process.env.BROWSER_ARGS || "")
  ]
};
