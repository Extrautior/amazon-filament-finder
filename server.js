const http = require("http");
const fs = require("fs");
const path = require("path");
const { PORT } = require("./src/config");
const { clearAuthCookie, isAuthenticated, setAuthCookie, validatePassword } = require("./src/auth");
const { payloadToCsv } = require("./src/export");
const logger = require("./src/logger");
const { buildSearchPlan, getSessionStatus, runSearch, SessionBusyError, SessionRequiredError } = require("./src/search");

const PUBLIC_DIR = path.join(__dirname, "public");
let lastAsyncCrash = null;
let latestSuccessfulPayload = null;
let inflightSearch = null;
let inflightSearchKey = null;
let searchProgress = {
  jobId: null,
  running: false,
  phase: "idle",
  percent: 0,
  activeMaterial: null,
  message: "Idle.",
  startedAt: null,
  updatedAt: null,
  latestPayloadJobId: null,
  searchPlan: []
};

class SearchInProgressError extends Error {
  constructor(message) {
    super(message);
    this.name = "SearchInProgressError";
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, contentType, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    ...headers
  });
  res.end(body);
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) {
    return true;
  }

  sendJson(res, 401, { error: "Authentication required" });
  return false;
}

function setSearchProgress(update) {
  searchProgress = {
    ...searchProgress,
    ...update,
    updatedAt: new Date().toISOString()
  };
}

function createJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSearchRequest(body) {
  const materials = Array.isArray(body?.materials) ? body.materials : [];
  const customTerm = typeof body?.customTerm === "string" ? body.customTerm : "";
  return {
    materials,
    customTerm
  };
}

function searchPlanKey(searchPlan) {
  return JSON.stringify(searchPlan);
}

