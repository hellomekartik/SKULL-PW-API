💀 SkullPWAPI

<div align="center">Skull PW is a blazing-fast API for fetching Physics Wallah playback information, including signed MPD URLs and DRM details.

"🌐 Website" (https://skullpwapi.ironskullx.workers.dev)

</div>---

✨ Features

- ⚡ Ultra-fast response times
- 🔑 Fetches DRM Key and KID
- 🎥 Returns signed MPD URLs
- ☁️ Built on Cloudflare Workers
- 🔄 Automatically handles key rotations
- 🚀 Single API request for everything
- 📦 Lightweight and easy to integrate
- 🌍 Globally distributed edge infrastructure

---

📡 API Endpoints

Get Current Encryption Key

GET /

Example

curl https://skullpwapi.ironskullx.workers.dev/

Response

{
  "key_string": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "aes_key_hex": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}

---

Get Playback Information

GET /?batchId=&subjectId=&lectureId=

Example

curl "https://skullpwapi.ironskullx.workers.dev/?batchId=xxxxx&subjectId=xxxxx&lectureId=xxxxx"

Response

{
  "videoUrl_mpd": "https://....master.mpd",
  "kid": "xxxxxxxxxxxxxxxx",
  "key": "xxxxxxxxxxxxxxxx"
}

---

📊 Architecture

Client
   │
   ▼
SkullPWAPI
   │
   ├── Fetch AES Key
   ├── Fetch Playback Manifest
   ├── Decrypt Response
   └── Return MPD + DRM Key + KID

---

🌐 Website

Official API Endpoint

https://skullpwapi.ironskullx.workers.dev

---

👨‍💻 Developer

<div align="center">Kartik Bansal

🚀 Full-Stack Developer
☁️ Cloudflare Worker Developer
⚡ API & Reverse Engineering Enthusiast
🎓 Student & Tech Explorer

GitHub: https://github.com/hellomekartik

Website: https://skullpwapi.ironskullx.workers.dev

</div>---

⭐ Support

If this project helped you, consider:

⭐ Star the repository
🍴 Fork the project
🐛 Report issues
🚀 Contribute to the project

---

<div align="center">💀 SkullPWAPI

Fast • Lightweight • Reliable

Built with ❤️ by Kartik Bansal

</div>
