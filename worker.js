/**
 * SKULLPWAPI — Cloudflare Worker v1.4.0
 *
 * Speed layers:
 *   1. _videoCache  — full pipeline result cached by batchId:lectureId (TTL = Expires in signedUrl)
 *   2. _cachedKeys  — worker-lifetime key cache (memory)
 *   3. Turso DB     — shared key store across instances (~20ms)
 *   4. JS bundle    — only when DB empty or keys stale (auto-detected, auto-saves to DB)
 *
 * Network calls run parallel where possible.
 * Retries only on network errors / 5xx — not on 4xx (no pointless waits).
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const BUNDLE_URL       = 'https://lite.pw4free.in/assets/index-DstjwWLi.js';
const LITE_API         = 'https://liteapi.pw4free.in/api/v1';
const FETCH_TIMEOUT_MS = 5_000;   // tighter — fail faster
const RETRY_ATTEMPTS   = 3;
const RETRY_DELAY_MS   = 250;

// ─── Crypto ───────────────────────────────────────────────────────────────────

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < hex.length; i += 2)
    b[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}

async function aesDecrypt(base64cipher, keyHex, ivHex) {
  const cipherBytes = Uint8Array.from(atob(base64cipher), c => c.charCodeAt(0));
  const cryptoKey   = await crypto.subtle.importKey(
    'raw', hexToBytes(keyHex), { name: 'AES-CBC' }, false, ['decrypt']
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: hexToBytes(ivHex) }, cryptoKey, cipherBytes
  );
  return new TextDecoder().decode(plain);
}

async function decryptEnvelope(rawJson, keyHex, ivHex) {
  if (rawJson?.data && typeof rawJson.data === 'string') {
    return JSON.parse(await aesDecrypt(rawJson.data, keyHex, ivHex));
  }
  return rawJson;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timed out after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Retry only on network errors or 5xx — skip retry on 4xx (pointless)
async function withRetry(fn, label = '') {
  let lastErr;
  for (let i = 1; i <= RETRY_ATTEMPTS; i++) {
    try {
      const result = await fn();
      // If fn returns a Response, only retry on 5xx
      if (result?.status >= 400 && result?.status < 500) return result; // 4xx — return as-is
      return result;
    } catch (e) {
      lastErr = e;
      if (i < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS * i);
    }
  }
  throw new Error(`${label} failed after ${RETRY_ATTEMPTS} attempts: ${lastErr.message}`);
}

// ─── Video result cache ───────────────────────────────────────────────────────

// Keyed by "batchId:lectureId" — TTL derived from Expires param in the signedUrl
const _videoCache = new Map();

function getVideoCached(batchId, lectureId) {
  const entry = _videoCache.get(`${batchId}:${lectureId}`);
  if (entry && Date.now() < entry.expiresAt) return entry.result;
  _videoCache.delete(`${batchId}:${lectureId}`); // expired
  return null;
}

function setVideoCache(batchId, lectureId, result, signedMpdUrl) {
  const m         = signedMpdUrl.match(/[?&]Expires=(\d+)/);
  const expiresAt = m
    ? parseInt(m[1]) * 1000        // from signed URL — exact expiry
    : Date.now() + 5 * 60 * 1000;  // 5 min fallback
  _videoCache.set(`${batchId}:${lectureId}`, { result, expiresAt });
}

// ─── Turso DB ─────────────────────────────────────────────────────────────────

let _tableReady = false;

async function dbPipeline(dbUrl, dbToken, requests) {
  const resp = await fetchWithTimeout(`${dbUrl}/v2/pipeline`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${dbToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ requests: [...requests, { type: 'close' }] })
  }, 4_000);
  if (!resp.ok) throw new Error(`Turso HTTP ${resp.status}`);
  return resp.json();
}

async function ensureTable(dbUrl, dbToken) {
  if (_tableReady) return;
  await dbPipeline(dbUrl, dbToken, [{
    type: 'execute',
    stmt: { sql: `CREATE TABLE IF NOT EXISTS decryption_keys (
      id INTEGER PRIMARY KEY DEFAULT 1, aes_key TEXT NOT NULL,
      aes_iv TEXT NOT NULL, updated_at INTEGER NOT NULL)`, args: [] }
  }]);
  _tableReady = true;
}

async function getKeysFromDB(dbUrl, dbToken) {
  await ensureTable(dbUrl, dbToken);
  const data = await dbPipeline(dbUrl, dbToken, [{
    type: 'execute',
    stmt: { sql: 'SELECT aes_key, aes_iv FROM decryption_keys WHERE id = 1', args: [] }
  }]);
  const rows = data?.results?.[0]?.response?.result?.rows;
  if (rows?.length) return { aesKey: rows[0][0].value, aesIv: rows[0][1].value };
  return null;
}

async function saveKeysToDB(dbUrl, dbToken, aesKey, aesIv) {
  await ensureTable(dbUrl, dbToken);
  await dbPipeline(dbUrl, dbToken, [{
    type: 'execute',
    stmt: {
      sql:  'INSERT OR REPLACE INTO decryption_keys (id, aes_key, aes_iv, updated_at) VALUES (1, ?, ?, ?)',
      args: [{ type: 'text', value: aesKey }, { type: 'text', value: aesIv },
             { type: 'integer', value: String(Date.now()) }]
    }
  }]);
}

// ─── Key management ───────────────────────────────────────────────────────────

let _cachedKeys = null;

async function fetchKeysFromBundle() {
  return withRetry(async () => {
    const resp = await fetchWithTimeout(BUNDLE_URL, {
      cf: { cacheTtl: 3600, cacheEverything: true }, headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!resp.ok) throw new Error(`Bundle HTTP ${resp.status}`);
    const js    = await resp.text();
    const key64 = js.match(/'([0-9a-f]{64})'/)?.[1];
    const key32 = js.match(/'([0-9a-f]{32})'/)?.[1];
    if (!key64 || !key32) throw new Error('Keys not found in bundle');
    return { aesKey: key64, aesIv: key32 };
  }, 'bundle_fetch');
}

async function getKeys(ctx, env) {
  if (_cachedKeys) return _cachedKeys; // memory hit — instant

  const dbUrl   = env.DB_URL.replace('libsql://', 'https://');
  const dbToken = env.DB_TOKEN;

  try {
    const dbKeys = await getKeysFromDB(dbUrl, dbToken);
    if (dbKeys) { _cachedKeys = { ...dbKeys, source: 'db' }; return _cachedKeys; }
  } catch (_) { /* DB unreachable — fall through */ }

  const liveKeys = await fetchKeysFromBundle();
  _cachedKeys = { ...liveKeys, source: 'bundle' };
  ctx.waitUntil(saveKeysToDB(dbUrl, dbToken, liveKeys.aesKey, liveKeys.aesIv).catch(() => {}));
  return _cachedKeys;
}

