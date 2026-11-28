-- ==============================================================================
-- SQL Migration: แยกเคสเมื่อแพลตฟอร์มแชตส่งรหัสแชตเดิมทั้งวัน
-- ข้อความที่เข้ามาหลังเคสล่าสุดเงียบเกิน CHAT_SPLIT_GAP_MINUTES (ค่าเริ่มต้น 30 นาที)
-- จะกลายเป็นเคสใหม่ รหัส <id>-part2, <id>-part3, ...
-- ==============================================================================

-- source_id: รหัสแชตที่แพลตฟอร์มส่งมา (ทุกเคสที่แยกจากแชตเดียวกันมีค่านี้ตรงกัน)
-- source_offset: เคสนี้เริ่มที่บรรทัดที่เท่าไรของบทสนทนาเต็มที่แพลตฟอร์มส่งมา
-- last_ingested_at: เวลาที่เคสนี้ได้รับข้อความใหม่ครั้งล่าสุด
ALTER TABLE chats ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS source_offset integer NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_ingested_at timestamptz;

-- แชตเดิมทั้งหมดเป็นเคสแรกของรหัสตัวเอง (รันซ้ำได้ แตะเฉพาะแถวที่ยังว่าง)
UPDATE chats SET source_id = id WHERE source_id IS NULL;
UPDATE chats SET last_ingested_at = created_at WHERE last_ingested_at IS NULL;
ALTER TABLE chats ALTER COLUMN last_ingested_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_chats_company_source ON chats (company_id, source_id, source_offset DESC);
