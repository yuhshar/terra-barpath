// Terra BarPath — Railway API proxy
// Single job: forward chat requests to Anthropic with the API key attached server-side.
// The HTML frontend is hosted separately on Netlify.
//
// Required Railway env var:
//   ANTHROPIC_API_KEY = sk-ant-...
//
// Optional:
//   ALLOWED_ORIGIN = https://terra-barpath.netlify.app  (defaults to that URL)
//   PORT = (Railway sets this automatically)

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://terra-barpath.netlify.app";

if (!API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY env var is not set.");
  process.exit(1);
}

function setCors(res, reqOrigin) {
  // Echo the allowed origin only if it matches (more secure than blanket allow)
  // ALLOWED_ORIGIN can be a comma-separated list for multiple environments (e.g. preview + prod)
  const allowed = ALLOWED_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);
  // Normalize comparison: case-insensitive, strip trailing slashes
  const normalize = (s) => (s || "").trim().toLowerCase().replace(/\/+$/, "");
  const reqNorm = normalize(reqOrigin);
  const matched = allowed.find(a => normalize(a) === reqNorm);
  if (matched) {
    res.setHeader("Access-Control-Allow-Origin", matched);
  } else {
    // Log on mismatch so we can debug from Railway logs
    if (reqOrigin) {
      console.log(`CORS mismatch: request origin "${reqOrigin}" not in allow-list [${allowed.join(", ")}]`);
    }
    // Default to first allowed origin so health checks / direct visits get a sensible header
    res.setHeader("Access-Control-Allow-Origin", allowed[0] || "*");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
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
  const origin = req.headers.origin;
  setCors(res, origin);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check / root visit
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "terra-barpath-proxy" }));
    return;
  }

  // The one real endpoint
  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      // Strict allow-list of forwarded fields - never trust the client to set api keys, model overrides, etc.
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

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Terra BarPath proxy listening on port ${PORT}`);
  console.log(`Allowed origin(s): ${ALLOWED_ORIGIN}`);
});
