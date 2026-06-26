/**
 * SKULLPWAPI — Cloudflare Worker
 *
 * Routes:
 *   GET /                              → list all available routes
 *   GET /keys                          → live decryption keys from pw4free.in bundle
 *   GET /?batchId=<id>&lectureId=<id>  → full pipeline → signed MPD URL + KID + clearKey
 *
 * Pipeline:
 *   1. Keys: use cache instantly (fallback hardcoded on cold start, bg-warms for next req)
 *   2. videodetails → decrypt → MPD URL + signedUrl
 *   3. MPD first 8KB only (Range header) → extract KID locally from XML
 *   4. getotp → decrypt → clearKey
 *   5. Return signedMpdUrl + kid + clearKey
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const LITE_API   = 'https://liteapi.pw4free.in/api/v1';
const BUNDLE_URL = 'https://lite.pw4free.in/assets/index-DstjwWLi.js';

const FB_KEY = 'c1b352360b3a99ff358d277aa7f6ae54d34981725c599537fb922fda68847e7a';
const FB_IV  = '7c3dec87ad88b4b97459f983d3d5cd14';

const FETCH_TIMEOUT_MS  = 8_000;  // per attempt
const RETRY_ATTEMPTS    = 3;
const RETRY_DELAY_MS    = 300;    // doubles each retry: 300 → 600 → 1200

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
    { name: 'AES-CBC', iv: hexToBytes(ivHex) },
    cryptoKey, cipherBytes
  );
  return new TextDecoder().decode(plain);
}

async function decryptEnvelope(rawJson, keyHex, ivHex) {
  if (rawJson?.data && typeof rawJson.data === 'string') {
    const plain = await aesDecrypt(rawJson.data, keyHex, ivHex);
    return JSON.parse(plain);
  }
  return rawJson;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

/**
 * Retry wrapper — up to RETRY_ATTEMPTS attempts, exponential backoff.
 * fn: async function that throws on failure.
 */
async function withRetry(fn, label = '') {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error(
    `${label} failed after ${RETRY_ATTEMPTS} attempts — last error: ${lastErr.message}`
  );
}

// ─── Key management ───────────────────────────────────────────────────────────

let _cachedKeys = null;

async function fetchLiveKeys() {
  return withRetry(async () => {
    const resp = await fetchWithTimeout(BUNDLE_URL, {
      cf:      { cacheTtl: 3600, cacheEverything: true },
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!resp.ok) throw new Error(`Bundle HTTP ${resp.status}`);

    const js    = await resp.text();
    const key64 = js.match(/'([0-9a-f]{64})'/)?.[1];
    const key32 = js.match(/'([0-9a-f]{32})'/)?.[1];
    if (!key64 || !key32) throw new Error('Keys not found in bundle');

    return { aesKey: key64, aesIv: key32, status: 'live', note: 'Fetched from pw4free.in JS bundle' };
  }, 'bundle_fetch').catch(err => ({
    aesKey:     FB_KEY,
    aesIv:      FB_IV,
    status:     'fallback',
    note:       'Bundle unreachable — using hardcoded fallback keys',
    fetchError: err.message
  }));
}

/**
 * Returns keys instantly:
 *   - If cache is warm → return immediately (zero cost)
 *   - If cache is cold → return fallback NOW, fire background warm via ctx.waitUntil()
 *
 * ctx is the CF ExecutionContext passed from the main handler.
 */
function getKeys(ctx, forceRefresh = false) {
  if (_cachedKeys && !forceRefresh) return Promise.resolve(_cachedKeys);

  // Warm cache in background; return fallback immediately so pipeline doesn't stall
  const warmPromise = fetchLiveKeys().then(k => { _cachedKeys = k; return k; });
  ctx.waitUntil(warmPromise); // keep worker alive until cache is warm

  // Return fallback synchronously (wrapped in Promise) — pipeline proceeds instantly
  return Promise.resolve({
    aesKey: FB_KEY,
    aesIv:  FB_IV,
    status: 'fallback',
    note:   'Cold start — using hardcoded keys, cache warming in background'
  });
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
  if (m) return m[1].replace(/-/g, '').toLowerCase();
  return null;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
  });
}

