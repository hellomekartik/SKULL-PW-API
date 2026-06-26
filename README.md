# 💀 SkullPWAPI

### ⚡ Lightning Fast Physics Wallah Playback API

Fetch signed MPD URLs, DRM Keys, and KIDs with a single request.

![API](https://img.shields.io/badge/API-Live-success?style=for-the-badge\&logo=cloudflare)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-orange?style=for-the-badge\&logo=cloudflare)
![DRM](https://img.shields.io/badge/DRM-Supported-red?style=for-the-badge)
![Edge](https://img.shields.io/badge/Edge-Distributed-blue?style=for-the-badge)

**Fast • Lightweight • Reliable**

🌐 **Live API:**
https://skullpwapi.ironskullx.workers.dev

---

# ✨ Features

## 🚀 Performance

* Ultra-fast response times
* Globally distributed edge network
* Powered by Cloudflare Workers
* Lightweight architecture

## 🔐 DRM Support

* Fetch DRM Key
* Fetch DRM KID
* Returns signed MPD URLs
* Automatic decryption key rotation handling

---

# 📡 API Reference

## 🔑 Get available routes

```http
GET /
```

### Example

```bash
curl https://skullpwapi.ironskullx.workers.dev/
```

### Response

```json
{
  "service": "SKULLPWAPI",
  "version": "1.1.0",
  "............."
}
```

---

## 🎥 Get keys for decryption

```http
GET /keys
```

### Example

```bash
curl "https://skullpwapi.ironskullx.workers.dev/keys
```

### Response

```json
{
  "aesKey": "xxxxxx",
  "aesIv": "xxxxxx",
  "status": "live",
  "note": "Keys fetched fresh from pw4free.in JS bundle"
}
```

---

## 🎥 Get MPD + DRM Details

```http
GET /?batchId=xxxx&lectureId=xxxx
```

### Example

```bash
curl "https://skullpwapi.ironskullx.workers.dev/?batchId=xxxx&lectureId=xxxx
```

### Response

```json
{
  "success": true,
  "signedMpdUrl": "https://example.com/master.mpd?URLPrefix=xxxx",
"............."
}
```

---

# 🏗 Architecture

```text
Client
   │
   ▼
SkullPWAPI
   ├── Fetch AES Key and IV
   ├── Fetch encrypted response
   ├── Decrypt Response
   └── Return MPD + DRM Details
```

---

# 👨‍💻 Developer

## Kartik Bansal

🚀 Full Stack Developer
☁️ Cloudflare Worker Developer
⚡ API & Reverse Engineering Enthusiast

GitHub: https://github.com/hellomekartik

Website: https://skullpwapi.ironskullx.workers.dev

---

# ⭐ Support

If this project helped you:

* ⭐ Star the repository
* 🍴 Fork the project
* 🐛 Report issues
* 🚀 Contribute

---

## 💀 SkullPWAPI

**Fast • Secure • Modern**

Built with ❤️ by Kartik Bansal
