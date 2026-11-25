# Sift AI: บอตจัดกลุ่มแชตลูกค้า (API + Telegram)

รับแชตลูกค้าจากระบบภายนอก ให้ AI จัดหมวดปัญหา ความเร่งด่วน และสรุป แล้วเก็บผลใน Supabase
ผลจะแสดงใน Back Office (repo `siftai-bo`) และถามบอตเรื่องแชตของบริษัทได้ในกลุ่ม Telegram ที่ผูกไว้
ขั้นตอนเปิดใช้ให้บริษัทใหม่ดูที่ [docs/onboarding.md](docs/onboarding.md)

```
ระบบลูกค้า ──POST /api/chats/ingest──▶ บอตนี้ (port 4000) ──▶ คิว AI ──▶ Supabase ──▶ Back Office / Telegram
```

---

## AI ที่ใช้

| ลำดับ | ผู้ให้บริการ | ใช้เมื่อ | ค่าที่ต้องตั้ง |
|---|---|---|---|
| 1 | **AI Jaika** (`qwen2.5-14b`, embedding `bge-m3`) | ตั้งค่าไว้ และอยู่ในเวลาเปิด (ค่าเริ่มต้น 15:00-18:00 เวลาไทย) | `JAIKA_BASE_URL`, `JAIKA_API_KEY`, `JAIKA_OPEN_HOURS` |
| 2 | **Cloudflare Workers AI** | Jaika ปิด ไม่ว่าง หรือ error | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| 3 | **Ollama** ในเครื่อง (`qwen2.5:14b`, `bge-m3`) | สองอันแรกใช้ไม่ได้ | `OLLAMA_URL`, `MODEL_LLM`, `MODEL_EMBEDDING` |

- `JAIKA_OPEN_HOURS` ตั้งหลายช่วงได้ เช่น `09:00-12:00,15:00-18:00` หรือใช้ `always`
- เมื่อ Jaika error ระบบจะเว้นช่วงไม่เรียก Jaika สักพัก แล้วใช้ตัวถัดไปแทน
- **คีย์ Jaika ใช้ร่วมกับบอตที่รันจริง** อย่ารันสคริปต์ทดสอบถี่จนชน rate limit
- `JAIKA_ONLY=1` (ใช้ในสคริปต์ทดสอบ) บังคับใช้ Jaika อย่างเดียว ไม่ fallback

---

## สิ่งที่ต้องมี

- **Node.js 20 ขึ้นไป** (ทีมใช้ v24)
- **Supabase project** ตัวเดียวกับ Back Office ขอ URL และ Service Role Key จากทีม
- **คีย์ AI Jaika** และ/หรือ **Cloudflare Workers AI** อย่างน้อยหนึ่งอย่าง
  - ถ้าจะใช้ Ollama สำรอง: `ollama pull qwen2.5:14b` และ `ollama pull bge-m3`
- **Telegram bot token** ถ้าต้องการส่งสรุปเข้ากลุ่ม

---

## วิธีรัน

1. ติดตั้ง dependency

   ```bash
   npm install
   ```

2. สร้างไฟล์ `.env` จากตัวอย่าง แล้วใส่ค่าจริง

   ```bash
   cp .env.example .env
   ```

   - `ADMIN_API_KEY` ต้องยาวอย่างน้อย 32 ตัวอักษร สร้างด้วย `openssl rand -hex 32` ถ้าไม่ตั้ง บอตจะไม่ยอมเริ่ม
   - **ห้าม commit `.env`** และห้ามใส่คีย์จริงใน README หรือเอกสาร เพราะ repo นี้เป็น public

3. ทดสอบการเชื่อมต่อ

   ```bash
   npm run test-conn
   ```

4. เริ่มเซิร์ฟเวอร์ที่ port 4000

   ```bash
   npm start      # ใช้งานจริง
   npm run dev    # ตอนพัฒนา รีสตาร์ทเองเมื่อแก้โค้ด
   ```

