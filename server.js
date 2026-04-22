const http = require("http");
const fs = require("fs");
const path = require("path");
const { runSearch } = require("./src/search");

const PORT = Number(process.env.PORT || 3017);
const PUBLIC_DIR = path.join(__dirname, "public");
let lastAsyncCrash = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "File not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function getStaticFile(requestPath) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, normalized));
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return resolvedPath;
}

const server = http.createServer((req, res) => {
  void (async () => {
    if (!req.url) {
      sendJson(res, 400, { error: "Missing request URL" });
      return;
    }

    if (req.method === "POST" && req.url === "/api/search") {
      try {
        const results = await runSearch();
        if (lastAsyncCrash) {
          results.warnings = [...(results.warnings || []), `Recovered async error: ${lastAsyncCrash}`];
          lastAsyncCrash = null;
        }
        sendJson(res, 200, results);
      } catch (error) {
        sendJson(res, 500, {
          error: "Search failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (req.method === "GET") {
      const staticFile = getStaticFile(req.url);
      if (!staticFile) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      sendFile(res, staticFile);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  })().catch((error) => {
    sendJson(res, 500, {
      error: "Unhandled server error",
      message: error instanceof Error ? error.message : String(error)
    });
  });
});

server.listen(PORT, () => {
  console.log(`Amazon Filament Finder running at http://localhost:${PORT}`);
});

process.on("unhandledRejection", (reason) => {
  lastAsyncCrash = reason instanceof Error ? reason.message : String(reason);
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  lastAsyncCrash = error instanceof Error ? error.message : String(error);
  console.error("Uncaught exception:", error);
});
