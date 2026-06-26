/**
 * SKULLPWAPI — Cloudflare Worker
 *
 * Routes:
 *   GET /                              → list all available routes
 *   GET /keys                          → live decryption keys from pw4free.in bundle (with fallback status)
 *   GET /?batchId=<id>&lectureId=<id>  → full pipeline → signed MPD URL + KID (local) + content key
 *
 * Pipeline:
 *   1. Fetch AES keys live from pw4free.in JS bundle (fallback to hardcoded if bundle unreachable)
 *   2. Call liteapi videodetails → decrypt response → get MPD URL + signedUrl
 *   3. Fetch MPD → extract KID LOCALLY from XML
 *   4. Call liteapi getotp?kid=<kid> → decrypt → get content key
 *   5. Return signedMpdUrl + kid + clearKey
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const LITE_API   = 'https://liteapi.pw4free.in/api/v1';
const BUNDLE_URL = 'https://lite.pw4free.in/assets/index-DstjwWLi.js';

// Hardcoded fallback — extracted from bundle 2026-06
const FB_KEY = 'c1b352360b3a99ff358d277aa7f6ae54d34981725c599537fb922fda68847e7a';
const FB_IV  = '7c3dec87ad88b4b97459f983d3d5cd14';

const FETCH_TIMEOUT_MS = 10_000; // 10 s per upstream call

// ─── Utilities ────────────────────────────────────────────────────────────────

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < hex.length; i += 2)
    b[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}

/** AES-256-CBC decrypt via native WebCrypto — no external deps */
async function aesDecrypt(base64cipher, keyHex, ivHex) {
  const cipherBytes = Uint8Array.from(atob(base64cipher), c => c.charCodeAt(0));
  const cryptoKey   = await crypto.subtle.importKey(
    'raw', hexToBytes(keyHex), { name: 'AES-CBC' }, false, ['decrypt']
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: hexToBytes(ivHex) },
    cryptoKey,
    cipherBytes
  );
  return new TextDecoder().decode(plain);
}

/** Unwrap { data: "<base64 encrypted>" } envelope */
async function decryptEnvelope(rawJson, keyHex, ivHex) {
  if (rawJson && typeof rawJson.data === 'string') {
    const plain = await aesDecrypt(rawJson.data, keyHex, ivHex);
    return JSON.parse(plain);
  }
  return rawJson;
}

/** fetch() with AbortController timeout */
async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── KID extraction — LOCAL, from MPD XML text ───────────────────────────────

/**
 * Extracts KID directly from the MPD XML string — no extra network call.
 * Purely local regex over the already-fetched MPD text.
 */
function extractKidLocally(mpdText) {
  const m = mpdText.match(/default_KID="([0-9a-fA-F-]{32,36})"/i);
  if (m) return m[1].replace(/-/g, '').toLowerCase();
  return null;
}

// ─── Key management ───────────────────────────────────────────────────────────

let _cachedKeys = null; // worker-lifetime in-memory cache

async function fetchLiveKeys() {
  try {
    const resp = await fetchWithTimeout(BUNDLE_URL, {
      cf:      { cacheTtl: 3600, cacheEverything: true },
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!resp.ok)
      throw new Error(`Bundle HTTP ${resp.status}`);

    const js    = await resp.text();
    const key64 = js.match(/'([0-9a-f]{64})'/)?.[1];
    const key32 = js.match(/'([0-9a-f]{32})'/)?.[1];

    if (!key64 || !key32)
      throw new Error('Keys not found in bundle — bundle may have changed');

    return {
      aesKey: key64,
      aesIv:  key32,
      status: 'live',
      note:   'Keys fetched fresh from pw4free.in JS bundle'
    };
  } catch (err) {
    return {
      aesKey:     FB_KEY,
      aesIv:      FB_IV,
      status:     'fallback',
      note:       'Could not reach pw4free.in bundle — using hardcoded fallback keys',
      fetchError: err.message
    };
  }
}

async function getKeys(forceRefresh = false) {
  if (!_cachedKeys || forceRefresh) _cachedKeys = await fetchLiveKeys();
  return _cachedKeys;
}

// ─── Upstream API helpers ─────────────────────────────────────────────────────

const PW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Referer':    'https://lite.pw4free.in/',
  'Origin':     'https://lite.pw4free.in'
};

