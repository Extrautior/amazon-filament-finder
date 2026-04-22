const fs = require("fs");
const path = require("path");
const { LOG_DIR } = require("./config");

function logFilePath(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${stamp}.log`);
}

function writeLog(level, event, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...meta
  };

  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(logFilePath(), line, "utf8");
  const consoleMethod = level === "error" ? console.error : console.log;
  consoleMethod(line.trim());
}

module.exports = {
  error(event, meta) {
    writeLog("error", event, meta);
  },
  info(event, meta) {
    writeLog("info", event, meta);
  },
  warn(event, meta) {
    writeLog("warn", event, meta);
  }
};
