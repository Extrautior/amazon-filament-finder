const fs = require("fs");
const path = require("path");
const os = require("os");

const MATERIALS = ["PLA", "PETG", "ABS", "TPU"];
const RESULT_LIMIT = Number(process.env.RESULT_LIMIT || 10);
const DEFAULT_MARKETPLACE = "amazon.com";
const DEFAULT_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || 30000);

function defaultUserDataDirs() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return [
    path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data"),
    path.join(localAppData, "Microsoft", "Edge", "User Data"),
    path.join(localAppData, "Google", "Chrome", "User Data")
  ];
}

function firstExistingPath(paths) {
  return paths.find((candidate) => fs.existsSync(candidate)) || paths[0];
}

function defaultBrowserExecutable() {
  const candidates = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe")
  ];
  return firstExistingPath(candidates);
}

module.exports = {
  MATERIALS,
  RESULT_LIMIT,
  DEFAULT_MARKETPLACE,
  DEFAULT_TIMEOUT_MS,
  PROFILE_COPY_ROOT: process.env.PROFILE_COPY_ROOT || path.join(os.tmpdir(), "amazon-filament-finder"),
  BROWSER_CHANNEL: process.env.BROWSER_CHANNEL || "",
  BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH || defaultBrowserExecutable(),
  BROWSER_USER_DATA_DIR: process.env.BROWSER_USER_DATA_DIR || firstExistingPath(defaultUserDataDirs()),
  BROWSER_PROFILE: process.env.BROWSER_PROFILE || "Default",
  SEARCH_BASE_URL: "https://www.amazon.com/s",
  SEARCH_TERMS: {
    PLA: "PLA filament",
    PETG: "PETG filament",
    ABS: "ABS filament",
    TPU: "TPU filament"
  }
};
