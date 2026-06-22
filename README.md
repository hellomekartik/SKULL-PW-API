# StudyRatna Key + Playback API

A Cloudflare Worker that sits between you and StudyRatna. It automatically
fetches the live AES encryption key from the StudyRatna website, hits the
playback manifest API, decrypts the response, and returns everything you
need to play a video — in one request.

---

## Routes

### `GET /`
Returns the live AES encryption key fetched fresh from StudyRatna's JS source.
Key is always re-fetched — never cached. So even if StudyRatna rotates the key,
this always returns the current one.

**Request:**
```
GET https://YOUR_WORKER.workers.dev/
```

**Response:**
```json
{
  "key_string":  "df7243b0dbaf5cc0ae97c7ae26415a4735c79b60879bc1da2588a76239488aa6",
  "aes_key_hex": "fc7fdcb4fce4c1ee232c9c5d7a0613264da186a898910539f05a3666b5359296"
}
```

---

### `GET /?batchId=&subjectId=&lectureId=`
Fetches the AES key + hits the StudyRatna playback manifest API — both in
parallel. Decrypts the response and returns the full signed video URLs (M3U8
and MPD), the DRM KID, and the ClearKey.

**Request:**
```
GET https://YOUR_WORKER.workers.dev/?batchId=698ad3519549b300a5e1cc6a&subjectId=69b569aeeffdf9567d75f816&lectureId=6a2c546d5a440ad1a6b91cd1
```

**Response:**
```json
{
  "videoUrl_m3u8": "https://sec-prod-mediacdn.pw.live/.../master.m3u8?URLPrefix=...&Expires=...&KeyName=pw-prod-key&Signature=...",
  "videoUrl_mpd":  "https://sec-prod-mediacdn.pw.live/.../master.mpd?URLPrefix=...&Expires=...&KeyName=pw-prod-key&Signature=...",
  "kid": "5c4448e5621d38660034ec832f9ee1ea",
  "key": "ffdb209f1ad2ed800b97be1f31617d97"
}
```

Both `videoUrl_m3u8` and `videoUrl_mpd` are fully signed and ready to play —
no need to append anything.

---

## Deploy (5 steps)

**1. Install Node.js** — https://nodejs.org (v18+)

**2. Install Wrangler:**
```bash
npm install -g wrangler
```

**3. Login to Cloudflare:**
```bash
wrangler login
```

**4. Install and deploy:**
```bash
cd studyratna-worker
npm install
npm run deploy
```

**5. Your API is live at:**
```
https://studyratna-worker.YOUR_SUBDOMAIN.workers.dev
```

---

## Local testing
```bash
npm run dev
# Runs at http://localhost:8787
```
