# StudyRatna Key Engine — Cloudflare Worker

## Deploy kaise karein (Step by Step)

### Step 1 — Node.js install karo (agar nahi hai)
```bash
# Windows: nodejs.org se download karo
# Mac:
brew install node
```

### Step 2 — Wrangler CLI install karo
```bash
npm install -g wrangler
```

### Step 3 — Cloudflare login karo
```bash
wrangler login
# Browser mein Cloudflare account se login karo
```

### Step 4 — Project folder mein jao
```bash
cd studyratna-worker
npm install
```

### Step 5 — Local test karo (optional)
```bash
npm run dev
# http://localhost:8787 pe open hoga
```

### Step 6 — Deploy karo
```bash
npm run deploy
# Output: https://studyratna-worker.YOUR_SUBDOMAIN.workers.dev
```

---

## API Routes

| Method | Route           | Description                              |
|--------|-----------------|------------------------------------------|
| GET    | `/`             | Live key fetch (1hr cached)              |
| GET    | `/key`          | Same as above                            |
| GET    | `/key?refresh=true` | Force re-fetch from JS source        |
| GET    | `/health`       | Health check                             |
| POST   | `/decrypt`      | Decrypt an encrypted string              |
| POST   | `/decrypt-full` | Fetch API URL + auto decrypt in one shot |

---

## Usage Examples

### Get live key:
```bash
curl https://studyratna-worker.YOUR.workers.dev/key
```

Response:
```json
{
  "success": true,
  "cached": false,
  "latency_ms": 312,
  "key_string": "df7243b0dbaf5cc0ae97c7ae26415a4735c79b60879bc1da2588a76239488aa6",
  "aes_key_hex": "fc7fdcb4fce4c1ee232c9c5d7a0613264da186a898910539f05a3666b5359296",
  "algorithm": "AES-256-CBC",
  "derivation": "SHA256(key_string)",
  "fetched_at": "2026-06-22T07:00:00.000Z"
}
```

### Decrypt encrypted string:
```bash
curl -X POST https://studyratna-worker.YOUR.workers.dev/decrypt \
  -H "Content-Type: application/json" \
  -d '{"encrypted":"IV_HEX:CIPHER_HEX"}'
```

### Full pipeline (fetch API + decrypt in one shot):
```bash
curl -X POST https://studyratna-worker.YOUR.workers.dev/decrypt-full \
  -H "Content-Type: application/json" \
  -d '{
    "api_url": "https://api-lite.studyratna.org/V1/web/pw/playback-manifest/69e595902715bc04ca450fff/698ad3519549b300a5e1cc6a/69b5698ee506a608ee297ed1"
  }'
```

---

## Speed Optimisations

- **CF Edge Cache**: JS chunks cached 1hr at Cloudflare edge (not hitting studyratna server every request)
- **In-memory cache**: Key cached in Worker isolate memory for 1hr — zero latency on repeat calls
- **Parallel fetch**: All JS chunks fetched simultaneously — stops at first match
- **Priority chunk**: Known chunk (`0soxf3iz6lfuq.js`) checked first — usually hits on first try
- **SubtleCrypto**: Browser-native AES + SHA256 — no external crypto library needed
- **parallel key + API fetch**: `/decrypt-full` fetches key AND API simultaneously
