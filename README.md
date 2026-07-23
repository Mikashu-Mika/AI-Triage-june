# AI Triage MCP Server & API

ระบบจัดหมวดหมู่ วิเคราะห์ความเร่งด่วน และสรุปข้อมูลแชตของลูกค้า (Triage) อัตโนมัติ โดยใช้โมเดล AI ในเครื่อง (Local Models) และบันทึกผลพร้อมคำนวณเวกเตอร์ลงฐานข้อมูล Supabase

---

## 🛠️ ความต้องการของระบบ (Prerequisites)

1. **Node.js**: เวอร์ชัน 18 ขึ้นไป (ติดตั้งในเครื่องคุณมิกะแล้วคือ v24.12.0)
2. **Ollama**: ติดตั้งบนเครื่องโลคอล พร้อมดาวน์โหลดโมเดล:
   ```bash
   ollama pull qwen2.5:14b
   ollama pull bge-m3
   ```
3. **Supabase Account**: โปรเจกต์ Supabase ของคุณมิกะ (`sqiruksrrcwxmjeqechb`)

---

## 💾 การตั้งค่าฐานข้อมูล Supabase (Database Setup)

เปิดแถบ **SQL Editor** ใน Supabase Dashboard ของโปรเจกต์คุณมิกะ (`https://supabase.com/dashboard/project/sqiruksrrcwxmjeqechb`) แล้วรันสคริปต์ SQL นี้เพื่อสร้างตารางทั้งหมดและจัดผูก Foreign Keys:

```sql
-- 1. เปิดใช้ extension pgvector สำหรับเก็บ embedding
create extension if not exists vector;

-- 2. สร้างตารางลูกค้า (customers)
create table if not exists customers (
  id text primary key,
  name text not null,
  email text,
  phone text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 3. สร้างตารางหมวดหมู่ (categories)
create table if not exists categories (
  id text primary key, -- คีย์สำหรับ AI อ้างอิง เช่น 'deposit_withdrawal', 'login_issue'
  name text not null,  -- ชื่อแสดงผลภาษาไทย เช่น 'ฝาก-ถอน', 'ปัญหาการเข้าสู่ระบบ'
  description text
);

-- 4. ลบตาราง chats เดิมออกก่อนเพื่อจัดฟอเรนคีย์ใหม่
drop table if exists chats;

-- 5. สร้างตารางแชต (chats) พร้อมกำหนด Foreign Keys
create table chats (
  id text primary key,
  customer_id text references customers(id) on delete set null, -- Foreign Key
  conversation text not null,
  status text default 'pending', -- 'pending' (รอประเมิน), 'completed' (ประเมินแล้ว)
  category_id text references categories(id) on delete set null, -- Foreign Key
  priority text,
  summary text,
  embedding vector(1024), -- vector จาก bge-m3
  created_at timestamp with time zone default timezone('utc'::text, now())
);
```

---

## ⚙️ การตั้งค่าโค้ด (Project Configuration)

1. เปิดไฟล์ `.env` ที่อยู่ในโฟลเดอร์นี้
2. ใส่ค่า **Service Role Key** ของ Supabase ในตัวแปร `SUPABASE_SERVICE_ROLE_KEY` เพื่อให้เซิร์ฟเวอร์สามารถเขียนข้อมูลข้าม RLS ได้:
   ```env
   PORT=4000
   SUPABASE_URL=https://sqiruksrrcwxmjeqechb.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=คีย์ของคุณมิกะที่นี่ (Service Role API Key)
   OLLAMA_URL=http://localhost:11434
   MODEL_LLM=qwen2.5:14b
   MODEL_EMBEDDING=bge-m3
   ```

---

## 🚀 วิธีการทดสอบและใช้งาน (Running the Application)

### 1. ทดสอบการเชื่อมต่อระบบ (Diagnostics)
คุณมิกะสามารถรันสคริปต์นี้เพื่อทดสอบว่าระบบสามารถเชื่อมต่อกับ Ollama และ Supabase ได้ถูกต้องหรือไม่:
```bash
npm run test-conn
```

### 2. นำเข้าข้อมูลตัวอย่าง (Seed Data)
สำหรับทดสอบระบบคัดกรอง สามารถนำข้อมูลแชตจำลอง 3 รายการเข้าสู่ Supabase ได้ทันที:
```bash
npm run seed
```

### 3. เริ่มรันเซิร์ฟเวอร์ API
รันเซิร์ฟเวอร์ที่ Port 4000:
```bash
npm start
```
หรือรันแบบ Development Mode (จะรีสตาร์ทเซิร์ฟเวอร์อัตโนมัติเมื่อมีการแก้โค้ด):
```bash
npm run dev
```

---

## 🔌 API Endpoints (Port 4000)

### 1. ระบบ MCP (Model Context Protocol)
- **SSE Connection**: `GET http://localhost:4000/sse` (สำหรับ MCP Client เช่น Claude Desktop เพื่อต่อแบบ SSE)
- **SSE Messages**: `POST http://localhost:4000/messages` (สำหรับการแลกเปลี่ยนข้อความ)

### 2. ช่องทาง REST API ปกติ
- **เซิร์ฟเวอร์ Health Check**: `GET http://localhost:4000/health` (เช็กสถานะการเชื่อมต่อ Ollama และ Supabase)
- **ดึงรายการแชตที่ค้างอยู่**: `GET http://localhost:4000/api/chats/pending`
- **สั่งให้ AI รัน Triage ทั้งหมด**: `POST http://localhost:4000/api/triage/run` (จะดึงแชตที่มีสถานะ `pending` ขึ้นมาวิเคราะห์ด้วย Qwen 2.5 สรุปข้อมูล แล้วทำ Embedding ด้วย bge-m3 บันทึกกลับลง Supabase พร้อมกัน)