async function refreshKeys(ctx, env) {
  const dbUrl   = env.DB_URL.replace('libsql://', 'https://');
  const dbToken = env.DB_TOKEN;
  const fresh   = await fetchKeysFromBundle();
  _cachedKeys   = { ...fresh, source: 'bundle_refresh' };
  await saveKeysToDB(dbUrl, dbToken, fresh.aesKey, fresh.aesIv).catch(() => {});
  return _cachedKeys;
}

// ─── Upstream API ─────────────────────────────────────────────────────────────

const PW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Referer':    'https://lite.pw4free.in/',
  'Origin':     'https://lite.pw4free.in'
};

async function liteGet(path) {
  return withRetry(async () => {
    const resp = await fetchWithTimeout(`${LITE_API}${path}`, { headers: PW_HEADERS });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }, `liteapi${path}`);
}

// ─── KID extraction — LOCAL from MPD XML ─────────────────────────────────────

function extractKidLocally(mpdText) {
  const m = mpdText.match(/default_KID="([0-9a-fA-F-]{32,36})"/i);
  return m ? m[1].replace(/-/g, '').toLowerCase() : null;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const jsonResp = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
});

const errResp = (msg, status = 500, extra = {}) =>
  jsonResp({ success: false, error: msg, ...extra }, status);

// ─── Route handlers ───────────────────────────────────────────────────────────

const handleIndex = () => jsonResp({
  service: 'SKULLPWAPI', version: '1.4.0',
  routes: [
    { path: 'GET /',                                   description: 'Lists all available routes' },
    { path: 'GET /keys',                               description: 'Current decryption keys + source' },
    { path: 'GET /?batchId=<BATCH_ID>&lectureId=<ID>', description: 'Full pipeline → signedMpdUrl + kid + clearKey (cached per video until URL expiry)', example: '/?batchId=698ad3519549b300a5e1cc6a&lectureId=69ff18a7ef0d5bb3113d55b1' }
  ]
});

async function handleKeys(ctx, env) {
  let keys;
  try {
    keys = await fetchKeysFromBundle();
    _cachedKeys = { ...keys, source: 'bundle' };
    const dbUrl = env.DB_URL.replace('libsql://', 'https://');
    await saveKeysToDB(dbUrl, env.DB_TOKEN, keys.aesKey, keys.aesIv).catch(() => {});
  } catch (_) {
    keys = _cachedKeys ?? await getKeys(ctx, env);
  }
  return jsonResp({ aesKey: keys.aesKey, aesIv: keys.aesIv, source: keys.source ?? 'bundle' });
}

