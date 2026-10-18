const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MovieBox API Constants & Gateway Hosts
const SECRET = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const HOSTS = [
  process.env.API_HOST || "api4sg.aoneroom.com",
  "api6.aoneroom.com",
  "api.inmoviebox.com",
  "api3.aoneroom.com"
];
let activeHost = HOSTS[0];
let userToken = ""; // Auto-managed Guest JWT Token

// Device Info Config (Defaults to India region & Indian MCC so Indian/Hindi catalog & streams load)
const CLIENT_REGION = process.env.CLIENT_REGION || "IN";
const CLIENT_TIMEZONE = process.env.CLIENT_TIMEZONE || (CLIENT_REGION === "IN" ? "Asia/Kolkata" : "America/New_York");
const CLIENT_SP_CODE = process.env.CLIENT_SP_CODE || (CLIENT_REGION === "IN" ? "40445" : "");

// Pure Node.js HTTPS Proxy Tunneling Support (Zero external dependencies)
const PROXY_URL = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
let proxyAgent = null;

if (PROXY_URL) {
  try {
    const parsedProxy = new URL(PROXY_URL);
    proxyAgent = new https.Agent({
      createConnection(options, callback) {
        const connectReq = http.request({
          host: parsedProxy.hostname,
          port: parsedProxy.port || 8080,
          method: 'CONNECT',
          path: `${options.host}:${options.port || 443}`,
          headers: {
            'Host': `${options.host}:${options.port || 443}`,
            ...(parsedProxy.username ? {
              'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`).toString('base64')}`
            } : {})
          }
        });
        connectReq.on('connect', (res, socket) => {
          if (res.statusCode === 200) {
            const tls = require('tls');
            const tlsSocket = tls.connect({
              socket: socket,
              servername: options.host
            }, () => {
              callback(null, tlsSocket);
            });
            tlsSocket.on('error', callback);
          } else {
            callback(new Error(`Proxy CONNECT returned HTTP ${res.statusCode}`));
          }
        });
        connectReq.on('error', callback);
        connectReq.end();
      }
    });
    console.log(`[Proxy] API requests will route through proxy: ${parsedProxy.hostname}:${parsedProxy.port || 8080}`);
  } catch (err) {
    console.error("[Proxy] Initialization error:", err.message);
  }
}

// 1. Client Token Generator
function getClientToken() {
  const ts = Date.now().toString();
  const reversedTs = ts.split('').reverse().join('');
  const md5Hash = crypto.createHash('md5').update(reversedTs, 'utf-8').digest('hex');
  return `${ts},${md5Hash}`;
}

// 2. Client Device Info Header (Matching exact APK version)
function getClientInfo() {
  const info = {
    package_name: "com.community.oneroom",
    version_name: "4.0.03.0930.03",
    version_code: 50020132,
    os: "android",
    os_version: "13",
    device_id: "864209041234567",
    brand: "TECNO",
    model: "TECNO LH7n",
    system_language: "en",
    net: "wifi",
    region: CLIENT_REGION,
    timezone: CLIENT_TIMEZONE
  };
  if (CLIENT_SP_CODE) {
    info.sp_code = CLIENT_SP_CODE;
  }
  return JSON.stringify(info);
}

// 3. Query Parameter Sorter (Strict alphabetical ordering required for HMAC)
function sortQueryParams(queryStr) {
  if (!queryStr) return "";
  const params = new URLSearchParams(queryStr);
  const entries = Array.from(params.entries());
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

// 4. HMAC-MD5 Signature Generator
function signRequest(method, path, query = "", token = "", body = "", host = activeHost) {
  const timestamp = Date.now();
  const sortedQuery = sortQueryParams(query);
  const fullPathWithQuery = path + (sortedQuery ? `?${sortedQuery}` : "");
  const bodyMd5 = body ? crypto.createHash('md5').update(body, 'utf-8').digest('hex') : "";

  const stringToSign = [
    method.toUpperCase(),
    "",
    body ? "application/json; charset=utf-8" : "",
    body ? Buffer.byteLength(body).toString() : "",
    timestamp.toString(),
    bodyMd5,
    fullPathWithQuery
  ].join("\n");

  const secretBuffer = Buffer.from(SECRET, 'base64');
  const hmac = crypto.createHmac('md5', secretBuffer).update(Buffer.from(stringToSign, 'utf-8')).digest('base64');
  const signature = `${timestamp}|2|${hmac}`;

  const headers = {
    'Host': host,
    'X-Client-Info': getClientInfo(),
    'X-Client-Status': '1',
    'x-tr-signature': signature,
    'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; TECNO LH7n Build/TP1A.220624.014)'
  };

  if (body) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    headers['X-Client-Token'] = getClientToken();
  }

  return { headers, fullPathWithQuery };
}

