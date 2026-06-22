````md
<div align="center">

# 💀 SkullPWAPI

### ⚡ Lightning Fast Physics Wallah Playback API

Fetch signed MPD URLs, DRM Keys, and KIDs with a single request.

<p align="center">
  <a href="https://skullpwapi.ironskullx.workers.dev">
    <img src="https://img.shields.io/badge/API-Live-success?style=for-the-badge&logo=cloudflare" />
  </a>
  <img src="https://img.shields.io/badge/Cloudflare-Workers-orange?style=for-the-badge&logo=cloudflare" />
  <img src="https://img.shields.io/badge/DRM-Supported-red?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Edge-Distributed-blue?style=for-the-badge" />
</p>

<p align="center">
  <strong>Fast • Lightweight • Reliable</strong>
</p>

<p align="center">
  Built for developers who need playback information instantly.
</p>

---

### 🌐 Live API

https://skullpwapi.ironskullx.workers.dev

</div>

---

# ✨ Features

<table>
<tr>
<td width="50%">

### 🚀 Performance

- Ultra-fast response times
- Globally distributed edge network
- Powered by Cloudflare Workers
- Lightweight architecture

</td>
<td width="50%">

### 🔐 DRM Support

- Fetch DRM Key
- Fetch DRM KID
- Signed MPD URLs
- Automatic key handling

</td>
</tr>
</table>

### ⚡ One Request. Everything.

```mermaid
graph LR
A[Client Request] --> B[SkullPWAPI]
B --> C[Fetch AES Key]
B --> D[Fetch Manifest]
B --> E[Decrypt Response]
C --> F[Return MPD URL]
D --> F
E --> F
````

---

# 📡 API Reference

## 🔑 Get Current Encryption Key

Returns the latest encryption key used by the API.

### Endpoint

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

Returns:

* Signed MPD URL
* DRM KID
* DRM Key

### Endpoint

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
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌───────────────────────┐
│      SkullPWAPI       │
├───────────────────────┤
│ Fetch AES Key         │
│ Fetch Playback Data   │
│ Decrypt Response      │
│ Extract DRM Details   │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ MPD + KID + DRM Key   │
└───────────────────────┘
```

---

# ⚙ Example Usage

### JavaScript

```javascript
const response = await fetch(
  "https://skullpwapi.ironskullx.workers.dev/?batchId=xxx&subjectId=xxx&lectureId=xxx"
);

const data = await response.json();

console.log(data.videoUrl_mpd);
console.log(data.kid);
console.log(data.key);
```

---

# 🌎 Infrastructure

| Feature             | Status |
| ------------------- | ------ |
| Cloudflare Workers  | ✅      |
| Global Edge Network | ✅      |
| Auto Key Rotation   | ✅      |
| Signed MPD URLs     | ✅      |
| DRM Extraction      | ✅      |
| High Availability   | ✅      |

---

# 👨‍💻 Developer

<div align="center">

## Kartik Bansal

**Full Stack Developer** • **Cloudflare Worker Developer**

Passionate about APIs, Reverse Engineering, Edge Computing, and Building High-Performance Services.

### Connect

GitHub → https://github.com/hellomekartik

Website → https://skullpwapi.ironskullx.workers.dev

</div>

---

# ⭐ Support

If this project helped you:

```text
⭐ Star the Repository
🍴 Fork the Project
🐛 Report Issues
🚀 Contribute
```

---

<div align="center">

# 💀 SkullPWAPI

### Fast • Secure • Modern

Powered by Cloudflare Workers ⚡

Made with ❤️ by Kartik Bansal

</div>
```
