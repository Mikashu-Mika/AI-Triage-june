# ตัวอย่าง curl: ส่งแชตเข้า Sift AI (`POST /api/chats/ingest`)

ตั้งค่าตัวแปรก่อน แล้วคัดลอกคำสั่งด้านล่างไปรันได้เลย ใช้ได้ทั้ง bash, zsh และ Git Bash
อย่าใส่ `client_secret` ลงในไฟล์ที่ commit หรือส่งในแชต

```bash
BASE_URL="https://YOUR_SIFT_AI_HOST"
CLIENT_ID="YOUR_CLIENT_ID"
CLIENT_SECRET="YOUR_CLIENT_SECRET"
CHAT_ID="chat-test-$(date +%s)"
```

ถ้าใช้ Postman ให้ import ไฟล์ `sift-ai-ingest.postman_collection.json` ในโฟลเดอร์นี้ แล้วแก้ตัวแปร `base_url`, `client_id` และ `client_secret` ใน Collection variables

## 1. ส่งแชตใหม่

```bash
curl -X POST "$BASE_URL/api/chats/ingest" \
  -H "Content-Type: application/json" \
  -H "x-client-id: $CLIENT_ID" \
  -H "x-client-secret: $CLIENT_SECRET" \
  -d '{
    "id": "'"$CHAT_ID"'",
    "customer_id": "cust-test-001",
    "conversation": "ลูกค้า: สั่งของไปตั้งแต่วันจันทร์ ยังไม่ได้รับเลยค่ะ\nแอดมิน: ขอเลขคำสั่งซื้อหน่อยนะคะ\nลูกค้า: ORD-12345 ค่ะ"
  }'
```

ผลที่ได้ (200):

```json
{
  "message": "Chat ingested successfully and queued for real-time Sift AI classification",
  "data": { "id": "chat-test-1700000000", "customer_id": "cust-test-001", "status": "pending", "...": "..." }
}
```

AI ใช้เวลาจัดกลุ่มประมาณ 30 วินาทีต่อแชต ผลจะขึ้นในหน้าแชตของ Back Office

## 2. ส่ง conversation เป็น array

ระบบจะต่อแต่ละข้อความด้วยการขึ้นบรรทัดใหม่

```bash
curl -X POST "$BASE_URL/api/chats/ingest" \
  -H "Content-Type: application/json" \
  -H "x-client-id: $CLIENT_ID" \
  -H "x-client-secret: $CLIENT_SECRET" \
  -d '{
    "id": "'"$CHAT_ID"'-array",
    "customer_id": "cust-test-001",
    "conversation": [
      "ลูกค้า: เข้าแอปไม่ได้ ขึ้นว่ารหัสผ่านผิด",
      "แอดมิน: ลองกดลืมรหัสผ่านได้เลยค่ะ",
      "ลูกค้า: กดแล้วอีเมลไม่มาค่ะ"
    ]
  }'
```

## 3. ส่งซ้ำ id เดิม เมื่อมีข้อความเพิ่ม

ส่งบทสนทนา**ทั้งหมดตั้งแต่ต้น**ทุกครั้ง ระบบจะทำดังนี้:
- **แทนที่**บทสนทนาเดิม ไม่ได้ต่อท้าย
- ตั้งสถานะกลับเป็น `pending` แล้วให้ AI จัดกลุ่มใหม่
- **ไม่นับโควตาซ้ำ**

ถ้าส่งซ้ำด้วยข้อความเดิมทุกตัวอักษร (เช่น retry หลัง timeout) และ AI จัดกลุ่มเสร็จไปแล้ว ระบบจะไม่จัดกลุ่มซ้ำ
response จะมี `"triage_queued": false` ส่วนกรณีที่ส่งเข้าคิวจะเป็น `"triage_queued": true`

```bash
curl -X POST "$BASE_URL/api/chats/ingest" \
  -H "Content-Type: application/json" \
  -H "x-client-id: $CLIENT_ID" \
  -H "x-client-secret: $CLIENT_SECRET" \
  -d '{
    "id": "'"$CHAT_ID"'",
    "customer_id": "cust-test-001",
    "conversation": "ลูกค้า: สั่งของไปตั้งแต่วันจันทร์ ยังไม่ได้รับเลยค่ะ\nแอดมิน: ขอเลขคำสั่งซื้อหน่อยนะคะ\nลูกค้า: ORD-12345 ค่ะ\nแอดมิน: ตรวจสอบแล้ว พัสดุตกค้างที่ศูนย์ จะได้รับพรุ่งนี้ค่ะ\nลูกค้า: ขอบคุณค่ะ"
  }'
```

## 4. ตัวอย่าง error

ขาดฟิลด์ `conversation` จะได้ **400**:

```bash
curl -i -X POST "$BASE_URL/api/chats/ingest" \
  -H "Content-Type: application/json" \
  -H "x-client-id: $CLIENT_ID" \
  -H "x-client-secret: $CLIENT_SECRET" \
  -d '{"id": "'"$CHAT_ID"'", "customer_id": "cust-test-001"}'
# {"error":"Missing parameters: id, customer_id, conversation"}
```

`client_secret` ผิด หรือไม่ได้ส่ง credentials จะได้ **401**:

```bash
curl -i -X POST "$BASE_URL/api/chats/ingest" \
  -H "Content-Type: application/json" \
  -H "x-client-id: $CLIENT_ID" \
  -H "x-client-secret: wrong-secret" \
  -d '{"id": "'"$CHAT_ID"'", "customer_id": "cust-test-001", "conversation": "ทดสอบ"}'
```

| Status | เกิดเมื่อ | ควรทำอย่างไร |
|---|---|---|
| 400 | ขาด `id`, `customer_id` หรือ `conversation` หรือ conversation ว่าง | แก้ payload แล้วส่งใหม่ |
| 400 | body ไม่ใช่ JSON ที่ถูกต้อง (`Invalid JSON body.`) | ตรวจการแปลงข้อมูลเป็น JSON |
| 401 | ไม่ส่ง หรือส่ง `x-client-id` / `x-client-secret` ผิด | ตรวจ credentials ไม่ต้อง retry |
| 409 | `id` นี้เป็นของบริษัทอื่นอยู่แล้ว | เปลี่ยน id ให้ไม่ซ้ำ เช่น ใส่ prefix ของระบบตัวเอง |
| 413 | body ใหญ่เกิน 1 MB (`Request body too large (limit 1mb).`) | ส่งเฉพาะข้อความ ไม่แนบรูปหรือไฟล์ |
| 429 | โควตาแชตของรอบบิลเต็ม แชตนี้**ไม่ถูกบันทึก** | ติดต่อทีม Sift AI เพื่อเพิ่มโควตา แล้วส่งใหม่ |
| 500 | ระบบขัดข้องชั่วคราว | retry แบบเว้นระยะ เช่น 5, 30, 120 วินาที (ส่ง id เดิมได้อย่างปลอดภัย) |