function errResp(message, status = 500, extra = {}) {
  return jsonResp({ success: false, error: message, ...extra }, status);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function handleIndex() {
  return jsonResp({
    service: 'SKULLPWAPI',
    version: '1.2.0',
    routes: [
      {
        path:        'GET /',
        description: 'Lists all available routes (this page)'
      },
      {
        path:        'GET /keys',
        description: 'Returns live AES decryption keys from pw4free.in JS bundle. Reports live vs fallback status with reason.'
      },
      {
        path:        'GET /?batchId=<BATCH_ID>&lectureId=<LECTURE_ID>',
        description: 'Full pipeline: videodetails → MPD (first 8KB) → KID local extract → OTP → signedMpdUrl + kid + clearKey',
        example:     '/?batchId=698ad3519549b300a5e1cc6a&lectureId=69ff18a7ef0d5bb3113d55b1'
      }
    ]
  });
}

async function handleKeys(ctx) {
  // Force a fresh live fetch, update cache
  const keys = await fetchLiveKeys();
  _cachedKeys = keys;
  return jsonResp({
    aesKey:     keys.aesKey,
    aesIv:      keys.aesIv,
    status:     keys.status,
    note:       keys.note,
    ...(keys.fetchError ? { fetchError: keys.fetchError } : {})
  });
}

async function handleDecrypt(batchId, lectureId, ctx) {
  if (!batchId?.trim()) return errResp('Missing or empty batchId query param', 400);
  if (!lectureId?.trim()) return errResp('Missing or empty lectureId query param', 400);

  // 1. Keys — instant (fallback on cold start, cache warms in background)
  const keys = await getKeys(ctx);

  // 2. videodetails
  let rawDetails;
  try {
    rawDetails = await liteGet(
      `/videodetails?batchId=${encodeURIComponent(batchId)}&lectureId=${encodeURIComponent(lectureId)}`
    );
  } catch (e) {
    return errResp(e.message, 502, { step: 'videodetails_fetch' });
  }

  let details;
  try {
    details = await decryptEnvelope(rawDetails, keys.aesKey, keys.aesIv);
  } catch (e) {
    return errResp(`videodetails decrypt failed: ${e.message}`, 502, { step: 'videodetails_decrypt' });
  }

  if (!details.success)
    return errResp('videodetails API returned failure', 502, { step: 'videodetails_parse', upstream: details });

  const { url: mpdBase, signedUrl } = details.data ?? {};
  if (!mpdBase || !signedUrl)
    return errResp('No MPD url/signedUrl in response', 502, { step: 'videodetails_parse', received: details.data });

  const signedMpdUrl = mpdBase + signedUrl;

  // 3. Fetch FIRST 8KB of MPD only — KID is always in the XML header
  let mpdText;
  try {
    const mpdResp = await withRetry(() =>
      fetchWithTimeout(signedMpdUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-8191' },
        cf:      { cacheTtl: 300 }
      }), 'mpd_fetch'
    );
    // Accept 200 (server ignores Range) or 206 (partial content)
    if (mpdResp.status !== 200 && mpdResp.status !== 206)
      return errResp(`MPD fetch failed: HTTP ${mpdResp.status}`, 502, { step: 'mpd_fetch' });
    mpdText = await mpdResp.text();
  } catch (e) {
    return errResp(`MPD fetch error: ${e.message}`, 502, { step: 'mpd_fetch' });
  }

  // 4. Extract KID locally from XML
  const kid = extractKidLocally(mpdText);
  if (!kid)
    return errResp('No KID found in MPD XML', 502, { step: 'kid_extraction', mpdPreview: mpdText.slice(0, 600) });

  // 5. getotp → clearKey
  let rawOtp;
  try {
    rawOtp = await liteGet(`/getotp?kid=${kid}`);
  } catch (e) {
    return errResp(e.message, 502, { step: 'getotp_fetch' });
  }

  let otp;
  try {
    otp = await decryptEnvelope(rawOtp, keys.aesKey, keys.aesIv);
  } catch (e) {
    return errResp(`getotp decrypt failed: ${e.message}`, 502, { step: 'getotp_decrypt' });
  }

  const clearKey = otp.clearKeys?.[kid];
  if (!clearKey)
    return errResp('Content key not found in OTP response', 502, { step: 'getotp_parse', otp });

  // 6. Done
  return jsonResp({
    success:     true,
    signedMpdUrl,
    kid,
    clearKey,
    keysStatus:  keys.status,
    videoMeta: {
      videoId:        details.data.videoId,
      videoContainer: details.data.videoContainer,
      cdnType:        details.data.cdnType,
      isCmaf:         details.data.isCmaf,
      scheduleInfo:   details.data.scheduleInfo
    }
  });
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
      if (path === '/' && !batchId && !lectureId)   return handleIndex();
      if (path === '/keys')                          return handleKeys(ctx);
      if (path === '/' && (batchId || lectureId))   return handleDecrypt(batchId, lectureId, ctx);

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
                   
