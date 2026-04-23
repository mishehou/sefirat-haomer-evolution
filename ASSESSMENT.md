# Evolution API — Migration Assessment for Sefirat HaOmer Bot

## Why we are migrating

The existing `sefirat-haomer-bot` uses **WAHA** (WhatsApp HTTP API) with the **NOWEB** engine.
WAHA NOWEB's free tier does **not support sending images**. Sending media requires WAHA Plus (paid).

**Evolution API** is a free, open-source alternative that supports full media sending
(images, documents, audio) without any paywall.

---

## What Evolution API is

- GitHub: https://github.com/EvolutionAPI/evolution-api
- Docker image: `atendai/evolution-api:latest`
- Based on **Baileys** (same WhatsApp Web protocol as WAHA NOWEB)
- Provides a REST API very similar in structure to WAHA
- Actively maintained, large community, widely used

---

## Capability comparison

| Feature                  | WAHA Free (NOWEB) | WAHA Plus | Evolution API |
|--------------------------|:-----------------:|:---------:|:-------------:|
| Send text                | ✅                | ✅        | ✅            |
| Send images              | ❌                | ✅        | ✅            |
| Send files/audio         | ❌                | ✅        | ✅            |
| Receive messages (webhook)| ✅               | ✅        | ✅            |
| Docker support           | ✅                | ✅        | ✅            |
| Free                     | ✅                | ❌        | ✅            |

---

## What changes in the code

Only `index.js` changes. Everything else is identical to the existing bot:

| File              | Status         | Notes                                      |
|-------------------|----------------|--------------------------------------------|
| `omerLogic.js`    | **Unchanged**  | Hebrew date logic, copied as-is            |
| `omer_graphic.py` | **Unchanged**  | PNG generator, copied as-is                |
| `index.js`        | **Rewritten**  | Evolution API endpoints instead of WAHA    |
| `Dockerfile`      | **Same**       | Same Python + node:20-slim base            |
| `docker-compose.yml` | **New**     | Two services: evolution-api + bot          |

### Key API differences

**Send text**
```
WAHA:      POST /api/sendText          { chatId, text, session }
Evolution: POST /message/sendText/{instance}   { number, text }
```

**Send image**
```
WAHA:      POST /api/sendImage         { chatId, file:{data,mimetype}, session }
Evolution: POST /message/sendMedia/{instance}  { number, mediatype, media, caption }
```

**Webhook payload (incoming message)**
```
WAHA:      payload.body  /  payload.from
Evolution: data.message.conversation  /  data.key.remoteJid
```

---

## Infrastructure plan

- **New** Evolution API container: `omer-evolution-api`  (port 8084 on host)
- **New** bot container: `sefirat-evo-bot`               (port 5052 on host)
- **New** Docker network: `omer-evo-net`                 (isolated, not touching whatsapp-net)
- **New** NAS directory: `/volume2/docker/sefirat-evolution/`
- **Existing** `sefirat-haomer-bot` on port 5051 → **untouched** until explicitly decommissioned

---

## Infrastructure reference

### Portainer
- URL: `http://192.168.0.37:9000`
- Username: `admin`
- Password: `yke.CHV4fdb8utw@vpw`
- Endpoint ID for Docker: `3` (named "local")

### Portainer API flow
```bash
# 1. Get JWT
TOKEN=$(curl -s -X POST http://192.168.0.37:9000/api/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yke.CHV4fdb8utw@vpw"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['jwt'])")

# 2. Build image from local tar
tar --exclude='.git' --exclude='node_modules' -czf /tmp/build.tar.gz -C /path/to/project .
curl -X POST "http://192.168.0.37:9000/api/endpoints/3/docker/build?t=image-name:latest" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-tar" \
  --data-binary @/tmp/build.tar.gz

# 3. Deploy stack (stack ID returned on creation)
curl -X PUT "http://192.168.0.37:9000/api/stacks/{ID}?endpointId=3" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stackFileContent": "...", "prune": true}'
```

### NAS layout
- Birthday-bot (shares WAHA):  `/volume2/docker/birthday-bot/`
- Sefirat HaOmer (current):    `/volume2/docker/sefirat-bot/`
- Sefirat HaOmer Evolution:    `/volume2/docker/sefirat-evolution/`  ← new
- Shared contacts file:        `/volume2/docker/birthday-bot/data/contacts.json`

### Shared contacts format
```json
[
  { "label": "Name", "chatId": "972501234567@s.whatsapp.net", "omer": true, "birthday": "..." },
  { "label": "Group", "chatId": "120363...@g.us",             "omer": true }
]
```
The new bot reads the same `contacts.json` and filters `omer: true` entries.
