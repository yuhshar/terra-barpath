// Terra BarPath — Railway proxy server
// Keeps the Anthropic API key out of the browser by proxying chat requests.
//
// Required Railway env var:
//   ANTHROPIC_API_KEY = sk-ant-...
//
// Optional:
//   ALLOWED_ORIGIN = https://your-frontend.up.railway.app  (defaults to "*" for now)

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

if (!API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY env var is not set.");
  process.exit(1);
}

// Serve static files from the repo root (so index.html is reachable)
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(__dirname, urlPath);
  // Prevent path traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end("Not found"); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      // Cap body size at ~1 MB to be safe
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      method: "POST",
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      // Only forward fields we expect — never trust client to set api keys, etc.
      const safePayload = {
        model: payload.model || "claude-sonnet-4-5",
        max_tokens: Math.min(payload.max_tokens || 2048, 4096),
        system: payload.system,
        messages: payload.messages
      };
      const result = await callAnthropic(safePayload);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(result.body);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  // Fall through to static file serving
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Terra BarPath server listening on port ${PORT}`);
});
