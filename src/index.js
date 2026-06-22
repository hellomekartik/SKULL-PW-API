const SITE_URL  = "https://app.studyratna.org";
const API_BASE  = "https://api-lite.studyratna.org/V1/web/pw/playback-manifest";
const KEY_REGEX = /NEXT_PUBLIC_WEB_ENCRYPTION_KEY\s*\|\|\s*["']([a-f0-9]{64})["']/;
const UA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// ── Utils ─────────────────────────────────────────────────────────
async function sha256Hex(str) {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ── Fetch live AES key (always fresh, no cache) ───────────────────
async function fetchLiveKey() {
  const html   = await fetch(SITE_URL, { headers: { "User-Agent": UA } }).then(r => r.text());
  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"'>\s]+\.js/g)].map(m => m[0]))];

  const rawKey = await new Promise((resolve, reject) => {
    let done = false, errs = 0;
    for (const path of chunks) {
      fetch(SITE_URL + path, { headers: { "User-Agent": UA } })
        .then(r => r.text())
        .then(text => {
          if (done) return;
          const m = KEY_REGEX.exec(text);
          if (m) { done = true; resolve(m[1]); }
          else if (++errs === chunks.length && !done) reject(new Error("Key not found"));
        })
        .catch(() => { if (++errs === chunks.length && !done) reject(new Error("All chunks failed")); });
    }
  });

  const aesKeyHex = await sha256Hex(rawKey);
  return { rawKey, aesKeyHex };
}

// ── AES-256-CBC decrypt ───────────────────────────────────────────
async function decrypt(encryptedStr, aesKeyHex) {
  const [ivHex, cipherHex] = encryptedStr.split(":");
  const cryptoKey = await crypto.subtle.importKey(
    "raw", hexToBytes(aesKeyHex), { name: "AES-CBC" }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: hexToBytes(ivHex) },
    cryptoKey,
    hexToBytes(cipherHex)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// ── Build full signed MPD URL ────────────────────────────────────
function buildSignedMpdUrl(videoUrl, signedUrl) {
  const params  = signedUrl.startsWith("?") ? signedUrl : "?" + signedUrl;
  const baseDir = videoUrl.substring(0, videoUrl.lastIndexOf("/") + 1);

  // Ab yeh function sirf signed MPD string return karega
  return baseDir + "master.mpd" + params;
}

// ── Worker ────────────────────────────────────────────────────────
export default {
  async fetch(req) {
    const url    = new URL(req.url);
    const params = url.searchParams;

    const batchId   = params.get("batchId");
    const subjectId = params.get("subjectId");
    const lectureId = params.get("lectureId");

    // ── Route: /?batchId=&subjectId=&lectureId= ───────────────────
    if (batchId && subjectId && lectureId) {
      const apiUrl = `${API_BASE}/${lectureId}/${batchId}/${subjectId}`;

      // Key fetch + API call — PARALLEL
      const [{ aesKeyHex }, apiResp] = await Promise.all([
        fetchLiveKey(),
        fetch(apiUrl, { headers: { "User-Agent": UA } }),
      ]);

      const apiJson   = await apiResp.json();
      const decrypted = await decrypt(apiJson.encrypted, aesKeyHex);

      const d         = decrypted.data;
      const ck        = d.clearkeys?.[0] ?? {};
      const signedUrl = d.videoDetails?.signedUrl ?? d.signedUrl ?? "";
      const videoUrl  = d.videoDetails?.videoUrl  ?? d.videoUrl  ?? "";

      // Sirf MPD URL generate hoga
      const mpdUrl = buildSignedMpdUrl(videoUrl, signedUrl);

      return json({
        videoUrl_mpd: mpdUrl,
        kid:          ck.kid,
        key:          ck.k,
      });
    }

    // ── Route: / (no params) → AES key info ──────────────────────
    const { rawKey, aesKeyHex } = await fetchLiveKey();
    return json({
      key_string:  rawKey,
      aes_key_hex: aesKeyHex,
    });
  },
};
