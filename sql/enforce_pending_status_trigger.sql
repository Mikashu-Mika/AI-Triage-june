-- ==============================================================================
-- SQL Migration: บังคับสถานะแชตใหม่เป็น 'pending' (รอประเมิน) ป้องกันการขึ้น 'completed' ก่อน AI ทำงาน
-- ==============================================================================

-- 1. ตั้งค่า Default ของคอลัมน์ status ในตาราง chats ให้เป็น 'pending' เสมอ
ALTER TABLE chats ALTER COLUMN status SET DEFAULT 'pending';

-- 2. สร้าง Trigger Function ตรวจสอบการ Insert แชตใหม่
-- หากเป็นการสร้างแชตใหม่ที่ยังไม่มีเวกเตอร์ embedding หรือยังไม่มีผลวิเคราะห์จาก AI
-- จะถูกบังคับให้ status เป็น 'pending' ทันที แม้ฝั่ง Frontend หรือ Mock Form จะส่งค่า 'completed' มาก็ตาม
CREATE OR REPLACE FUNCTION enforce_new_chat_pending_status()
RETURNS TRIGGER AS $$
BEGIN
    -- ถ้ายังไม่มีเวกเตอร์ embedding (แสดงว่า AI ยังไม่ได้วิเคราะห์จริง) ให้บังคับเป็น 'pending'
    IF NEW.embedding IS NULL THEN
        NEW.status := 'pending';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. ผูก Trigger เข้ากับตาราง chats (ทำงานก่อน INSERT ทุกครั้ง)
DROP TRIGGER IF EXISTS trg_enforce_new_chat_pending ON chats;

CREATE TRIGGER trg_enforce_new_chat_pending
BEFORE INSERT ON chats
FOR EACH ROW
EXECUTE FUNCTION enforce_new_chat_pending_status();

-- 4. อัปเดตข้อมูลเก่าในฐานข้อมูล: แชตใดที่ขึ้น 'completed' แต่ไม่มี embedding ให้ดึงกลับมาเป็น 'pending'
UPDATE chats
SET status = 'pending'
WHERE status = 'completed'
  AND (embedding IS NULL OR id NOT IN (SELECT DISTINCT chat_id FROM chat_issues WHERE chat_id IS NOT NULL));

-- 5. ตรวจสอบผลลัพธ์
SELECT id, status, category_id, priority, created_at 
FROM chats 
WHERE status = 'pending'
ORDER BY created_at DESC 
LIMIT 10;