async function liteGet(path) {
  let resp;
  try {
    resp = await fetchWithTimeout(`${LITE_API}${path}`, { headers: PW_HEADERS });
  } catch (e) {
    throw new Error(`pw4free.in unreachable (${path}): ${e.message}`);
  }
  if (!resp.ok)
    throw new Error(`pw4free.in returned HTTP ${resp.status} for ${path}`);
  return resp.json();
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
    version: '1.1.0',
    routes: [
      {
        path:        'GET /',
        description: 'Lists all available routes (this page)'
      },
      {
        path:        'GET /keys',
        description: 'Returns live AES decryption keys fetched from pw4free.in JS bundle. Shows whether keys are live or fallback, with reason.'
      },
      {
        path:        'GET /?batchId=<BATCH_ID>&lectureId=<LECTURE_ID>',
        description: 'Full pipeline: decrypt videodetails → fetch MPD → extract KID locally → decrypt OTP → returns signedMpdUrl + kid + clearKey',
        example:     '/?batchId=698ad3519549b300a5e1cc6a&lectureId=69ff18a7ef0d5bb3113d55b1'
      }
    ]
  });
}

async function handleKeys() {
  const keys = await getKeys(true); // always force-fresh on /keys
  return jsonResp({
    aesKey:     keys.aesKey,
    aesIv:      keys.aesIv,
    status:     keys.status,       // "live" | "fallback"
    note:       keys.note,
    ...(keys.fetchError ? { fetchError: keys.fetchError } : {})
  });
}

async function handleDecrypt(batchId, lectureId) {
  if (!batchId || !batchId.trim())
    return errResp('Missing or empty batchId query param', 400);
  if (!lectureId || !lectureId.trim())
    return errResp('Missing or empty lectureId query param', 400);

  // 1. Get decryption keys
  const keys = await getKeys();

  // 2. Fetch + decrypt videodetails
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
    return errResp(`Failed to decrypt videodetails response: ${e.message}`, 502, { step: 'videodetails_decrypt' });
  }

  if (!details.success)
    return errResp('videodetails API returned failure', 502, {
      step:     'videodetails_parse',
      upstream: details
    });

  const { url: mpdBase, signedUrl } = details.data ?? {};
  if (!mpdBase || !signedUrl)
    return errResp('No MPD url/signedUrl in videodetails response', 502, {
      step:     'videodetails_parse',
      received: details.data
    });

  const signedMpdUrl = mpdBase + signedUrl;

  // 3. Fetch MPD
  let mpdText;
  try {
    const mpdResp = await fetchWithTimeout(signedMpdUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cf:      { cacheTtl: 300 }
    });
    if (!mpdResp.ok)
      return errResp(`MPD fetch failed: HTTP ${mpdResp.status}`, 502, {
        step:         'mpd_fetch',
        signedMpdUrl: signedMpdUrl.slice(0, 120) + '...'
      });
    mpdText = await mpdResp.text();
  } catch (e) {
    return errResp(`MPD fetch error: ${e.message}`, 502, { step: 'mpd_fetch' });
  }

  // 4. Extract KID locally from MPD XML — no extra network call
  const kid = extractKidLocally(mpdText);
  if (!kid)
    return errResp('No KID found in MPD XML', 502, {
      step:       'kid_extraction',
      mpdPreview: mpdText.slice(0, 600)
    });

  // 5. Fetch + decrypt OTP (content key)
  let rawOtp;
  try {
    rawOtp = await liteGet(`/getotp?kid=${kid}`);
  } catch (e) {
    return errResp(`getotp fetch failed: ${e.message}`, 502, { step: 'getotp_fetch' });
  }

  let otp;
  try {
    otp = await decryptEnvelope(rawOtp, keys.aesKey, keys.aesIv);
  } catch (e) {
    return errResp(`getotp decrypt failed: ${e.message}`, 502, { step: 'getotp_decrypt' });
  }

  const clearKey = otp.clearKeys?.[kid];
  if (!clearKey)
    return errResp('Content key not found in OTP response', 502, {
      step: 'getotp_parse',
      otp
    });

  // 6. Return
  return jsonResp({
    success:      true,
    signedMpdUrl,
    kid,
    clearKey,
    keysStatus:   keys.status,
    videoMeta: {
      videoId:        details.data.videoId,
      videoContainer: details.data.videoContainer,
      cdnType:        details.data.cdnType,
      isCmaf:         details.data.isCmaf,
      scheduleInfo:   details.data.scheduleInfo
    }
  });
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request) {
    // OPTIONS preflight
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (request.method !== 'GET')
      return errResp('Method not allowed. Only GET is supported.', 405);

    const url       = new URL(request.url);
    const path      = url.pathname;
    const batchId   = url.searchParams.get('batchId');
    const lectureId = url.searchParams.get('lectureId');

    try {
      // GET / — no params
      if (path === '/' && !batchId && !lectureId)
        return handleIndex();

      // GET /keys
      if (path === '/keys')
        return handleKeys();

      // GET /?batchId=&lectureId=
      if (path === '/' && (batchId || lectureId))
        return handleDecrypt(batchId, lectureId);

      // Unknown route
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
      