5. เช็กสถานะที่ `GET http://localhost:4000/health`

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run test-conn` | ทดสอบการเชื่อมต่อ |
| `npm run eval:triage` | วัดความแม่นยำของการจัดกลุ่ม |
| `npm run eval:agent` | วัดผลผู้ช่วยตอบคำถามใน Telegram |
| `node scripts/hashLegacyPasswords.js` | ตรวจหารหัสผ่านที่ยังไม่ hash (ใส่ `--apply` เพื่อแก้จริง) |

---

## API หลัก

| Endpoint | ยืนยันตัวตน | ใช้ทำอะไร |
|---|---|---|
| `POST /api/chats/ingest` | `x-client-id` + `x-client-secret` | ส่งแชตเข้าระบบ ส่ง `id` เดิมซ้ำได้ ([ตัวอย่าง curl และ Postman](docs/ingest/)) |
| `GET /api/chats/pending` | Client ID/Secret | ดูแชตที่รอ AI |
| `POST /api/chats/feedback` | Client ID/Secret | ส่งผลที่คนตรวจแก้แล้วกลับเข้าระบบ |
| `POST /api/auth/login` | email + password (จำกัดการใส่ผิด) | เข้าสู่ระบบ |
| `POST /api/companies/register` | `X-Admin-Key` (header เท่านั้น) | สร้างบริษัทใหม่ |
| `PUT /api/companies/:id/package` | `X-Admin-Key` | เปลี่ยนแพ็กเกจและโควตา |
| `GET /api/queue/status` | - | ดูคิว AI |
| `POST /api/telegram/webhook` | `TELEGRAM_WEBHOOK_SECRET` (ถ้าตั้งไว้) | รับข้อความจาก Telegram |
| `GET /sse`, `POST /messages` | - | MCP server สำหรับ MCP client |

- admin key รับจาก header `X-Admin-Key` เท่านั้น ไม่รับจาก query หรือ body
- **กันเดารหัสผ่าน:** ใส่รหัสผิดเกิน 5 ครั้งใน 15 นาที (นับแยกต่อ IP และต่อ email) จะได้ **429** พร้อม header `Retry-After` จนครบเวลา ใช้กับ `POST /api/auth/login` และทุก route ที่รับ `x-user-email` / `x-user-password` ตัวนับอยู่ในหน่วยความจำ รีสตาร์ทบอตแล้วจะเริ่มนับใหม่
- body ใหญ่สุด 1 MB เกินแล้วได้ **413** และ JSON ผิดรูปแบบได้ **400** ทั้งสองแบบตอบเป็น JSON
- รหัสผ่านผู้ใช้เก็บเป็น bcrypt hash รูปแบบเดียวกับ Back Office

---

## งานตามเวลา

| งาน | เวลา (ไทย) | ค่าที่ตั้งได้ |
|---|---|---|
| สรุปประจำวันเข้ากลุ่มผู้บริหาร (`TELEGRAM_EXEC_GROUP_ID`) | ทุกวัน 11:00 | `BRIEFING_TARGET_HOUR`, `BRIEFING_TARGET_MINUTE` |
| สรุปรายสัปดาห์ให้กลุ่มผู้บริหาร | วันจันทร์ 11:15 | `WEEKLY_SUMMARY_ENABLED`, `WEEKLY_SUMMARY_HOUR`, `WEEKLY_SUMMARY_MINUTE`, `TELEGRAM_EXEC_GROUP_ID` |

ทดลองดูผลโดยไม่ส่งจริง: `POST /api/scheduler/weekly-summary/send` กับ body `{"dryRun": true}`

---

## ตารางหลักใน Supabase

`companies`, `users`, `customers`, `categories`, `chats`, `chat_issues`, `telegram_groups`, `telegram_group_members`

Back Office กับบอตใช้ฐานข้อมูลเดียวกัน โครงสร้างล่าสุดดูได้ที่หน้า **Schema** ใน Back Office
