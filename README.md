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
* Automatic key rotation handling

---

# 📡 API Reference

## 🔑 Get Current Encryption Key

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
  "key_string": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "aes_key_hex": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

---

## 🎥 Get Playback Information

```http
GET /?batchId=&subjectId=&lectureId=
```

### Example

```bash
curl "https://skullpwapi.ironskullx.workers.dev/?batchId=xxxxx&subjectId=xxxxx&lectureId=xxxxx"
```

### Response

```json
{
  "videoUrl_mpd": "https://example.com/master.mpd",
  "kid": "xxxxxxxxxxxxxxxx",
  "key": "xxxxxxxxxxxxxxxx"
}
```

---

# 🏗 Architecture

```text
Client
   │
   ▼
SkullPWAPI
   ├── Fetch AES Key
   ├── Fetch Manifest
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