// 5. Unified HTTPS Request Executor on a specific host
function executeSingleApiRequest(method, path, query = "", body = null, targetHost = activeHost) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : "";
    const { headers, fullPathWithQuery } = signRequest(method, path, query, userToken, bodyStr, targetHost);

    const reqOptions = {
      hostname: targetHost,
      path: fullPathWithQuery,
      method: method.toUpperCase(),
      headers: headers,
      timeout: 15000
    };

    if (proxyAgent) {
      reqOptions.agent = proxyAgent;
    }

    const clientReq = https.request(reqOptions, (res) => {
      let data = "";

      // Auto-extract and refresh guest JWT token from response headers
      if (res.headers['x-user']) {
        try {
          const u = JSON.parse(res.headers['x-user']);
          if (u.token) {
            userToken = u.token;
          }
        } catch(e) {}
      }

      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve({ code: -1, message: "Invalid JSON response", raw: data });
        }
      });
    });

    clientReq.on("error", (err) => {
      reject(err);
    });

    if (bodyStr) clientReq.write(bodyStr);
    clientReq.end();
  });
}

// 6. Resilient API Request Executor with Automatic Gateway Failover
async function makeApiRequest(method, path, query = "", body = null) {
  let lastResult = null;
  // Try activeHost first
  try {
    const res = await executeSingleApiRequest(method, path, query, body, activeHost);
    if (res && (res.code === 0 || res.code === 200)) {
      return res;
    }
    lastResult = res;
  } catch (err) {
    lastResult = { code: -1, error: err.message };
  }

  // If activeHost returned an error (such as 406 "find no content") or network error, failover to other hosts
  for (const host of HOSTS) {
    if (host === activeHost) continue;
    try {
      const res = await executeSingleApiRequest(method, path, query, body, host);
      if (res && (res.code === 0 || res.code === 200)) {
        console.log(`[Host Failover] Switched activeHost from ${activeHost} to ${host}`);
        activeHost = host;
        return res;
      }
      lastResult = res;
    } catch (err) {}
  }
  return lastResult;
}

// Ensure JWT token is active
async function ensureToken() {
  if (!userToken) {
    try {
      await makeApiRequest("GET", "/wefeed-mobile-bff/tab-operating");
      console.log(`[Init] Guest JWT Token initialized successfully on ${activeHost}.`);
    } catch(err) {
      console.error("[Init] Token init error:", err.message);
    }
  }
}

// ----------------- NOTEBOOK AUTHENTICATION -----------------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "#Admin@123";
const AUTH_SECRET = crypto.randomBytes(32).toString('hex');

function generateSessionToken() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(ts).digest('hex');
  return `${ts}.${sig}`;
}

function verifySessionToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [ts, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(ts).digest('hex');
  if (sig !== expectedSig) return false;
  const age = Date.now() - parseInt(ts);
  return age < 60 * 24 * 60 * 60 * 1000; // 60 days session validity
}

// Auth Middleware for protected NoteBook API routes
function requireAuth(req, res, next) {
  const headerToken = req.headers['x-auth-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const queryToken = req.query.auth;
  const token = headerToken || queryToken;

  if (!verifySessionToken(token)) {
    return res.status(401).json({ error: "Unauthorized access. Please unlock NoteBook with password." });
  }
  next();
}

// ----------------- API ROUTES -----------------

// Keep-Alive / Health Endpoint (Public)
app.get('/ping', (req, res) => {
  res.json({ status: "alive", timestamp: Date.now() });
});

// Diagnostic & Gateway Status Endpoint
app.get('/api/diagnose', async (req, res) => {
  const pwd = req.query.pwd || req.query.password;
  const authHeader = req.headers['x-auth-token'] || req.query.auth;
  if (pwd !== ADMIN_PASSWORD && !verifySessionToken(authHeader)) {
    return res.status(401).json({ error: "Unauthorized. Pass ?password=#Admin@123 or header x-auth-token." });
  }

  const results = {
    activeHost,
    hosts: HOSTS,
    region: CLIENT_REGION,
    timezone: CLIENT_TIMEZONE,
    sp_code: CLIENT_SP_CODE,
    hasProxy: !!proxyAgent,
    hasToken: !!userToken,
    serverTime: new Date().toISOString()
  };

  // 1. Get server egress IP
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    results.egressIp = await ipRes.json();
  } catch(e) {
    results.egressIp = { error: e.message };
  }

  // 2. Test candidate hosts
  results.tests = {};
  for (const host of HOSTS) {
    try {
      const tab = await executeSingleApiRequest("GET", "/wefeed-mobile-bff/tab-operating", "", null, host);
      const detail = await executeSingleApiRequest("GET", "/wefeed-mobile-bff/subject-api/get", "subjectId=9107376937579734040", null, host);
      results.tests[host] = {
        tabCode: tab?.code,
        tabBanner: tab?.data?.items?.[0]?.title || "none",
        detailCode: detail?.code,
        detailMessage: detail?.message,
        detailTitle: detail?.data?.title || "none",
        detectorsCount: detail?.data?.resourceDetectors?.length || 0
      };
    } catch(err) {
      results.tests[host] = { error: err.message };
    }
  }

  res.json(results);
});