async function handleDecrypt(batchId, lectureId, ctx, env) {
  if (!batchId?.trim())   return errResp('Missing or empty batchId', 400);
  if (!lectureId?.trim()) return errResp('Missing or empty lectureId', 400);

  // ── 1. Video cache hit — skip entire pipeline ─────────────────────────────
  const cached = getVideoCached(batchId, lectureId);
  if (cached) return jsonResp({ ...cached, cached: true });

  // ── 2. Keys + videodetails — run in PARALLEL ──────────────────────────────
  let keys, rawDetails;
  try {
    [keys, rawDetails] = await Promise.all([
      getKeys(ctx, env),
      liteGet(`/videodetails?batchId=${encodeURIComponent(batchId)}&lectureId=${encodeURIComponent(lectureId)}`)
    ]);
  } catch (e) {
    return errResp(e.message, 502, { step: 'init_parallel' });
  }

  // ── 3. Decrypt videodetails — auto-refresh keys if stale ─────────────────
  let details;
  try {
    details = await decryptEnvelope(rawDetails, keys.aesKey, keys.aesIv);
  } catch (_) {
    try {
      keys    = await refreshKeys(ctx, env);
      details = await decryptEnvelope(rawDetails, keys.aesKey, keys.aesIv);
    } catch (e) {
      return errResp(`videodetails decrypt failed after key refresh: ${e.message}`, 502, { step: 'videodetails_decrypt' });
    }
  }

  if (!details.success)
    return errResp('videodetails API returned failure', 502, { step: 'videodetails_parse', upstream: details });

  const { url: mpdBase, signedUrl } = details.data ?? {};
  if (!mpdBase || !signedUrl)
    return errResp('No MPD url/signedUrl in response', 502, { step: 'videodetails_parse' });

  const signedMpdUrl = mpdBase + signedUrl;

  // ── 4. MPD — first 8 KB only, KID is always in XML header ────────────────
  let mpdText;
  try {
    const mpdResp = await withRetry(() =>
      fetchWithTimeout(signedMpdUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-8191' },
        cf:      { cacheTtl: 300 }
      }), 'mpd_fetch'
    );
    if (mpdResp.status !== 200 && mpdResp.status !== 206)
      return errResp(`MPD fetch HTTP ${mpdResp.status}`, 502, { step: 'mpd_fetch' });
    mpdText = await mpdResp.text();
  } catch (e) {
    return errResp(e.message, 502, { step: 'mpd_fetch' });
  }

  // ── 5. KID locally from XML ───────────────────────────────────────────────
  const kid = extractKidLocally(mpdText);
  if (!kid)
    return errResp('No KID found in MPD XML', 502, { step: 'kid_extraction', mpdPreview: mpdText.slice(0, 600) });

  // ── 6. getotp ─────────────────────────────────────────────────────────────
  let rawOtp;
  try { rawOtp = await liteGet(`/getotp?kid=${kid}`); }
  catch (e) { return errResp(e.message, 502, { step: 'getotp_fetch' }); }

  let otp;
  try {
    otp = await decryptEnvelope(rawOtp, keys.aesKey, keys.aesIv);
  } catch (_) {
    try {
      keys = await refreshKeys(ctx, env);
      otp  = await decryptEnvelope(rawOtp, keys.aesKey, keys.aesIv);
    } catch (e) {
      return errResp(`getotp decrypt failed: ${e.message}`, 502, { step: 'getotp_decrypt' });
    }
  }

  const clearKey = otp.clearKeys?.[kid];
  if (!clearKey)
    return errResp('Content key missing in OTP response', 502, { step: 'getotp_parse' });

  // ── 7. Cache result + return ──────────────────────────────────────────────
  const result = {
    success:     true,
    signedMpdUrl,
    kid,
    clearKey,
    keysSource:  keys.source,
    videoMeta: {
      videoId:        details.data.videoId,
      videoContainer: details.data.videoContainer,
      cdnType:        details.data.cdnType,
      isCmaf:         details.data.isCmaf,
      scheduleInfo:   details.data.scheduleInfo
    }
  };

  setVideoCache(batchId, lectureId, result, signedMpdUrl);
  return jsonResp(result);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET')
      return errResp('Method not allowed. Only GET is supported.', 405);

    const url       = new URL(request.url);
    const path      = url.pathname;
    const batchId   = url.searchParams.get('batchId');
    const lectureId = url.searchParams.get('lectureId');

    try {
      if (path === '/' && !batchId && !lectureId) return handleIndex();
      if (path === '/keys')                        return handleKeys(ctx, env);
      if (path === '/' && (batchId || lectureId)) return handleDecrypt(batchId, lectureId, ctx, env);

      return errResp(
        `Unknown route: ${request.method} ${path}. Visit GET / to see available routes.`,
        404,
        { availableRoutes: ['GET /', 'GET /keys', 'GET /?batchId=<id>&lectureId=<id>'] }
      );
    } catch (e) {
      return errResp(`Unexpected server error: ${e.message}`, 500);
    }
  }
};
  