function startHostedSearch(searchRequest) {
  const searchPlan = buildSearchPlan(searchRequest);
  const nextSearchKey = searchPlanKey(searchPlan);

  if (inflightSearch) {
    if (inflightSearchKey === nextSearchKey) {
      logger.info("search.deduped", { reason: "matching-search-in-flight" });
      return {
        jobId: searchProgress.jobId,
        started: false,
        deduped: true,
        searchPlan: searchProgress.searchPlan
      };
    }

    throw new SearchInProgressError("Another search is already running. Wait for it to finish and retry.");
  }

  const jobId = createJobId();
  setSearchProgress({
    jobId,
    running: true,
    phase: "queued",
    percent: 1,
    activeMaterial: null,
    message: "Search queued.",
    startedAt: new Date().toISOString(),
    latestPayloadJobId: latestSuccessfulPayload ? latestSuccessfulPayload.jobId || null : null,
    searchPlan
  });

  inflightSearchKey = nextSearchKey;
  inflightSearch = (async () => {
    logger.info("search.start");
    try {
      const payload = await runSearch({
        ...searchRequest,
        onProgress(update) {
          setSearchProgress({
            jobId,
            running: true,
            searchPlan,
            ...update
          });
        }
      });
      const counts = Object.fromEntries(
        Object.entries(payload.resultsByMaterial).map(([material, items]) => [material, items.length])
      );
      latestSuccessfulPayload = {
        ...payload,
        jobId
      };
      logger.info("search.success", { counts, warningCount: payload.warnings.length });
      setSearchProgress({
        latestPayloadJobId: jobId
      });
    } catch (error) {
      logger.error("search.failure", {
        message: error instanceof Error ? error.message : String(error)
      });
      setSearchProgress({
        jobId,
        running: false,
        phase: "error",
        activeMaterial: searchProgress.activeMaterial,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (searchProgress.phase !== "error") {
        setSearchProgress({
          jobId,
          running: false,
          phase: "complete",
          percent: 100,
          activeMaterial: null,
          message: "Search complete.",
          latestPayloadJobId: latestSuccessfulPayload ? latestSuccessfulPayload.jobId || null : null
        });
      }
      inflightSearch = null;
      inflightSearchKey = null;
    }
  })();

  return {
    jobId,
    started: true,
    deduped: false,
    searchPlan
  };
}

const server = http.createServer((req, res) => {
  void (async () => {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: "Missing request data" });
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    if (req.method === "GET" && pathname === "/health") {
      const sessionStatus = await getSessionStatus();
      sendJson(res, 200, {
        ok: true,
        sessionStatus: sessionStatus.status,
        cachedResults: Boolean(latestSuccessfulPayload),
        lastAsyncCrash
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/search-status") {
      if (!requireAuth(req, res)) {
        return;
      }

      sendJson(res, 200, {
        ...searchProgress,
        hasCachedResults: Boolean(latestSuccessfulPayload)
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/latest-results") {
      if (!requireAuth(req, res)) {
        return;
      }
      if (!latestSuccessfulPayload) {
        sendJson(res, 404, { error: "No successful search payload is cached yet" });
        return;
      }

      sendJson(res, 200, latestSuccessfulPayload);
      return;
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readJsonBody(req);
      if (!validatePassword(body.password)) {
        logger.warn("auth.failed");
        sendJson(res, 401, { error: "Invalid password" });
        return;
      }

      setAuthCookie(res);
      logger.info("auth.success");
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      clearAuthCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/admin/session-status") {
      if (!requireAuth(req, res)) {
        return;
      }

      const status = await getSessionStatus();
      sendJson(res, 200, status);
      return;
    }

    if (req.method === "POST" && pathname === "/api/search") {
      if (!requireAuth(req, res)) {
        return;
      }

      try {
        const body = await readJsonBody(req);
        const job = startHostedSearch(normalizeSearchRequest(body));
        sendJson(res, 202, job);
      } catch (error) {
        const statusCode =
          error instanceof SessionRequiredError || error instanceof SessionBusyError || error instanceof SearchInProgressError
            ? 409
            : 500;
        sendJson(res, statusCode, {
          error:
            error instanceof SessionRequiredError
              ? "Amazon session requires reauthentication"
              : error instanceof SessionBusyError
                ? "Amazon session is busy"
                : error instanceof SearchInProgressError
                  ? "Another search is already running"
                : "Search failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/export.json") {
      if (!requireAuth(req, res)) {
        return;
      }
      if (!latestSuccessfulPayload) {
        sendJson(res, 404, { error: "No successful search payload is cached yet" });
        return;
      }

      sendJson(res, 200, latestSuccessfulPayload, {
        "Content-Disposition": 'attachment; filename="amazon-filament-results.json"'
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/export.csv") {
      if (!requireAuth(req, res)) {
        return;
      }
      if (!latestSuccessfulPayload) {
        sendJson(res, 404, { error: "No successful search payload is cached yet" });
        return;
      }

      sendText(
        res,
        200,
        "text/csv; charset=utf-8",
        payloadToCsv(latestSuccessfulPayload),
        { "Content-Disposition": 'attachment; filename="amazon-filament-results.csv"' }
      );
      return;
    }

    if (req.method === "GET") {
      const staticFile = getStaticFile(pathname);
      if (!staticFile) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      sendFile(res, staticFile);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  })().catch((error) => {
    logger.error("server.unhandled", {
      message: error instanceof Error ? error.message : String(error)
    });
    sendJson(res, 500, {
      error: "Unhandled server error",
      message: error instanceof Error ? error.message : String(error)
    });
  });
});

server.listen(PORT, () => {
  logger.info("server.start", { port: PORT });
  console.log(`Amazon Filament Finder running at http://localhost:${PORT}`);
});

process.on("unhandledRejection", (reason) => {
  lastAsyncCrash = reason instanceof Error ? reason.message : String(reason);
  logger.error("process.unhandledRejection", { message: lastAsyncCrash });
});

process.on("uncaughtException", (error) => {
  lastAsyncCrash = error instanceof Error ? error.message : String(error);
  logger.error("process.uncaughtException", { message: lastAsyncCrash });
});
