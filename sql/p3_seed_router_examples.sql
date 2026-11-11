-- ==============================================================================
-- Seed verified router examples for the executive bot (training_examples, task_type = agent_router)
-- One copy per company. The server computes the embeddings on start (bge-m3), so no Ollama is needed here.
-- Each row: input_text = question, expected_output = {"plan": ..., "previous_question"?, "previous_plan"?}
-- These are deliberately different from data/agent_eval_cases.json (the eval set must stay unseen).
--
-- Teach the bot a new pattern later (no code change): insert a row like the ones below, then restart the
-- server or wait up to 5 minutes; its embedding is filled in automatically.
-- Safe to re-run: an identical question already stored for a company is skipped.
-- ==============================================================================

BEGIN;

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขอสรุปปัญหาวันนี้หน่อย$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"today"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขอสรุปปัญหาวันนี้หน่อย$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$สัปดาห์นี้ลูกค้าแจ้งปัญหาอะไรมาบ้าง$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"this_week"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$สัปดาห์นี้ลูกค้าแจ้งปัญหาอะไรมาบ้าง$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ช่วง 14 วันที่ผ่านมา ปัญหาอันดับต้นๆ คืออะไร$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"last_n_days","n":14}}}],"unsupported_topics":[],"focus":"อันดับต้นๆ"}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ช่วง 14 วันที่ผ่านมา ปัญหาอันดับต้นๆ คืออะไร$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เดือนสิงหาคมมีปัญหาล็อกอินกี่เคส$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"month","month":8},"categories":["login_issue"]}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เดือนสิงหาคมมีปัญหาล็อกอินกี่เคส$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ปัญหาชำระเงินไม่ผ่านคิดเป็นกี่เปอร์เซ็นต์ของทั้งหมดเดือนนี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"this_month"},"categories":["payment_gateway"]}}],"unsupported_topics":[],"focus":"เปอร์เซ็นต์"}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ปัญหาชำระเงินไม่ผ่านคิดเป็นกี่เปอร์เซ็นต์ของทั้งหมดเดือนนี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$วันนี้ช่วงบ่ายโมงถึงห้าโมงเย็นมีปัญหาเข้ามากี่เคส$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"today","start_hour":13,"end_hour":17}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$วันนี้ช่วงบ่ายโมงถึงห้าโมงเย็นมีปัญหาเข้ามากี่เคส$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ปัญหาแจ้งเตือนส่วนใหญ่เข้ามากี่โมง สัปดาห์นี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"this_week"},"categories":["notification_issue"],"group_by":"hour"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ปัญหาแจ้งเตือนส่วนใหญ่เข้ามากี่โมง สัปดาห์นี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เดือนที่แล้ววันไหนปัญหาพีคที่สุด$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"last_month"},"group_by":"day"}}],"unsupported_topics":[],"focus":"วันที่มากที่สุด"}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เดือนที่แล้ววันไหนปัญหาพีคที่สุด$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$สัปดาห์นี้มีเคสระดับสูงกับฉุกเฉินรวมกี่เคส$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"this_week"},"priorities":["urgent","high"],"group_by":"priority"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$สัปดาห์นี้มีเคสระดับสูงกับฉุกเฉินรวมกี่เคส$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ตั้งแต่วันที่ 1 ถึง 10 ตุลา มีปัญหาอะไรบ้าง$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"date_range","start_date":"2026-10-01","end_date":"2026-10-10"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ตั้งแต่วันที่ 1 ถึง 10 ตุลา มีปัญหาอะไรบ้าง$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขอดูแชตเรื่องสมัครสมาชิกไม่ได้ของสัปดาห์นี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"list_chats","args":{"period":{"type":"this_week"},"categories":["registration"]}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขอดูแชตเรื่องสมัครสมาชิกไม่ได้ของสัปดาห์นี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เคสฉุกเฉินวันนี้มีแชตไหนบ้าง เรียงจากด่วนสุด$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"list_chats","args":{"period":{"type":"today"},"priorities":["urgent","high"],"sort":"priority"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เคสฉุกเฉินวันนี้มีแชตไหนบ้าง เรียงจากด่วนสุด$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขอรายการแชตปัญหาการเงินเมื่อวาน เรียงตามเวลา$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"list_chats","args":{"period":{"type":"yesterday"},"categories":["deposit_withdrawal","payment_gateway"],"sort":"oldest"}}],"unsupported_topics":[],"focus":"เรียงตามเวลา"}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขอรายการแชตปัญหาการเงินเมื่อวาน เรียงตามเวลา$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$มีแชตไหนที่ลูกค้าบ่นว่าแอดมินไม่ตอบบ้าง เดือนนี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"list_chats","args":{"period":{"type":"this_month"},"categories":["feedback_complaint"],"query":"แอดมิน"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$มีแชตไหนที่ลูกค้าบ่นว่าแอดมินไม่ตอบบ้าง เดือนนี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$สัปดาห์นี้ปัญหาเยอะขึ้นหรือลดลงจากสัปดาห์ก่อน$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"compare_periods","args":{"metric":"issues","period":{"type":"this_week"},"period_b":{"type":"last_week"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$สัปดาห์นี้ปัญหาเยอะขึ้นหรือลดลงจากสัปดาห์ก่อน$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ปัญหาหน้าเว็บค้างเดือนนี้เทียบเดือนที่แล้วเป็นยังไง$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"compare_periods","args":{"metric":"issues","period":{"type":"this_month"},"period_b":{"type":"last_month"},"categories":["page_load_freeze"]}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ปัญหาหน้าเว็บค้างเดือนนี้เทียบเดือนที่แล้วเป็นยังไง$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$แชตเข้ามาวันนี้เยอะกว่าเมื่อวานไหม$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"compare_periods","args":{"metric":"chats","period":{"type":"today"},"period_b":{"type":"yesterday"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$แชตเข้ามาวันนี้เยอะกว่าเมื่อวานไหม$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ลูกค้าสมัครใหม่สัปดาห์นี้มากกว่าสัปดาห์ที่แล้วไหม$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"compare_periods","args":{"metric":"new_customers","period":{"type":"this_week"},"period_b":{"type":"last_week"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ลูกค้าสมัครใหม่สัปดาห์นี้มากกว่าสัปดาห์ที่แล้วไหม$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ตอนนี้มีลูกค้าในระบบทั้งหมดกี่คน$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"total","period":{"type":"all_time"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ตอนนี้มีลูกค้าในระบบทั้งหมดกี่คน$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เมื่อวานมีคนสมัครใหม่กี่คน$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"new","period":{"type":"yesterday"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เมื่อวานมีคนสมัครใหม่กี่คน$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขอรายชื่อลูกค้าที่สมัครสัปดาห์นี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"new_list","period":{"type":"this_week"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขอรายชื่อลูกค้าที่สมัครสัปดาห์นี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$แชตสัปดาห์นี้มาจากลูกค้าเดิมกี่เปอร์เซ็นต์$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"returning_ratio","period":{"type":"this_week"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$แชตสัปดาห์นี้มาจากลูกค้าเดิมกี่เปอร์เซ็นต์$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$มีลูกค้าคนไหนทักมาเรื่องเดิมหลายรอบในสัปดาห์นี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"repeat_customers","period":{"type":"this_week"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$มีลูกค้าคนไหนทักมาเรื่องเดิมหลายรอบในสัปดาห์นี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ยอดสมาชิกใหม่รายเดือนตั้งแต่กรกฎาคม$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"new_by_month","period":{"type":"date_range","start_date":"2026-07-01","end_date":"2026-10-31"}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ยอดสมาชิกใหม่รายเดือนตั้งแต่กรกฎาคม$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$มีลูกค้าถามเรื่องของขวัญวันเกิดบ้างไหมสัปดาห์นี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"search_chats","args":{"period":{"type":"this_week"},"query":"วันเกิด"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$มีลูกค้าถามเรื่องของขวัญวันเกิดบ้างไหมสัปดาห์นี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เดือนนี้มีใครขู่จะอายัดบัญชีไหม$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"search_chats","args":{"period":{"type":"this_month"},"query":"อายัด"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เดือนนี้มีใครขู่จะอายัดบัญชีไหม$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$มีลูกค้าขอเปลี่ยนเลขบัญชีธนาคารบ้างไหม$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"search_chats","args":{"period":{"type":"last_n_days","n":30},"query":"เปลี่ยนบัญชี เลขบัญชี"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$มีลูกค้าขอเปลี่ยนเลขบัญชีธนาคารบ้างไหม$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ช่วงนี้ลูกค้าอารมณ์เป็นยังไงบ้าง$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_sentiment","args":{"period":{"type":"last_n_days","n":7}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ช่วงนี้ลูกค้าอารมณ์เป็นยังไงบ้าง$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$สัปดาห์นี้มีลูกค้าชมบริการไหม$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_sentiment","args":{"period":{"type":"this_week"}}}],"unsupported_topics":[],"focus":"เฉพาะแชตที่ลูกค้าชม"}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$สัปดาห์นี้มีลูกค้าชมบริการไหม$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$หมวด API error หมายถึงอะไร$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_category_info","args":{"category":"api_error"}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$หมวด API error หมายถึงอะไร$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ปัญหาล็อกอินต้องแก้ยังไง$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_resolution_advice","args":{"category":"login_issue","period":{"type":"last_n_days","n":30}}}],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ปัญหาล็อกอินต้องแก้ยังไง$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ทีม dev ควรเช็คอะไรเรื่องระบบชำระเงินขัดข้อง$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_resolution_advice","args":{"category":"payment_gateway","period":{"type":"last_n_days","n":30}}}],"unsupported_topics":[],"focus":"ขั้นตอนสำหรับทีม dev"}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ทีม dev ควรเช็คอะไรเรื่องระบบชำระเงินขัดข้อง$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ตอนนี้ควรรีบแก้ปัญหาอะไรก่อน$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_resolution_advice","args":{"period":{"type":"last_n_days","n":7}}}],"unsupported_topics":[],"focus":"ปัญหาที่ควรแก้ก่อน"}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ตอนนี้ควรรีบแก้ปัญหาอะไรก่อน$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เมื่อวานยอดถอนรวมเท่าไหร่$ex$, $ex${"plan":{"reply_mode":"data","calls":[],"unsupported_topics":["money_amounts"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เมื่อวานยอดถอนรวมเท่าไหร่$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เดือนนี้ได้กำไรเท่าไหร่$ex$, $ex${"plan":{"reply_mode":"data","calls":[],"unsupported_topics":["money_amounts"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เดือนนี้ได้กำไรเท่าไหร่$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขอดูสลิปที่ลูกค้าส่งมาวันนี้$ex$, $ex${"plan":{"reply_mode":"data","calls":[],"unsupported_topics":["slips"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขอดูสลิปที่ลูกค้าส่งมาวันนี้$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$แคมเปญไหนดึงลูกค้าได้เยอะสุด$ex$, $ex${"plan":{"reply_mode":"data","calls":[],"unsupported_topics":["campaigns"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$แคมเปญไหนดึงลูกค้าได้เยอะสุด$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$แอดมินตอบแชตเฉลี่ยกี่นาที$ex$, $ex${"plan":{"reply_mode":"data","calls":[],"unsupported_topics":["admin_response_time"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$แอดมินตอบแชตเฉลี่ยกี่นาที$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขออีเมลลูกค้าที่ร้องเรียนหน่อย$ex$, $ex${"plan":{"reply_mode":"data","calls":[],"unsupported_topics":["personal_data"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขออีเมลลูกค้าที่ร้องเรียนหน่อย$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$สรุปปัญหาวันนี้กับยอดฝากวันนี้ให้หน่อย$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"today"}}}],"unsupported_topics":["money_amounts"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$สรุปปัญหาวันนี้กับยอดฝากวันนี้ให้หน่อย$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$หวัดดีจ้า$ex$, $ex${"plan":{"reply_mode":"chitchat","calls":[],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$หวัดดีจ้า$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขอบคุณมากนะ$ex$, $ex${"plan":{"reply_mode":"chitchat","calls":[],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขอบคุณมากนะ$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$บอทตอบไม่ตรงเลย$ex$, $ex${"plan":{"reply_mode":"chitchat","calls":[],"unsupported_topics":[],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$บอทตอบไม่ตรงเลย$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เย็นนี้ไปเที่ยวไหนดี$ex$, $ex${"plan":{"reply_mode":"chitchat","calls":[],"unsupported_topics":["out_of_scope"],"focus":""}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เย็นนี้ไปเที่ยวไหนดี$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$แล้วของเมื่อวานล่ะ$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"yesterday"}}}],"unsupported_topics":[],"focus":""},"previous_question":"สรุปปัญหาวันนี้หน่อย","previous_plan":{"tool":"get_issue_stats","args":{"period":{"type":"today"}}}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$แล้วของเมื่อวานล่ะ$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$แล้วหมวดล็อกอินล่ะ$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"this_month"},"categories":["login_issue"]}}],"unsupported_topics":[],"focus":""},"previous_question":"เดือนนี้ปัญหาหน้าเว็บค้างกี่เคส","previous_plan":{"tool":"get_issue_stats","args":{"period":{"type":"this_month"},"categories":["page_load_freeze"]}}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$แล้วหมวดล็อกอินล่ะ$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$เอาเฉพาะเคสด่วน$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"list_chats","args":{"period":{"type":"this_week"},"categories":["deposit_withdrawal"],"priorities":["urgent","high"],"sort":"priority"}}],"unsupported_topics":[],"focus":""},"previous_question":"ขอดูแชตปัญหาการเงินสัปดาห์นี้","previous_plan":{"tool":"list_chats","args":{"period":{"type":"this_week"},"categories":["deposit_withdrawal"]}}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$เอาเฉพาะเคสด่วน$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$แล้วถ้าเทียบกับสัปดาห์ที่แล้วล่ะ$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"compare_periods","args":{"metric":"issues","period":{"type":"this_week"},"period_b":{"type":"last_week"},"categories":["notification_issue"]}}],"unsupported_topics":[],"focus":""},"previous_question":"สัปดาห์นี้ปัญหาแจ้งเตือนกี่เคส","previous_plan":{"tool":"get_issue_stats","args":{"period":{"type":"this_week"},"categories":["notification_issue"]}}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$แล้วถ้าเทียบกับสัปดาห์ที่แล้วล่ะ$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ขอดูรายละเอียดอันแรก$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"list_chats","args":{"chat_ids":["chat-A1"]}}],"unsupported_topics":[],"focus":""},"previous_question":"เคสด่วนวันนี้มีอะไรบ้าง (แสดง `chat-A1`, `chat-B2`)","previous_plan":{"tool":"list_chats","args":{"period":{"type":"today"},"priorities":["urgent"]}}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ขอดูรายละเอียดอันแรก$ex$
);

INSERT INTO training_examples (company_id, task_type, input_text, expected_output)
SELECT c.id, 'agent_router', $ex$ทำไมถึงเป็นแบบนั้น แก้ยังไง$ex$, $ex${"plan":{"reply_mode":"data","calls":[{"tool":"get_resolution_advice","args":{"category":"payment_gateway","period":{"type":"this_week"}}}],"unsupported_topics":[],"focus":""},"previous_question":"สัปดาห์นี้ปัญหาอะไรเยอะสุด (ตอบ: ระบบชำระเงิน/ธนาคาร)","previous_plan":{"tool":"get_issue_stats","args":{"period":{"type":"this_week"}}}}$ex$
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM training_examples t
  WHERE t.company_id = c.id AND t.task_type = 'agent_router' AND t.input_text = $ex$ทำไมถึงเป็นแบบนั้น แก้ยังไง$ex$
);

COMMIT;