// Login Endpoint (Verify NoteBook Password)
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = generateSessionToken();
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: "Incorrect NoteBook password" });
});

// Auth Verification Endpoint
app.get('/api/auth-check', (req, res) => {
  const headerToken = req.headers['x-auth-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const queryToken = req.query.auth;
  const token = headerToken || queryToken;
  if (verifySessionToken(token)) {
    return res.json({ authenticated: true });
  }
  return res.status(401).json({ authenticated: false });
});

// Home Catalog Feed (Protected)
app.get('/api/home', requireAuth, async (req, res) => {
  try {
    await ensureToken();
    const data = await makeApiRequest("GET", "/wefeed-mobile-bff/tab-operating");
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Movie / Series Detail Metadata (Protected)
app.get('/api/detail', requireAuth, async (req, res) => {
  try {
    await ensureToken();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing 'id' parameter" });
    const data = await makeApiRequest("GET", "/wefeed-mobile-bff/subject-api/get", `subjectId=${id}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seasons & Episode Counts for Web Series / Dramas (Protected)
app.get('/api/season-info', requireAuth, async (req, res) => {
  try {
    await ensureToken();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing 'id' parameter" });
    const data = await makeApiRequest("GET", "/wefeed-mobile-bff/subject-api/season-info", `subjectId=${id}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Video Streaming Proxy (Protected)
app.get('/api/stream', requireAuth, (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("Missing 'url' query parameter");

  try {
    const parsedUrl = new URL(targetUrl);
    const clientHeaders = {
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; TECNO LH7n Build/TP1A.220624.014)',
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'Host': parsedUrl.hostname
    };

    if (req.headers.range) {
      clientHeaders['Range'] = req.headers.range;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const clientReq = client.get(parsedUrl, { headers: clientHeaders }, (cdnRes) => {
      // Forward HTTP status code (200 OK or 206 Partial Content)
      res.status(cdnRes.statusCode);

      // Forward headers required by browser video player for seeking & duration calculation
      const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
      forwardHeaders.forEach(h => {
        if (cdnRes.headers[h]) {
          res.setHeader(h, cdnRes.headers[h]);
        }
      });

      if (!cdnRes.headers['content-type']) {
        res.setHeader('Content-Type', 'video/mp4');
      }

      cdnRes.pipe(res);
    });

    clientReq.on('error', (err) => {
      console.error('Stream proxy error:', err.message);
      if (!res.headersSent) res.status(502).send('Error proxying media stream');
    });

    req.on('close', () => {
      clientReq.destroy();
    });
  } catch (err) {
    res.status(400).send('Invalid target URL');
  }
});

// Video Streaming Links (Extracts real movies from resourceDetectors just like the APK)
app.get('/api/play-info', requireAuth, async (req, res) => {
  try {
    await ensureToken();
    const { id, se = 0, ep = 0 } = req.query;
    if (!id) return res.status(400).json({ error: "Missing 'id' parameter" });

    const authParam = encodeURIComponent(req.query.auth || req.headers['x-auth-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
    let streams = [];
    let movieTitle = "";

    // 1. Fetch Subject Detail (where real movie streams reside in resourceDetectors)
    try {
      const detail = await makeApiRequest("GET", "/wefeed-mobile-bff/subject-api/get", `subjectId=${id}`);
      if (detail.data) {
        movieTitle = detail.data.title || "";
        const detectors = detail.data.resourceDetectors || [];
        for (const detector of detectors) {
          // Check resolutionList (480p, 720p, 1080p etc.)
          if (detector.resolutionList && detector.resolutionList.length > 0) {
            for (const resItem of detector.resolutionList) {
              if (resItem.resourceLink) {
                streams.push({
                  format: "MP4",
                  resolutions: resItem.resolution ? resItem.resolution.toString() : "1080",
                  duration: resItem.duration || 0,
                  size: resItem.size || 0,
                  url: `/api/stream?url=${encodeURIComponent(resItem.resourceLink)}&auth=${authParam}`,
                  rawUrl: resItem.resourceLink,
                  source: "resourceDetector"
                });
              }
            }
          } else if (detector.downloadUrl || detector.resourceLink) {
            const directLink = detector.downloadUrl || detector.resourceLink;
            if (directLink && directLink.startsWith('http') && (directLink.includes('.mp4') || directLink.includes('bcdn.'))) {
              streams.push({
                format: "MP4",
                resolutions: "1080",
                duration: detector.duration || 0,
                size: detector.totalSize || detector.firstSize || 0,
                url: `/api/stream?url=${encodeURIComponent(directLink)}&auth=${authParam}`,
                rawUrl: directLink,
                source: "resourceDetector"
              });
            }
          }
        }
      }
    } catch(err) {
      console.error("Error fetching subject detail for streams:", err.message);
    }

    // 2. If it's a TV series / episode and no streams yet, query subject-api/resource
    if (streams.length === 0 && (parseInt(ep) > 0 || parseInt(se) > 0)) {
      try {
        const epFrom = Math.max(1, parseInt(ep) || 1);
        const epTo = epFrom;
        const seVal = Math.max(1, parseInt(se) || 1);
        const epRes = await makeApiRequest("GET", "/wefeed-mobile-bff/subject-api/resource", `epFrom=${epFrom}&epTo=${epTo}&se=${seVal}&subjectId=${id}`);
        if (epRes.data && epRes.data.list && epRes.data.list.length > 0) {
          for (const item of epRes.data.list) {
            if (item.resourceLink && !item.resourceLink.includes('80da52722ee7de7a4303290af6783424.mp4')) {
              streams.push({
                format: "MP4",
                resolutions: item.resolution ? item.resolution.toString() : "480",
                duration: item.duration || 0,
                size: item.size || 0,
                url: `/api/stream?url=${encodeURIComponent(item.resourceLink)}&auth=${authParam}`,
                rawUrl: item.resourceLink,
                source: "episodeResource"
              });
            }
          }
        }
      } catch(err) {
        console.error("Error fetching episode resource:", err.message);
      }
    }

    // 3. Fallback to play-info only if no detector stream was found
    if (streams.length === 0) {
      try {
        const query = `ep=${ep}&se=${se}&subjectId=${id}`;
        const data = await makeApiRequest("GET", "/wefeed-mobile-bff/subject-api/play-info", query);
        if (data.data && data.data.streams) {
          for (const s of data.data.streams) {
            streams.push({
              format: s.format || "MP4",
              resolutions: s.resolutions || "Auto",
              duration: s.duration,
              size: s.size,
              url: `/api/stream?url=${encodeURIComponent(s.url)}&auth=${authParam}`,
              rawUrl: s.url,
              source: "playInfo"
            });
          }
        }
      } catch(err) {
        console.error("Error fetching play-info fallback:", err.message);
      }
    }

    // Sort descending by resolution (1080p > 720p > 480p > 360p)
    streams.sort((a, b) => (parseInt(b.resolutions) || 0) - (parseInt(a.resolutions) || 0));

    res.json({
      code: 0,
      message: "ok",
      data: {
        title: movieTitle,
        streams: streams
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Full Search API (POST /wefeed-mobile-bff/subject-api/search/v2) (Protected)
app.get('/api/search', requireAuth, async (req, res) => {
  try {
    await ensureToken();
    const { q, page = 1 } = req.query;
    if (!q) return res.status(400).json({ error: "Missing 'q' query parameter" });

    const body = { page: parseInt(page) || 1, perPage: 20, keyword: q };
    const data = await makeApiRequest("POST", "/wefeed-mobile-bff/subject-api/search/v2", "", body);

    let items = [];
    if (data.data && data.data.results) {
      items = data.data.results.flatMap(r => r.subjects || []);
    }

    res.json({
      code: 0,
      message: "ok",
      data: {
        keyword: q,
        items: items
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search Suggestions API (Protected)
app.get('/api/search-suggest', requireAuth, async (req, res) => {
  try {
    await ensureToken();
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Missing 'q' query parameter" });
    const query = `keyword=${encodeURIComponent(q)}&perPage=8&resultMode=1`;
    const data = await makeApiRequest("GET", "/wefeed-mobile-bff/subject-api/search-suggest", query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fallback to index.html for single page app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server & Self-Ping Keep-Alive
app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(` NoteBook Server running on port ${PORT}`);
  console.log(` Open locally: http://localhost:${PORT}`);
  console.log(` Protected with password authentication`);
  console.log(`===============================================`);
  await ensureToken();

  // Self-Ping mechanism to prevent Render from sleeping (every 10 minutes)
  const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_EXTERNAL_URL) {
    console.log(`[Keep-Alive] Configured for ${RENDER_EXTERNAL_URL}`);
    setInterval(() => {
      https.get(`${RENDER_EXTERNAL_URL}/ping`, (res) => {
        console.log(`[Keep-Alive] Pinged ${RENDER_EXTERNAL_URL}/ping - Status: ${res.statusCode}`);
      }).on('error', (e) => {
        console.log('[Keep-Alive] Ping failed:', e.message);
      });
    }, 10 * 60 * 1000); // 10 minutes
  }
});
