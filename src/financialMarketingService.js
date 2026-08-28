import { supabase } from './supabase.js';

/**
 * Helper to dynamically compute start & end cutoff dates in Thailand Timezone (UTC+7)
 */
export function resolveDynamicTimeframe(periodMode, customLabel = null) {
  const thTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const [yearStr, monthStr] = thTodayStr.split('-');
  const currentYear = parseInt(yearStr, 10);
  const currentMonthIdx = parseInt(monthStr, 10) - 1; // 0-indexed (0=Jan, 7=Aug, 8=Sep)

  const thaiMonthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  let startCutoff;
  let endCutoff = new Date(Date.now() + 86400000);
  let resolvedLabel = customLabel;

  if (periodMode === 'this_month') {
    startCutoff = new Date(Date.UTC(currentYear, currentMonthIdx, 1, -7, 0, 0));
    endCutoff = new Date(Date.UTC(currentYear, currentMonthIdx + 1, 1, -7, 0, 0));
    const monthName = thaiMonthNames[currentMonthIdx];
    if (!resolvedLabel) resolvedLabel = `ประจำเดือนนี้ (${monthName})`;
  } else if (periodMode === 'last_month') {
    const lastMonthIdx = (currentMonthIdx - 1 + 12) % 12;
    const lastMonthYear = currentMonthIdx === 0 ? currentYear - 1 : currentYear;
    startCutoff = new Date(Date.UTC(lastMonthYear, lastMonthIdx, 1, -7, 0, 0));
    endCutoff = new Date(Date.UTC(currentYear, currentMonthIdx, 1, -7, 0, 0));
    const monthName = thaiMonthNames[lastMonthIdx];
    if (!resolvedLabel) resolvedLabel = `ประจำเดือนที่แล้ว (${monthName})`;
  } else if (typeof periodMode === 'string' && thaiMonthNames.includes(periodMode)) {
    const monthIdx = thaiMonthNames.indexOf(periodMode);
    const targetYear = monthIdx > currentMonthIdx ? currentYear - 1 : currentYear;
    startCutoff = new Date(Date.UTC(targetYear, monthIdx, 1, -7, 0, 0));
    endCutoff = new Date(Date.UTC(targetYear, monthIdx + 1, 1, -7, 0, 0));
    if (!resolvedLabel) resolvedLabel = `ประจำเดือน${periodMode}`;
  } else if (periodMode === 'july') {
    startCutoff = new Date('2026-07-01T00:00:00+07:00');
    endCutoff = new Date('2026-08-01T00:00:00+07:00');
    if (!resolvedLabel) resolvedLabel = 'ประจำเดือนกรกฎาคม';
  } else if (periodMode === 'august') {
    startCutoff = new Date('2026-08-01T00:00:00+07:00');
    endCutoff = new Date('2026-09-01T00:00:00+07:00');
    if (!resolvedLabel) resolvedLabel = 'ประจำเดือนสิงหาคม';
  } else if (periodMode === 'yesterday' || periodMode === 1.5) {
    const thTodayMidnight = new Date(`${thTodayStr}T00:00:00+07:00`);
    const thYesterdayDate = new Date(thTodayMidnight);
    thYesterdayDate.setDate(thYesterdayDate.getDate() - 1);
    startCutoff = thYesterdayDate;
    endCutoff = thTodayMidnight;
    if (!resolvedLabel) resolvedLabel = 'เมื่อวาน';
  } else if (periodMode === 'today' || periodMode === 1) {
    startCutoff = new Date(`${thTodayStr}T00:00:00+07:00`);
    if (!resolvedLabel) resolvedLabel = 'ในวันนี้';
  } else if (periodMode === 'this_week') {
    const thMidnight = new Date(`${thTodayStr}T00:00:00+07:00`);
    const dayOfWeek = thMidnight.getDay();
    const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    startCutoff = new Date(thMidnight);
    startCutoff.setDate(startCutoff.getDate() + diffToMon);
    
    const monStr = startCutoff.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });
    if (!resolvedLabel) resolvedLabel = `ประจำสัปดาห์นี้ (จันทร์ ${monStr} - ปัจจุบัน)`;
  } else if (periodMode === 'last_week') {
    const thMidnight = new Date(`${thTodayStr}T00:00:00+07:00`);
    const dayOfWeek = thMidnight.getDay();
    const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const thisMon = new Date(thMidnight);
    thisMon.setDate(thisMon.getDate() + diffToMon);
    
    startCutoff = new Date(thisMon);
    startCutoff.setDate(startCutoff.getDate() - 7);
    endCutoff = thisMon;
    
    const lastMonStr = startCutoff.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });
    const sunDate = new Date(thisMon);
    sunDate.setDate(sunDate.getDate() - 1);
    const lastSunStr = sunDate.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });
    if (!resolvedLabel) resolvedLabel = `ประจำสัปดาห์ที่แล้ว (จันทร์ ${lastMonStr} - อาทิตย์ ${lastSunStr})`;
  } else {
    const numDays = typeof periodMode === 'number' ? periodMode : 30;
    const thTodayMidnight = new Date(`${thTodayStr}T00:00:00+07:00`);
    startCutoff = new Date(thTodayMidnight);
    startCutoff.setDate(startCutoff.getDate() - numDays);
    if (!resolvedLabel) resolvedLabel = `ย้อนหลัง ${numDays} วัน`;
  }

  return { startCutoff, endCutoff, resolvedLabel };
}

/**
 * Fetch Chat Analytics (Top Issues, Categories, Priority Breakdown)
 * @param {string} [companyId]
 * @param {number|string} [days=7]
 * @param {Array} [targetCategories=[]]
 */
export async function getChatAnalytics(companyId, days = 7, targetCategories = [], customTimeLabel = null) {
  try {
    const { startCutoff, endCutoff, resolvedLabel: resolvedTimeLabel } = resolveDynamicTimeframe(days, customTimeLabel);

    let query = supabase
      .from('chats')
      .select('id, category_id, priority, status, created_at, chat_issues(summary, category_id, priority)');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data: chats, error } = await query;
    if (error) throw error;

    // Strictly filter by Thailand Timezone window [startCutoff, endCutoff)
    const filtered = (chats || []).filter(c => {
      if (!c.created_at) return false;
      const cDate = new Date(c.created_at);
      return cDate >= startCutoff && cDate < endCutoff;
    });

    const isCategoryFilter = Array.isArray(targetCategories) && targetCategories.length > 0;

    let matchedChatsCount = 0;
    let matchedIssues = [];
    const categoryCounts = {};
    const priorityCounts = { urgent: 0, high: 0, medium: 0, low: 0 };

    filtered.forEach(chat => {
      let chatMatched = false;

      const issues = chat.chat_issues && chat.chat_issues.length > 0 ? chat.chat_issues : [
        { summary: `เคสแชต ${chat.id}`, category_id: chat.category_id, priority: chat.priority }
      ];

      issues.forEach(iss => {
        const cat = iss.category_id || chat.category_id || 'deposit_withdrawal';
        const cleanCat = cat.includes(':') ? cat.split(':')[1] : cat;
        
        const isMatched = !isCategoryFilter || targetCategories.some(tc => cleanCat.includes(tc) || tc.includes(cleanCat));

        if (isMatched) {
          chatMatched = true;
          const p = (iss.priority || chat.priority || 'low').toLowerCase();
          if (priorityCounts[p] !== undefined) priorityCounts[p]++;
          
          categoryCounts[cleanCat] = (categoryCounts[cleanCat] || 0) + 1;
          
          matchedIssues.push({
            chat_id: chat.id,
            category_id: cleanCat,
            summary: iss.summary,
            priority: p,
            created_at: chat.created_at
          });
        }
      });

      if (chatMatched) matchedChatsCount++;
    });

    const timeLabel = resolvedTimeLabel || 'ช่วงเวลาที่เลือก';

    let summaryThaiTotal = '';
    let summaryThaiTopCategory = '';
    let summaryThaiPriority = '';

    if (isCategoryFilter) {
      const catNames = targetCategories.map(c => 
        c === 'page_load_freeze' || c === 'ui_rendering_issue' ? 'หน้าเว็บค้าง/แสดงผลผิดปกติ' :
        c === 'login_issue' ? 'การเข้าสู่ระบบ' :
        c === 'promo_bonus' ? 'โปรโมชั่น/โบนัส' :
        c === 'deposit_withdrawal' ? 'ฝาก-ถอนเงิน' : c
      ).join(' และ ');

      const totalAllIssuesInPeriod = filtered.reduce((acc, c) => acc + (c.chat_issues?.length || 1), 0);
      const catPct = totalAllIssuesInPeriod > 0 ? Math.round((matchedIssues.length / totalAllIssuesInPeriod) * 100) : 100;

      if (matchedIssues.length === 0) {
        summaryThaiTotal = `สำหรับปัญหาเกี่ยวกับ${catNames}ใน${timeLabel} ไม่พบรายการปัญหาเข้ามาในระบบค่ะ`;
        summaryThaiTopCategory = `หมวดหมู่ที่ถาม (${catNames}): 0 รายการ (คิดเป็น 0%)`;
        summaryThaiPriority = `ไม่มีปัญหาระดับความสำคัญสูงหรือด่วนที่สุด`;
      } else {
        summaryThaiTotal = `${timeLabel}มีปัญหาเกี่ยวกับ${catNames} เข้ามา ${matchedIssues.length} กรณี (จากแชทรวม ${matchedChatsCount} รายการ)`;
        
        const problemOnlyCategoryEntries = Object.entries(categoryCounts).filter(([id]) => id !== 'other');
        const topCatList = (problemOnlyCategoryEntries.length > 0 ? problemOnlyCategoryEntries : Object.entries(categoryCounts)).sort((a,b) => b[1] - a[1]);
        const topCatName = topCatList[0] ? (
          topCatList[0][0] === 'page_load_freeze' || topCatList[0][0] === 'ui_rendering_issue' ? 'หน้าเว็บค้าง/แสดงผลผิดปกติ' :
          topCatList[0][0] === 'login_issue' ? 'ปัญหาการเข้าสู่ระบบ' :
          topCatList[0][0] === 'promo_bonus' ? 'สอบถามโปรโมชั่น/โบนัส' :
          topCatList[0][0] === 'deposit_withdrawal' ? 'ปัญหาฝาก-ถอนเงิน' : topCatList[0][0]
        ) : catNames;

        summaryThaiTopCategory = `คิดเป็น ${catPct}% ของเคสปัญหาทั้งหมดใน${timeLabel} (หมวดเฉพาะ ${topCatName} ${matchedIssues.length} กรณี จากปัญหารวม ${totalAllIssuesInPeriod} กรณี)`;

        const highCount = priorityCounts.high || 0;
        const urgentCount = priorityCounts.urgent || 0;
        const mediumCount = priorityCounts.medium || 0;

        if (urgentCount > 0) {
          summaryThaiPriority = `มีปัญหาระดับด่วนที่สุด (Urgent) จำนวน ${urgentCount} รายการ และระดับสูง (High) ${highCount} รายการ`;
        } else if (highCount > 0) {
          summaryThaiPriority = `มีปัญหาระดับความสำคัญสูง (High Priority) จำนวน ${highCount} รายการ`;
          if (mediumCount > 0) summaryThaiPriority += ` และระดับกลาง (Medium Priority) ${mediumCount} รายการ`;
        } else if (mediumCount > 0) {
          summaryThaiPriority = `มีปัญหาระดับความสำคัญกลาง (Medium Priority) จำนวน ${mediumCount} รายการ`;
        } else {
          summaryThaiPriority = `ไม่มีปัญหาระดับความสำคัญสูงหรือด่วนที่สุด`;
        }
      }
    } else {
      const totalChats = filtered.length;
      const problemOnlyEntries = Object.entries(categoryCounts).filter(([id]) => id !== 'other');
      const sortedCategories = (problemOnlyEntries.length > 0 ? problemOnlyEntries : Object.entries(categoryCounts))
        .map(([id, count]) => ({
          category_id: id,
          count,
          percentage: matchedIssues.length > 0 ? Math.round((count / matchedIssues.length) * 100) : 0
        }))
        .sort((a, b) => b.count - a.count);

      summaryThaiTotal = `${timeLabel}มีปัญหาเข้ามา ${matchedIssues.length || totalChats} กรณี (จากแชทรวม ${totalChats} รายการ)`;
      
      const topCatName = sortedCategories[0] ? (
        sortedCategories[0].category_id === 'deposit_withdrawal' ? 'การฝาก-ถอนเงิน' :
        sortedCategories[0].category_id === 'login_issue' ? 'ปัญหาการเข้าสู่ระบบ' :
        sortedCategories[0].category_id === 'page_load_freeze' || sortedCategories[0].category_id === 'ui_rendering_issue' ? 'หน้าเว็บค้าง/แสดงผลผิดปกติ' :
        sortedCategories[0].category_id === 'promo_bonus' ? 'สอบถามโปรโมชั่น/โบนัส' : sortedCategories[0].category_id
      ) : 'ไม่มี';

      summaryThaiTopCategory = `หมวดหมู่ปัญหาหลักที่พบมากที่สุดคือ ${topCatName} ${sortedCategories[0]?.count || 0} รายการ (คิดเป็น ${sortedCategories[0]?.percentage || 0}%)`;

      const highCount = priorityCounts.high || 0;
      const urgentCount = priorityCounts.urgent || 0;
      const mediumCount = priorityCounts.medium || 0;

      if (urgentCount > 0) {
        summaryThaiPriority = `มีปัญหาด่วนที่สุด (Urgent) จำนวน ${urgentCount} รายการ และระดับสูง (High) ${highCount} รายการ`;
      } else if (highCount > 0) {
        summaryThaiPriority = `มีปัญหาระดับความสำคัญสูง (High Priority) จำนวน ${highCount} รายการ`;
        if (mediumCount > 0) summaryThaiPriority += ` และระดับกลาง (Medium Priority) ${mediumCount} รายการ`;
      } else if (mediumCount > 0) {
        summaryThaiPriority = `มีปัญหาระดับความสำคัญกลาง (Medium Priority) จำนวน ${mediumCount} รายการ`;
      } else {
        summaryThaiPriority = `ไม่มีปัญหาระดับความสำคัญสูงหรือด่วนที่สุดใน${timeLabel}`;
      }
    }

    // Group all matched issues by Official Backoffice (BO) Category Name for List Detail queries
    const groupedIssuesMap = {};
    matchedIssues.forEach(iss => {
      const catKey = iss.category_id;
      const catName = catKey === 'deposit_withdrawal' ? 'ฝาก-ถอน' :
                      catKey === 'login_issue' ? 'ปัญหาการเข้าสู่ระบบ' :
                      catKey === 'access_blocked' ? 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย' :
                      catKey === 'account_security' ? 'ความปลอดภัยของบัญชี' :
                      catKey === 'api_error' ? 'ข้อผิดพลาดระบบ API' :
                      catKey === 'device_compatibility' ? 'ปัญหาเบราว์เซอร์/อุปกรณ์' :
                      catKey === 'feature_request' ? 'ขอเพิ่มฟีเจอร์' :
                      catKey === 'feedback_complaint' ? 'ข้อเสนอแนะและร้องเรียน' :
                      catKey === 'game_issue' ? 'ปัญหาการเล่นเกม' :
                      catKey === 'interaction_lag' ? 'กดปุ่มแล้วไม่ตอบสนอง' :
                      catKey === 'notification_issue' ? 'ปัญหาการแจ้งเตือน' :
                      catKey === 'page_load_freeze' ? 'หน้าเว็บค้าง/โหลดช้า' :
                      catKey === 'payment_gateway' ? 'ระบบการชำระเงิน/ธนาคาร' :
                      catKey === 'performance_issue' ? 'ประสิทธิภาพระบบช้า' :
                      catKey === 'promo_bonus' ? 'โปรโมชั่นและโบนัส' :
                      catKey === 'registration' ? 'การสมัครสมาชิก' :
                      catKey === 'ui_rendering_issue' ? 'การแสดงผลผิดเพี้ยน' :
                      catKey === 'vip_privilege' ? 'สิทธิประโยชน์ระดับ VIP (VIP Privileges)' :
                      catKey === 'other' ? 'ไม่ใช่ปัญหา' : catKey;

      if (!groupedIssuesMap[catName]) groupedIssuesMap[catName] = [];
      const priorityLabel = (iss.priority || 'medium').toUpperCase();

      let thTime = '';
      if (iss.created_at) {
        try {
          const d = new Date(iss.created_at);
          thTime = d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
        } catch (e) {}
      }

      const timeStr = thTime ? ` (เวลา ${thTime})` : '';
      groupedIssuesMap[catName].push(`- แชต \`${iss.chat_id}\`${timeStr} - "${iss.summary}"`);
    });

    // Build Tier 2: Concise Category Summary List (Category Names + Counts ONLY)
    let tier2CategoryList = `📋 **รายการปัญหาทั้งหมดใน${timeLabel} (รวม ${matchedIssues.length} กรณี จาก ${matchedChatsCount} แชท):**\n\n`;
    let catIdx = 1;
    for (const [catName, issueList] of Object.entries(groupedIssuesMap)) {
      tier2CategoryList += `${catIdx}. **${catName}** (${issueList.length} กรณี)\n`;
      catIdx++;
    }
    tier2CategoryList += `\n💡 *สามารถพิมพ์ถามเจาะลึกเพิ่มเติมได้ค่ะ เช่น "ขอรายละเอียดหมวดที่ 1" หรือ "1. ${Object.keys(groupedIssuesMap)[0] || 'ปัญหาเข้าสู่ระบบ'} มีแชตไหนบ้าง"*`;

    // Build Tier 3: Category Drilldown Detail
    let tier3CategoryDrilldown = '';
    const catNameToKey = (catName) => {
      return catName === 'ฝาก-ถอน' ? 'deposit_withdrawal' :
             catName === 'ปัญหาการเข้าสู่ระบบ' ? 'login_issue' :
             catName === 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย' ? 'access_blocked' :
             catName === 'ความปลอดภัยของบัญชี' ? 'account_security' :
             catName === 'ข้อผิดพลาดระบบ API' ? 'api_error' :
             catName === 'ปัญหาเบราว์เซอร์/อุปกรณ์' ? 'device_compatibility' :
             catName === 'ขอเพิ่มฟีเจอร์' ? 'feature_request' :
             catName === 'ข้อเสนอแนะและร้องเรียน' ? 'feedback_complaint' :
             catName === 'ปัญหาการเล่นเกม' ? 'game_issue' :
             catName === 'กดปุ่มแล้วไม่ตอบสนอง' ? 'interaction_lag' :
             catName === 'ปัญหาการแจ้งเตือน' ? 'notification_issue' :
             catName === 'หน้าเว็บค้าง/โหลดช้า' ? 'page_load_freeze' :
             catName === 'ระบบการชำระเงิน/ธนาคาร' ? 'payment_gateway' :
             catName === 'ประสิทธิภาพระบบช้า' ? 'performance_issue' :
             catName === 'โปรโมชั่นและโบนัส' ? 'promo_bonus' :
             catName === 'การสมัครสมาชิก' ? 'registration' :
             catName === 'การแสดงผลผิดเพี้ยน' ? 'ui_rendering_issue' :
             catName === 'สิทธิประโยชน์ระดับ VIP' ? 'vip_privilege' : 'other';
    };

    const filteredEntries = isCategoryFilter ? 
      Object.entries(groupedIssuesMap).filter(([catName]) => targetCategories.includes(catNameToKey(catName))) :
      Object.entries(groupedIssuesMap);

    const requestedCatEntries = filteredEntries.length > 0 ? filteredEntries : Object.entries(groupedIssuesMap);
    if (requestedCatEntries.length > 0) {
      tier3CategoryDrilldown = `🔍 **รายละเอียด${requestedCatEntries[0][0]} (${requestedCatEntries[0][1].length} กรณี):**\n\n`;
      requestedCatEntries.forEach(([catName, issueList]) => {
        if (requestedCatEntries.length > 1) {
          tier3CategoryDrilldown += `📌 **${catName}** (${issueList.length} กรณี):\n`;
        }
        issueList.forEach(item => {
          tier3CategoryDrilldown += `   ${item}\n`;
        });
        tier3CategoryDrilldown += `\n`;
      });
tier3CategoryDrilldown = tier3CategoryDrilldown.trim();
    }

    // Build Original Executive Summary Formatted Pattern (Strictly matching 19 Official BO Categories)
    const problemOnlyEntriesList = Object.entries(categoryCounts).filter(([id]) => id !== 'other');
    const entriesToRank = problemOnlyEntriesList.length > 0 ? problemOnlyEntriesList : Object.entries(categoryCounts);

    const overallCategoryCounts = {};
    (filtered || []).forEach(chat => {
      const issues = chat.chat_issues && chat.chat_issues.length > 0 ? chat.chat_issues : [
        { category_id: chat.category_id }
      ];
      issues.forEach(iss => {
        const cat = iss.category_id || chat.category_id || 'other';
        const cleanCat = cat.includes(':') ? cat.split(':')[1] : cat;
        overallCategoryCounts[cleanCat] = (overallCategoryCounts[cleanCat] || 0) + 1;
      });
    });

    const overallProblemOnly = Object.entries(overallCategoryCounts).filter(([id]) => id !== 'other');
    const overallSorted = (overallProblemOnly.length > 0 ? overallProblemOnly : Object.entries(overallCategoryCounts))
      .sort((a, b) => b[1] - a[1]);

    const catTHMapLocal = {
      'deposit_withdrawal': 'การฝาก-ถอนเงิน',
      'login_issue': 'ปัญหาการเข้าสู่ระบบ',
      'access_blocked': 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย',
      'account_security': 'ความปลอดภัยของบัญชี',
      'api_error': 'ข้อผิดพลาดระบบ API',
      'device_compatibility': 'ปัญหาเบราว์เซอร์/อุปกรณ์',
      'feature_request': 'ขอเพิ่มฟีเจอร์',
      'feedback_complaint': 'ข้อเสนอแนะและร้องเรียน',
      'game_issue': 'ปัญหาการเล่นเกม',
      'interaction_lag': 'กดปุ่มแล้วไม่ตอบสนอง',
      'notification_issue': 'ปัญหาการแจ้งเตือน',
      'page_load_freeze': 'หน้าเว็บค้าง/โหลดช้า',
      'payment_gateway': 'ระบบการชำระเงิน/ธนาคาร',
      'performance_issue': 'ประสิทธิภาพระบบช้า',
      'promo_bonus': 'โปรโมชั่นและโบนัส',
      'registration': 'การสมัครสมาชิก',
      'ui_rendering_issue': 'การแสดงผลผิดเพี้ยน',
      'vip_privilege': 'สิทธิประโยชน์ระดับ VIP',
      'other': 'เรื่องอื่นๆ'
    };

    let overallTopCatText = '';
    const totalIssuesOverall = filtered.reduce((acc, c) => acc + (c.chat_issues?.length || 1), 0);
    overallSorted.slice(0, 5).forEach((item, idx) => {
      const cName = catTHMapLocal[item[0]] || item[0];
      const pct = totalIssuesOverall > 0 ? Math.round((item[1] / totalIssuesOverall) * 100) : 0;
      overallTopCatText += `${idx + 1}. ${cName} - ${item[1]} กรณี (${pct}%)\n`;
    });

    const totalAllPeriodIssues = filtered.reduce((acc, c) => acc + (c.chat_issues?.length || 1), 0);
    const baseForPct = isCategoryFilter ? totalAllPeriodIssues : matchedIssues.length;

    // Map & Deduplicate categories by unique display name to prevent duplicate lines
    const aggregatedCatMap = {};
    entriesToRank.forEach(([id, count]) => {
      const catName = id === 'deposit_withdrawal' ? 'ฝาก-ถอน' :
                      id === 'page_load_freeze' ? 'หน้าเว็บค้าง/โหลดช้า' :
                      id === 'ui_rendering_issue' ? 'การแสดงผลผิดเพี้ยน' :
                      id === 'login_issue' ? 'ปัญหาการเข้าสู่ระบบ' :
                      id === 'access_blocked' ? 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย' :
                      id === 'account_security' ? 'ความปลอดภัยของบัญชี' :
                      id === 'api_error' ? 'ข้อผิดพลาดระบบ API' :
                      id === 'device_compatibility' ? 'ปัญหาเบราว์เซอร์/อุปกรณ์' :
                      id === 'feature_request' ? 'ขอเพิ่มฟีเจอร์' :
                      id === 'feedback_complaint' ? 'ข้อเสนอแนะและร้องเรียน' :
                      id === 'game_issue' ? 'ปัญหาการเล่นเกม' :
                      id === 'interaction_lag' ? 'กดปุ่มแล้วไม่ตอบสนอง' :
                      id === 'notification_issue' ? 'ปัญหาการแจ้งเตือน' :
                      id === 'payment_gateway' ? 'ระบบการชำระเงิน/ธนาคาร' :
                      id === 'performance_issue' ? 'ประสิทธิภาพระบบช้า' :
                      id === 'promo_bonus' ? 'โปรโมชั่นและโบนัส' :
                      id === 'registration' ? 'การสมัครสมาชิก' :
                      id === 'vip_privilege' ? 'สิทธิประโยชน์ระดับ VIP (VIP Privileges)' :
                      id === 'other' ? 'ไม่ใช่ปัญหา' : id;

      if (!aggregatedCatMap[catName]) {
        aggregatedCatMap[catName] = 0;
      }
      aggregatedCatMap[catName] += count;
    });

    const sortedCategoriesList = Object.entries(aggregatedCatMap)
      .map(([name, count]) => {
        const pct = baseForPct > 0 ? Math.round((count / baseForPct) * 100) : 0;
        return { name, count, pct };
      })
      .sort((a, b) => b.count - a.count);

    let topCategoriesText = '';
    sortedCategoriesList.slice(0, 5).forEach((cat, idx) => {
      if (isCategoryFilter) {
        topCategoriesText += `${idx + 1}. ${cat.name} - ${cat.count} กรณี (คิดเป็น ${cat.pct}% ของเคสปัญหาทั้งหมด ${totalAllPeriodIssues} กรณีใน${timeLabel})\n`;
      } else {
        topCategoriesText += `${idx + 1}. ${cat.name} - ${cat.count} กรณี (${cat.pct}%)\n`;
      }
    });

    const totalChatsCount = matchedChatsCount || filtered.length;
    const totalIssuesCount = matchedIssues.length || totalChatsCount;

    const periodText = resolvedTimeLabel || 'ช่วงเวลาที่เลือก';

    const topProblemCatTitle = sortedCategoriesList[0]?.name.split(' (')[0] || 'การฝาก-ถอนเงิน';

    const executiveSummaryFormattedThai = `📊 **สรุปปัญหาแชท${periodText}**\n\n` +
      `- จำนวนแชททั้งหมด: ${totalChatsCount} ครั้ง\n` +
      `- ปัญหาที่ถูกระบุรวม: ${totalIssuesCount} กรณี\n\n` +
      `📌 **หมวดหมู่ปัญหาที่พบมากที่สุด:**\n` +
      `${topCategoriesText}\n` +
      `📌 **การแบ่งปัญหาตามความสำคัญ:**\n` +
      `- ระดับสูง: ${priorityCounts.high || 0} กรณี\n` +
      `- ระดับกลาง: ${priorityCounts.medium || 0} กรณี\n` +
      `- ระดับต่ำ: ${priorityCounts.low || 0} กรณี\n` +
      `- กรณีฉุกเฉิน: ${priorityCounts.urgent || 0} กรณี\n\n` +
      `💰 **ข้อมูลเพิ่มเติม:** ในช่วง${periodText}นี้ ปัญหาที่พบมากที่สุดคือ${topProblemCatTitle} ซึ่งเป็นประเด็นสำคัญที่ควรติดตามแก้ไขปรับปรุงค่ะ`;

    // Re-order groupedIssuesMap according to sortedCategoriesList (highest count first)
    const sortedGroupedIssuesMap = {};
    sortedCategoriesList.forEach(cat => {
      if (groupedIssuesMap[cat.name]) {
        sortedGroupedIssuesMap[cat.name] = groupedIssuesMap[cat.name];
      }
    });

    return {
      period_days: days,
      target_categories: targetCategories,
      matched_issues_count: matchedIssues.length,
      matched_chats_count: matchedChatsCount,
      priority_breakdown: priorityCounts,
      summary_thai_total: summaryThaiTotal,
      summary_thai_top_category: summaryThaiTopCategory,
      summary_thai_priority: summaryThaiPriority,
      executive_summary_formatted_thai: executiveSummaryFormattedThai,
      tier2_category_list: tier2CategoryList.trim(),
      tier3_category_drilldown: tier3CategoryDrilldown,
      all_issues_grouped_thai: tier3CategoryDrilldown || tier2CategoryList.trim(),
      matched_issues_list: matchedIssues,
      grouped_issues_map: sortedGroupedIssuesMap,
      overall_top_categories_text: overallTopCatText.trim(),
      sorted_categories_list: sortedCategoriesList
    };
  } catch (err) {
    console.error('Error fetching chat analytics:', err.message);
    throw err;
  }
}

/**
 * Fetch Financial & Balance Statistics (Deposits, Withdrawals, Pending Adjustments)
 * @param {string} [companyId]
 * @param {string} [timeframe='today'] - 'today' | '7days' | '30days'
 */
export async function getFinancialBalance(companyId, timeframe = 'today') {
  try {
    let query = supabase.from('transactions').select('*');
    if (companyId) query = query.eq('company_id', companyId);

    const { data: txs, error } = await query;
    if (error || !txs || txs.length === 0) throw new Error('Using financial fallback metrics');

    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let pendingAdjustments = 0;

    txs.forEach(t => {
      if (t.type === 'deposit' && t.status === 'success') totalDeposits += (t.amount || 0);
      else if (t.type === 'withdrawal' && t.status === 'success') totalWithdrawals += (t.amount || 0);
      else if (t.status === 'pending') pendingAdjustments++;
    });

    return {
      timeframe,
      total_deposit_amount: totalDeposits,
      total_withdrawal_amount: totalWithdrawals,
      net_balance: totalDeposits - totalWithdrawals,
      pending_adjustments_count: pendingAdjustments,
      currency: 'THB'
    };
  } catch (err) {
    return {
      timeframe,
      total_deposit_amount: 0,
      total_withdrawal_amount: 0,
      net_balance: 0,
      pending_adjustments_count: 0,
      currency: 'THB',
      message: 'ไม่พบข้อมูลรายการธุรกรรมฝาก-ถอนเงินในฐานข้อมูล Supabase'
    };
  }
}

/**
 * Fetch Marketing Statistics (Bonus Redemptions, Birthday Promos, Active Campaigns)
 * @param {string} [companyId]
 */
export async function getMarketingStats(companyId) {
  try {
    let query = supabase.from('promotions').select('*');
    if (companyId) query = query.eq('company_id', companyId);

    const { data: promo, error } = await query;
    if (error || !promo || promo.length === 0) throw new Error('No promotions data found');

    return {
      active_campaigns_count: promo.length,
      top_promotion_name: promo[0]?.title || 'ไม่มีข้อมูล',
      total_bonus_distributed_thb: 0
    };
  } catch (err) {
    return {
      active_campaigns_count: 0,
      birthday_bonus_claims_this_month: 0,
      top_promotion_name: 'ไม่พบข้อมูลโปรโมชั่น',
      total_bonus_distributed_thb: 0,
      message: 'ไม่พบข้อมูลโปรโมชั่นในฐานข้อมูล Supabase'
    };
  }
}

/**
 * Fetch Customer & Registration Analytics (New Customers, Total Customers, Registration Inquiries)
 * @param {string} [companyId]
 * @param {number} [days=7]
 */
export async function getCustomerAnalytics(companyId, days = 7, timeframeMode = 'today', userQuery = '') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode || days);
    const lowerQuery = (userQuery || '').toLowerCase();
    const isListRequested = lowerQuery.includes('ใครบ้าง') || lowerQuery.includes('รายชื่อ') || lowerQuery.includes('รายละเอียด') || lowerQuery.includes('ใคร');

    // 1. Query exact customers table from Supabase
    const { data: customers, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const totalCustomersCount = (customers || []).length;
    
    // Filter new customers created within cutoff
    const newCustomersList = (customers || []).filter(c => {
      if (!c.created_at) return false;
      const d = new Date(c.created_at);
      return d >= startCutoff && d < endCutoff;
    }).map(c => {
      const regDate = new Date(c.created_at);
      const formattedTH = regDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const timeOnlyTH = regDate.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });
      return {
        id: c.id,
        name: c.name || 'Guest Customer',
        phone: c.phone || 'ไม่ระบุ',
        email: c.email || 'ไม่ระบุ',
        registered_at_thailand: formattedTH,
        time_only_th: timeOnlyTH
      };
    });

    const newCustomerIds = new Set(newCustomersList.map(c => c.id));

    // 2. Also query chats created within cutoff for these new customers
    let chatQuery = supabase.from('chats').select('*, customers(*)').gte('created_at', startCutoff.toISOString()).lt('created_at', endCutoff.toISOString()).order('created_at', { ascending: false });
    const { data: chats } = await chatQuery;

    const chatDetailsList = (chats || []).filter(c => newCustomerIds.has(c.customer_id)).map(c => {
      const chatDate = new Date(c.created_at);
      const timeOnlyTH = chatDate.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });
      return {
        id: c.id,
        customer_id: c.customer_id,
        customer_name: c.customers?.name || 'Guest Customer',
        created_at_thailand: chatDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
        time_only_th: timeOnlyTH,
        summary: c.summary || 'ทักเข้ามาสอบถามข้อมูล'
      };
    });

    // Build formatted Thai summary focusing ONLY on count unless customer list is explicitly requested!
    const labelText = resolvedLabel || (days === 1 ? 'ในวันนี้' : `ย้อนหลัง ${days} วัน`);
    let summaryText = '';

    const isTotalQuery = lowerQuery.includes('ทั้งหมด') || lowerQuery.includes('รวม') || lowerQuery.includes('ที่มี');

    if (isTotalQuery && !lowerQuery.includes('ใหม่')) {
      summaryText = `- จำนวนลูกค้าทั้งหมดในระบบมี **${totalCustomersCount} คน** ค่ะ\n\n💡 *สามารถพิมพ์ถามเจาะลึกเพิ่มเติมได้ค่ะ เช่น "วันนี้มีลูกค้าใหม่กี่คน"*`;
    } else if (!isListRequested) {
      if (newCustomersList.length === 0) {
        summaryText = `- ${labelText}ยังไม่มีลูกค้าใหม่สมัครสมาชิกค่ะ`;
      } else {
        summaryText = `- ${labelText}มีลูกค้าใหม่สมัครสมาชิกทั้งหมด **${newCustomersList.length} คน** ค่ะ\n\n💡 *สามารถพิมพ์ถามเจาะลึกเพิ่มเติมได้ค่ะ เช่น "มีใครบ้าง"*`;
      }
    } else {
      summaryText = `👤 **รายงานรายชื่อลูกค้าใหม่${labelText} (${newCustomersList.length} คน):**\n\n`;
      if (newCustomersList.length === 0) {
        summaryText += `ไม่พบลูกค้าใหม่สมัครสมาชิก${labelText}ค่ะ`;
      } else {
        newCustomersList.forEach((c, idx) => {
          const nameStr = c.name || 'Guest Customer';
          const timeStr = c.time_only_th || 'ไม่ระบุ';
          summaryText += `${idx + 1}. **${nameStr}** (${c.id} - เวลา **${timeStr} น.**)\n`;
        });
      }
    }

    return {
      period_days: days,
      total_customers_count: totalCustomersCount,
      new_customers_count: chatDetailsList.length || newCustomersList.length,
      new_customers_details: newCustomersList,
      chat_details_list: chatDetailsList,
      formatted_summary_thai: summaryText
    };
  } catch (err) {
    console.error('Error fetching customer analytics:', err.message);
    return {
      period_days: days,
      total_customers_count: 0,
      new_customers_count: 0,
      new_customers_details: [],
      chat_details_list: [],
      formatted_summary_thai: 'ไม่พบข้อมูลลูกค้าในฐานข้อมูล Supabase'
    };
  }
}

/**
 * Dynamic Future-Proof VIP Customer & Financial Query Analytics
 * @param {string} [companyId]
 * @param {string} [timeframeMode='today']
 * @param {string} [categoryFilter='finance']
 */
export async function getVipCustomerAnalytics(companyId, timeframeMode = 'today', categoryFilter = 'finance') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);
    
    // 1. Query customers table dynamically from Supabase
    const { data: customers, error } = await supabase.from('customers').select('*');
    if (error) throw error;

    // Check if any VIP column or field exists on customers table (e.g. tier === 'VIP', is_vip === true, role === 'VIP')
    const vipCustomers = (customers || []).filter(c => {
      const tierVal = String(c.tier || c.vip_level || c.type || c.role || c.is_vip || '').toLowerCase();
      return tierVal.includes('vip') || c.is_vip === true;
    });

    const vipCustomerIds = new Set(vipCustomers.map(c => c.id));

    // 2. Query chats for this period
    let chatQuery = supabase.from('chats')
      .select('*, chat_issues(*)')
      .gte('created_at', startCutoff.toISOString())
      .lt('created_at', endCutoff.toISOString());

    const { data: chats } = await chatQuery;

    // 3. Filter chats by VIP customers AND financial issues
    const vipFinancialChats = (chats || []).filter(c => {
      const isVipCustomer = vipCustomerIds.has(c.customer_id) || String(c.customer_tier || c.vip || '').toLowerCase().includes('vip');
      
      const hasFinanceIssue = (c.chat_issues || []).some(iss => 
        iss.category_id === 'deposit_withdrawal' || 
        iss.category_id === 'payment_gateway' || 
        (iss.summary || '').includes('ฝาก') || 
        (iss.summary || '').includes('ถอน') || 
        (iss.summary || '').includes('ชำระเงิน') || 
        (iss.summary || '').includes('การเงิน')
      ) || c.category_id === 'deposit_withdrawal' || c.category_id === 'payment_gateway';

      return isVipCustomer && hasFinanceIssue;
    });

    const labelText = resolvedLabel || 'วันนี้';

    if (vipCustomers.length === 0 && vipFinancialChats.length === 0) {
      return {
        vip_customer_count: 0,
        vip_financial_chats_count: 0,
        formatted_summary_thai: `- ไม่พบข้อมูลตามเงื่อนไขที่ค้นหาค่ะ`
      };
    }

    return {
      vip_customer_count: vipCustomers.length,
      vip_financial_chats_count: vipFinancialChats.length,
      vip_chats_details: vipFinancialChats,
      formatted_summary_thai: `ℹ️ **รายงานสถิติลูกค้า VIP ที่แจ้งปัญหาเกี่ยวกับการเงิน${labelText}:**\n\n📌 พบลูกค้า VIP ทักเข้ามาแจ้งปัญหาการเงิน: **${vipFinancialChats.length} คน** (จากลูกค้า VIP ในระบบทั้งหมด ${vipCustomers.length} คน)`
    };

  } catch (err) {
    return {
      vip_customer_count: 0,
      vip_financial_chats_count: 0,
      formatted_summary_thai: `- ไม่พบข้อมูลตามเงื่อนไขที่ค้นหาค่ะ`
    };
  }
}

/**
 * Customer Sentiment & Satisfaction Analytics Engine
 * Analyzes chat issue priorities, complaint ratios, and high-urgency friction points to provide executive sentiment insights.
 * @param {string} [companyId]
 * @param {string} [timeframeMode='today']
 */
export async function getCustomerSentimentAnalysis(companyId, timeframeMode = 'today') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);

    let query = supabase
      .from('chats')
      .select('id, category_id, priority, created_at, chat_issues(summary, category_id, priority)');

    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const filtered = (chats || []).filter(c => {
      if (!c.created_at) return false;
      const cDate = new Date(c.created_at);
      return cDate >= startCutoff && cDate < endCutoff;
    });

    const labelText = resolvedLabel || 'วันนี้';
    const totalChats = filtered.length;
    let highPriorityCount = 0;
    let urgentCount = 0;
    let complaintCount = 0;

    filtered.forEach(c => {
      const issues = c.chat_issues && c.chat_issues.length > 0 ? c.chat_issues : [{ category_id: c.category_id, priority: c.priority }];
      issues.forEach(iss => {
        const p = (iss.priority || c.priority || '').toLowerCase();
        if (p === 'high') highPriorityCount++;
        if (p === 'urgent') urgentCount++;
        if (iss.category_id === 'feedback_complaint') complaintCount++;
      });
    });

    if (totalChats === 0) {
      return {
        total_chats: 0,
        sentiment_summary_thai: `😊 **รายงานดรรชนีความพึงพอใจและอารมณ์ของลูกค้า (${labelText}):**\n\n🟢 **ภาพรวมอารมณ์ลูกค้า:** สงบผ่อนคลาย / เป็นปกติค่ะ\n- ไม่พบรายการแชททักเข้ามาแจ้งปัญหาใน${labelText}ค่ะ`
      };
    }

    const frictionRatio = totalChats > 0 ? Math.round(((highPriorityCount + urgentCount) / totalChats) * 100) : 0;
    let sentimentEmoji = '😊';
    let sentimentDesc = 'พึงพอใจ / บรรยากาศเป็นปกติ';

    if (frictionRatio > 50 || urgentCount > 0 || complaintCount > 0) {
      sentimentEmoji = '⚠️';
      sentimentDesc = 'มีอารมณ์ตึงเครียดบางส่วน (พบเคสเร่งด่วน/เคสร้องเรียน)';
    } else if (highPriorityCount > 0) {
      sentimentEmoji = '🟡';
      sentimentDesc = 'มีข้อกังวลเรื่องการใช้งาน แต่โดยรวมอยู่ในเกณฑ์ที่ทีมงานรับมือได้';
    }

    const summaryText = `${sentimentEmoji} **รายงานดรรชนีความพึงพอใจและอารมณ์ของลูกค้า (${labelText}):**\n\n` +
      `📌 **ภาพรวมอารมณ์ลูกค้า:** ${sentimentDesc}\n` +
      `- จำนวนแชททักเข้ามาทั้งหมด: **${totalChats} ครั้ง**\n` +
      `- เคสที่มีอารมณ์เร่งด่วน/ความสำคัญสูง: **${highPriorityCount + urgentCount} กรณี** (คิดเป็น **${frictionRatio}%** ของแชท${labelText})\n` +
      `- เคสร้องเรียนแอดมิน/บริการ: **${complaintCount} กรณี**\n\n` +
      `💡 *ข้อเสนอแนะ: ทีมแอดมินตอบเร็วน้ำเสียงสุภาพ จะช่วยให้อารมณ์ลูกค้าผ่อนคลายขึ้นได้ดีที่สุดค่ะ*`;

    return {
      total_chats: totalChats,
      high_priority_count: highPriorityCount,
      complaint_count: complaintCount,
      sentiment_summary_thai: summaryText
    };
  } catch (err) {
    return {
      sentiment_summary_thai: `- ไม่พบข้อมูลตามเงื่อนไขที่ค้นหาค่ะ`
    };
  }
}

/**
 * Urgent Action Required Analytics Engine
 * Identifies and ranks top high-priority / urgent issues that require immediate resolution today.
 * @param {string} [companyId]
 * @param {string} [timeframeMode='today']
 */
export async function getUrgentActionRequiredScan(companyId, timeframeMode = 'today') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);

    let query = supabase
      .from('chats')
      .select('id, category_id, priority, created_at, chat_issues(summary, category_id, priority)');

    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const filtered = (chats || []).filter(c => {
      if (!c.created_at) return false;
      const cDate = new Date(c.created_at);
      return cDate >= startCutoff && cDate < endCutoff;
    });

    const labelText = resolvedLabel || 'วันนี้';

    if (filtered.length === 0) {
      return {
        urgent_action_summary_thai: `🟢 **รายงานเคสที่ต้องแก้ไขด่วน (${labelText}):**\n\n- ไม่พบเคสปัญหาที่ต้องแก้ไขด่วนใน${labelText}ค่ะ (0 กรณี)`
      };
    }

    const issueList = [];
    const categoryCounts = {};
    let urgentCount = 0;
    let highCount = 0;
    let mediumCount = 0;

    filtered.forEach(chat => {
      const issues = chat.chat_issues && chat.chat_issues.length > 0 ? chat.chat_issues : [
        { summary: `เคสแชต ${chat.id}`, category_id: chat.category_id, priority: chat.priority }
      ];

      issues.forEach(iss => {
        const p = (iss.priority || chat.priority || 'medium').toLowerCase();
        if (p === 'urgent') urgentCount++;
        else if (p === 'high') highCount++;
        else if (p === 'medium') mediumCount++;

        const cat = iss.category_id || chat.category_id || 'deposit_withdrawal';
        const cleanCat = cat.includes(':') ? cat.split(':')[1] : cat;

        categoryCounts[cleanCat] = (categoryCounts[cleanCat] || 0) + 1;

        issueList.push({
          chat_id: chat.id,
          category_id: cleanCat,
          summary: iss.summary,
          priority: p,
          created_at: chat.created_at
        });
      });
    });

    const catTHMap = {
      'deposit_withdrawal': 'การฝาก-ถอนเงิน',
      'payment_gateway': 'ระบบการชำระเงิน/ธนาคาร',
      'login_issue': 'ปัญหาการเข้าสู่ระบบ',
      'access_blocked': 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย',
      'page_load_freeze': 'หน้าเว็บค้าง/โหลดช้า',
      'api_error': 'ข้อผิดพลาดระบบ API',
      'ui_rendering_issue': 'การแสดงผลผิดเพี้ยน',
      'feedback_complaint': 'ข้อเสนอแนะและร้องเรียน',
      'promo_bonus': 'โปรโมชั่นและโบนัส',
      'interaction_lag': 'กดปุ่มแล้วไม่ตอบสนอง'
    };

    const problemEntries = Object.entries(categoryCounts).filter(([id]) => id !== 'other');
    const sortedCategories = (problemEntries.length > 0 ? problemEntries : Object.entries(categoryCounts)).sort((a, b) => b[1] - a[1]);

    const topCatKey = sortedCategories[0] ? sortedCategories[0][0] : 'payment_gateway';
    const topCatName = catTHMap[topCatKey] || topCatKey;
    const topCatCount = sortedCategories[0] ? sortedCategories[0][1] : 1;

    const topCategoryIssues = issueList.filter(i => i.category_id === topCatKey);

    let text = `🚨 **เคสปัญหาที่ต้องรีบแก้ไขโดยเร็วที่สุด (${labelText}):**\n\n`;
    text += `🥇 **อันดับ 1 ที่ควรแก้ไขด่วนที่สุด:** **${topCatName}** (พบ **${topCatCount} กรณี**)\n\n`;
    text += `📌 **รายละเอียดเคสที่พบในระบบ:**\n`;

    topCategoryIssues.slice(0, 3).forEach(iss => {
      let thTime = '';
      if (iss.created_at) {
        try {
          const d = new Date(iss.created_at);
          thTime = d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
        } catch (e) {}
      }
      const timeStr = thTime ? ` (เวลา **${thTime}**)` : '';
      text += `- แชต \`${iss.chat_id}\`${timeStr} - "${iss.summary}"\n`;
    });

    text += `\n💡 **ข้อแนะนำ AI Triage สำหรับทีมงาน:**\n`;
    if (topCatKey === 'payment_gateway' || topCatKey === 'deposit_withdrawal') {
      text += `ควรประสานงานทีม Tech/Finance เข้าตรวจสอบระบบชำระเงินและสเตทเม้นท์ธนาคารทันที เพื่อป้องกันรายการค้างปรับสะสมค่ะ`;
    } else if (topCatKey === 'page_load_freeze' || topCatKey === 'access_blocked' || topCatKey === 'api_error') {
      text += `ควรให้ทีม Server/Dev เช็ก Latency และ API Endpoint เพื่อแก้ไขปัญหาหน้าเว็บหนืดค้างโดยเร็วที่สุดค่ะ`;
    } else if (topCatKey === 'feedback_complaint') {
      text += `ควรให้ทีมแอดมินเร่งตอบแชตลูกค้ากลุ่มนี้ทันที เพื่อลดความเสี่ยงการเสียลูกค้าและเคสร้องเรียนค่ะ`;
    } else {
      text += `ควรติดตามและเร่งแก้ไขเคสในหมวดนี้เป็นลำดับแรกเพื่อป้องกันผลกระทบต่อผู้ใช้งานค่ะ`;
    }

    text += `\n\n📊 *ภาพรวมระดับความด่วน${labelText}: ด่วนที่สุด ${urgentCount} กรณี | ความสำคัญสูง ${highCount} กรณี | ระดับกลาง ${mediumCount} กรณี*`;

    return { urgent_action_summary_thai: text };
  } catch (err) {
    return { urgent_action_summary_thai: `- ไม่พบข้อมูลตามเงื่อนไขที่ค้นหาค่ะ` };
  }
}

/**
 * RAG Knowledge Base Retrieval (Query SOPs, manuals, FAQs from Supabase knowledge_base table)
 * @param {string} userQuery
 * @param {string} [companyId]
 */
export async function queryKnowledgeBase(userQuery, companyId) {
  try {
    let query = supabase.from('knowledge_base').select('*');
    if (companyId) query = query.eq('company_id', companyId);

    const { data: items, error } = await query;
    if (error) throw error;

    const lowerQuery = (userQuery || '').toLowerCase();

    // Match articles by keyword relevance
    const matched = (items || []).filter(item => {
      const title = (item.title || '').toLowerCase();
      const content = (item.content || '').toLowerCase();
      return lowerQuery.split(' ').some(w => w.length > 2 && (title.includes(w) || content.includes(w))) ||
             lowerQuery.includes('ฝาก') || lowerQuery.includes('ถอน') || lowerQuery.includes('ช้า') || lowerQuery.includes('วิธี') || lowerQuery.includes('คู่มือ');
    });

    const results = matched.length > 0 ? matched : (items || []).slice(0, 3);

    return {
      query: userQuery,
      total_matches: results.length,
      knowledge_articles: results.map(item => ({
        id: item.id,
        title: item.title,
        category: item.category || 'คู่มือระบบ',
        content: item.content
      }))
    };
  } catch (err) {
    console.error('Error querying knowledge base:', err.message);
    return {
      query: userQuery,
      total_matches: 1,
      knowledge_articles: [
        {
          title: 'คู่มือการฝากถอนเงินล่าช้า',
          category: 'คู่มือระบบ',
          content: 'ขั้นตอนการทำธุรกรรมฝากถอนเงิน: รายการฝากอัตโนมัติใช้เวลาปรับยอดไม่เกิน 1 นาที หากธนาคารปลายทางเกิดความล่าช้าให้ทีม Finance ดำเนินการคีย์มือทันที'
        }
      ]
    };
  }
}

/**
 * Diagnostic Analysis for Customer Drop ("ลูกค้าหายไปไหน" / "ทำไมลูกค้าลดลง")
 * Maps customer/chat drop to top issues & root causes of the day
 */
export async function getCustomerDropDiagnostics(companyId) {
  try {
    const todayData = await getChatAnalytics(companyId, 1);
    const yesterdayData = await getChatAnalytics(companyId, 1.5);
    const todayCust = await getCustomerAnalytics(companyId, 1);

    const todayChatCount = todayData.matched_chats_count || 0;
    const yesterdayChatCount = yesterdayData.matched_chats_count || 0;
    const todayCustCount = todayCust.new_customers_count || 0;

    const chatDiff = todayChatCount - yesterdayChatCount;
    const chatPctChange = yesterdayChatCount > 0 ? ((chatDiff / yesterdayChatCount) * 100).toFixed(1) : 0;

    const topIssues = todayData.matched_issues_list || [];
    const topCatText = todayData.summary_thai_top_category || 'ไม่พบปัญหาโดดเด่น';

    let summaryText = `📊 **วิเคราะห์สาเหตุและแนวโน้มจำนวนลูกค้า/แชต (Customer & Chat Drop Diagnostics):**\n\n`;
    summaryText += `- จำนวนแชตในวันนี้: **${todayChatCount} เคส** (เมื่อวาน: ${yesterdayChatCount} เคส, เปลี่ยนแปลง: ${chatDiff >= 0 ? '+' : ''}${chatPctChange}%)\n`;
    summaryText += `- จำนวนลูกค้าสมัครใหม่วันนี้: **${todayCustCount} คน**\n\n`;
    summaryText += `🔍 **วิเคราะห์สาเหตุหลักจากปัญหาที่เกิดขึ้นในระบบวันนี้:**\n`;
    summaryText += `- ${topCatText}\n`;
    
    if (topIssues.length > 0) {
      summaryText += `- ตัวอย่างประเด็นสำคัญที่ลูกค้าแจ้งเข้ามาในวันนี้:\n`;
      topIssues.slice(0, 3).forEach((iss, idx) => {
        summaryText += `  ${idx + 1}. "${iss.summary}" (หมวด: ${iss.category_id}, ความด่วน: ${iss.priority})\n`;
      });
    } else {
      summaryText += `- ไม่พบรายการปัญหารุนแรงที่ส่งผลกระทบให้ลูกค้าลดลงอย่างมีนัยสำคัญค่ะ\n`;
    }

    return {
      today_chat_count: todayChatCount,
      yesterday_chat_count: yesterdayChatCount,
      new_customers_today: todayCustCount,
      top_category_summary: topCatText,
      diagnostics_summary_thai: summaryText
    };
  } catch (err) {
    console.error('Error in getCustomerDropDiagnostics:', err.message);
    return {
      diagnostics_summary_thai: `📊 **วิเคราะห์แนวโน้มลูกค้า:** ไม่พบข้อมูลปัญหาความขัดข้องรุนแรงที่ส่งผลกระทบต่อจำนวนลูกค้าอย่างมีนัยสำคัญในวันนี้ค่ะ`
    };
  }
}

/**
 * Hourly Peak Analysis ("มีปัญหาตอนกี่โมง" / "แอดมินตอบช้ามีเวลาไหนบ้าง")
 * Supports filtering by specific category (e.g. interaction_lag / แอดมินตอบช้า) and exact timestamps
 */
export async function getHourlyPeakAnalysis(companyId, periodMode = 1, targetCategories = [], customLabel = 'วันนี้') {
  try {
    const data = await getChatAnalytics(companyId, periodMode, targetCategories, customLabel);
    let issues = data.matched_issues_list || [];

    const isCategoryFiltered = Array.isArray(targetCategories) && targetCategories.length > 0;
    if (isCategoryFiltered) {
      issues = issues.filter(iss => targetCategories.includes(iss.category_id));
    }

    const categoryLabelMap = {
      'interaction_lag': 'แอดมินตอบช้า/รอนาน',
      'feedback_complaint': 'แอดมินตอบช้า/ร้องเรียน',
      'login_issue': 'การเข้าสู่ระบบ',
      'page_load_freeze': 'หน้าเว็บค้าง/โหลดช้า',
      'ui_rendering_issue': 'การแสดงผลผิดเพี้ยน',
      'deposit_withdrawal': 'ฝาก-ถอนเงิน',
      'promo_bonus': 'โปรโมชั่น/โบนัส'
    };

    const targetCatNames = isCategoryFiltered
      ? targetCategories.map(c => categoryLabelMap[c] || c).join(' / ')
      : null;

    const hourlyCounts = {};
    const exactTimesList = [];

    issues.forEach(iss => {
      if (!iss.created_at) return;
      const dateObj = new Date(iss.created_at);
      const thHour = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(dateObj);
      const thTime = dateObj.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
      const slot = `${thHour}:00 - ${thHour}:59 น.`;
      hourlyCounts[slot] = (hourlyCounts[slot] || 0) + 1;
      exactTimesList.push({
        time: thTime,
        slot,
        summary: iss.summary,
        priority: iss.priority
      });
    });

    const sortedSlots = Object.entries(hourlyCounts).sort((a, b) => b[1] - a[1]);

    let text = isCategoryFiltered
      ? `⏰ **สรุปช่วงเวลาที่เกิดปัญหา "${targetCatNames}" (${customLabel}):**\n\n`
      : `⏰ **สรุปช่วงเวลาที่เกิดปัญหาแชตย้อนหลัง (${customLabel}):**\n\n`;

    if (sortedSlots.length > 0) {
      text += `- จำนวนเคสทั้งหมด: **${issues.length} กรณี**\n`;
      text += `- ช่วงเวลาที่พบมากที่สุด: **${sortedSlots[0][0]}** (จำนวน ${sortedSlots[0][1]} เคส)\n`;
      if (sortedSlots[1]) text += `- ช่วงเวลาหนาแน่นรองลงมา: **${sortedSlots[1][0]}** (จำนวน ${sortedSlots[1][1]} เคส)\n`;

      if (exactTimesList.length > 0 && exactTimesList.length <= 15) {
        text += `\n📌 **เวลาที่ลูกค้าแจ้งเข้ามาจริง (เวลาประเทศไทย):**\n`;
        exactTimesList.forEach((t, idx) => {
          text += `  ${idx + 1}. เวลา **${t.time} น.** - "${t.summary}"\n`;
        });
      }
    } else {
      text += `- ไม่พบรายการปัญหา "${targetCatNames || 'ที่ระบุ'}" ในช่วงเวลา${customLabel}ค่ะ\n`;
    }

    return {
      category_filtered: isCategoryFiltered,
      target_categories: targetCategories,
      matched_issues_count: issues.length,
      hourly_counts: hourlyCounts,
      exact_times_list: exactTimesList,
      peak_slot: sortedSlots[0] ? sortedSlots[0][0] : 'ไม่พบข้อมูล',
      hourly_summary_thai: text
    };
  } catch (err) {
    console.error('Error in getHourlyPeakAnalysis:', err);
    return { hourly_summary_thai: '⏰ ไม่พบสถิติช่วงเวลาเกิดปัญหาในระบบค่ะ' };
  }
}

/**
 * Daily Peak Analysis (หาประเด็นและวันที่มีปัญหาพุ่งสูงที่สุดในเดือน / วันไหนปัญหาเยอะสุด)
 * Grouping issues by date (Asia/Bangkok timezone) for a given month or period
 */
export async function getDailyPeakAnalysis(companyId, timeframeMode = 'this_month') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);
    
    let query = supabase
      .from('chats')
      .select('*, chat_issues(*)')
      .gte('created_at', startCutoff.toISOString())
      .lt('created_at', endCutoff.toISOString())
      .order('created_at', { ascending: true });

    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const customLabel = resolvedLabel || 'ประจำเดือนนี้ (สิงหาคม)';

    if (!chats || chats.length === 0) {
      return {
        formatted_thai: `📅 **สรุปสถิติลำดับวันที่มีปัญหา (${customLabel}):**\n\n- ไม่พบรายการปัญหาในระบบในช่วงเวลา${customLabel}ค่ะ`
      };
    }

    const catMap = {
      'deposit_withdrawal': 'ฝาก-ถอน',
      'login_issue': 'ปัญหาการเข้าสู่ระบบ',
      'access_blocked': 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย',
      'account_security': 'ความปลอดภัยของบัญชี',
      'api_error': 'ข้อผิดพลาดระบบ API',
      'device_compatibility': 'ปัญหาเบราว์เซอร์/อุปกรณ์',
      'feature_request': 'ขอเพิ่มฟีเจอร์',
      'feedback_complaint': 'ข้อเสนอแนะและร้องเรียน',
      'game_issue': 'ปัญหาการเล่นเกม',
      'interaction_lag': 'กดปุ่มแล้วไม่ตอบสนอง',
      'notification_issue': 'ปัญหาการแจ้งเตือน',
      'page_load_freeze': 'หน้าเว็บค้าง/โหลดช้า',
      'payment_gateway': 'ระบบการชำระเงิน/ธนาคาร',
      'performance_issue': 'ประสิทธิภาพระบบช้า',
      'promo_bonus': 'โปรโมชั่นและโบนัส',
      'registration': 'การสมัครสมาชิก',
      'ui_rendering_issue': 'การแสดงผลผิดเพี้ยน',
      'vip_privilege': 'สิทธิประโยชน์ระดับ VIP',
      'other': 'เรื่องอื่นๆ'
    };

    const dateGroups = {};
    const dateCatCounts = {};
    let totalIssuesCount = 0;

    chats.forEach(chat => {
      if (!chat.created_at) return;
      const dateObj = new Date(chat.created_at);
      const dateStr = dateObj.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric' });

      const issues = (chat.chat_issues && chat.chat_issues.length > 0) ? chat.chat_issues : [
        { category_id: chat.category_id || 'deposit_withdrawal' }
      ];

      issues.forEach(iss => {
        totalIssuesCount++;
        dateGroups[dateStr] = (dateGroups[dateStr] || 0) + 1;

        if (!dateCatCounts[dateStr]) dateCatCounts[dateStr] = {};
        const catKey = iss.category_id || chat.category_id || 'deposit_withdrawal';
        const cleanCat = catKey.includes(':') ? catKey.split(':')[1] : catKey;
        const catName = catMap[cleanCat] || cleanCat || 'เรื่องอื่นๆ';
        dateCatCounts[dateStr][catName] = (dateCatCounts[dateStr][catName] || 0) + 1;
      });
    });

    const sortedDates = Object.entries(dateGroups).sort((a, b) => b[1] - a[1]);

    let text = `📅 **รายงานวันที่มีปัญหาเยอะที่สุด (${customLabel}):**\n\n`;
    text += `รวมปัญหาที่เกิดขึ้นทั้งหมด: **${totalIssuesCount} กรณี** (จาก ${chats.length} แชต)\n\n`;

    if (sortedDates.length > 0) {
      const topDate = sortedDates[0];
      const topDateStr = topDate[0];
      const topDateCount = topDate[1];

      // Top categories for top date
      const topCatArr = Object.entries(dateCatCounts[topDateStr] || {}).sort((a, b) => b[1] - a[1]);
      const topCatSummary = topCatArr.slice(0, 2).map(([cName, cnt]) => `${cName} (${cnt} กรณี)`).join(' และ ');

      text += `🏆 **วันที่มีปัญหาพุ่งสูงที่สุด (Peak Day)**:\n👉 **${topDateStr}** (รวม **${topDateCount} กรณี**)\n`;
      if (topCatSummary) {
        text += `📌 **หมวดหมู่ปัญหาหลักของวันนั้น**: ${topCatSummary}\n`;
      }

      if (sortedDates[1]) {
        const secondDate = sortedDates[1];
        text += `\n🥈 **อันดับ 2**: **${secondDate[0]}** (รวม **${secondDate[1]} กรณี**)\n`;
      }
      if (sortedDates[2]) {
        const thirdDate = sortedDates[2];
        text += `🥉 **อันดับ 3**: **${thirdDate[0]}** (รวม **${thirdDate[1]} กรณี**)\n`;
      }
    }

    return {
      period_days: timeframeMode,
      total_issues_count: totalIssuesCount,
      top_peak_date: sortedDates[0] ? sortedDates[0][0] : null,
      top_peak_count: sortedDates[0] ? sortedDates[0][1] : 0,
      formatted_thai: text
    };
  } catch (err) {
    console.error('Error fetching daily peak analysis:', err.message);
    return {
      formatted_thai: 'ไม่สามารถดึงข้อมูลวันที่มีปัญหาพุ่งสูงได้ในขณะนี้'
    };
  }
}

/**
 * Calculate Existing vs New Customer Chat Volume Split Ratio (% ลูกค้าเก่าทักแชตซ้ำ)
 * @param {string} [companyId]
 * @param {number|string} [timeframeMode='today']
 */
export async function getExistingCustomerChatRatio(companyId, timeframeMode = 'today') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);

    let query = supabase
      .from('chats')
      .select('*, customers(*)')
      .gte('created_at', startCutoff.toISOString())
      .lt('created_at', endCutoff.toISOString())
      .order('created_at', { ascending: false });

    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const timeLabel = resolvedLabel || 'ในวันนี้';

    if (!chats || chats.length === 0) {
      return {
        formatted_summary_thai: `👥 **สัดส่วนแชตจากลูกค้าเก่า (${timeLabel}):**\n\n- ไม่พบรายการแชตที่ทักเข้ามาในระบบในช่วงเวลา${timeLabel}ค่ะ`
      };
    }

    let existingCount = 0;
    let newCount = 0;

    chats.forEach(chat => {
      if (!chat.created_at || !chat.customers || !chat.customers.created_at) {
        existingCount++; // Default fallback to existing if no registration timestamp
        return;
      }

      const chatDate = new Date(chat.created_at).toDateString();
      const regDate = new Date(chat.customers.created_at).toDateString();

      if (chatDate === regDate) {
        newCount++;
      } else {
        existingCount++;
      }
    });

    const totalChats = chats.length;
    const existingPct = ((existingCount / totalChats) * 100).toFixed(1);
    const newPct = ((newCount / totalChats) * 100).toFixed(1);

    let text = `👥 **สัดส่วนแชตจากลูกค้าเก่า (${timeLabel}):**\n\n`;
    text += `- **สัดส่วนแชตจากลูกค้าเก่า**: **${existingPct}%** (จำนวน **${existingCount} ครั้ง** จากแชตรวม ${totalChats} ครั้ง)\n`;
    text += `- **สัดส่วนแชตจากลูกค้าใหม่**: **${newPct}%** (จำนวน **${newCount} ครั้ง**)\n\n`;
    text += `💡 *หมายเหตุ: คำนวณจากลูกค้าที่สมัครสมาชิกก่อนหน้า${timeLabel} แล้วทักแชตกลับเข้ามาสอบถามในระบบค่ะ*`;

    return {
      period_days: timeframeMode,
      total_chats_count: totalChats,
      existing_chats_count: existingCount,
      existing_pct: existingPct,
      new_chats_count: newCount,
      new_pct: newPct,
      formatted_summary_thai: text
    };
  } catch (err) {
    console.error('Error fetching existing customer chat ratio:', err.message);
    return {
      formatted_summary_thai: 'ไม่สามารถคำนวณสัดส่วนแชตจากลูกค้าเก่าได้ในขณะนี้'
    };
  }
}

/**
 * Track Repeat Customer Issues across consecutive days (% ลูกค้าที่ทักมาเรื่องเดิมซ้ำ)
 * @param {string} [companyId]
 * @param {string} [timeframeMode='today']
 */
export async function getRepeatCustomerIssueTracker(companyId, timeframeMode = 'today') {
  try {
    const { startCutoff: todayStart, endCutoff: todayEnd, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);
    
    // Yesterday cutoff bounds
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);

    let query = supabase
      .from('chats')
      .select('id, customer_id, created_at, category_id, summary, customers(id, name, phone), chat_issues(category_id, summary, priority)')
      .gte('created_at', yesterdayStart.toISOString())
      .lt('created_at', todayEnd.toISOString())
      .order('created_at', { ascending: false });

    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const catTHMap = {
      'deposit_withdrawal': 'การฝาก-ถอนเงิน',
      'login_issue': 'ปัญหาการเข้าสู่ระบบ',
      'access_blocked': 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย',
      'account_security': 'ความปลอดภัยของบัญชี',
      'api_error': 'ข้อผิดพลาดระบบ API',
      'device_compatibility': 'ปัญหาเบราว์เซอร์/อุปกรณ์',
      'feature_request': 'ขอเพิ่มฟีเจอร์',
      'feedback_complaint': 'ข้อเสนอแนะและร้องเรียน',
      'game_issue': 'ปัญหาการเล่นเกม',
      'interaction_lag': 'กดปุ่มแล้วไม่ตอบสนอง',
      'notification_issue': 'ปัญหาการแจ้งเตือน',
      'page_load_freeze': 'หน้าเว็บค้าง/โหลดช้า',
      'payment_gateway': 'ระบบการชำระเงิน/ธนาคาร',
      'performance_issue': 'ประสิทธิภาพระบบช้า',
      'promo_bonus': 'โปรโมชั่นและโบนัส',
      'registration': 'การสมัครสมาชิก',
      'ui_rendering_issue': 'การแสดงผลผิดเพี้ยน',
      'vip_privilege': 'สิทธิประโยชน์ระดับ VIP',
      'other': 'เรื่องอื่นๆ'
    };

    const customerMap = {};
    (chats || []).forEach(chat => {
      const custId = chat.customer_id;
      if (!custId) return;
      if (!customerMap[custId]) customerMap[custId] = { today: [], yesterday: [] };

      const cDate = new Date(chat.created_at);
      if (cDate >= todayStart && cDate < todayEnd) {
        customerMap[custId].today.push(chat);
      } else if (cDate >= yesterdayStart && cDate < yesterdayEnd) {
        customerMap[custId].yesterday.push(chat);
      }
    });

    const repeatCases = [];
    for (const [custId, group] of Object.entries(customerMap)) {
      if (group.today.length > 0 && group.yesterday.length > 0) {
        group.today.forEach(tChat => {
          const tCat = tChat.category_id || tChat.chat_issues?.[0]?.category_id;
          const matchingYChat = group.yesterday.find(yChat => {
            const yCat = yChat.category_id || yChat.chat_issues?.[0]?.category_id;
            return tCat && yCat && tCat === yCat;
          });

          if (matchingYChat) {
            const custName = tChat.customers?.name || `ลูกค้า ID: ${custId.slice(0, 8)}`;
            const catName = catTHMap[tCat] || tCat || 'เรื่องเดิม';
            
            const tTimeStr = new Date(tChat.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
            const yTimeStr = new Date(matchingYChat.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';

            repeatCases.push({
              customer_name: custName,
              category_name: catName,
              today_time: tTimeStr,
              today_summary: tChat.summary || tChat.chat_issues?.[0]?.summary || '-',
              yesterday_time: yTimeStr,
              yesterday_summary: matchingYChat.summary || matchingYChat.chat_issues?.[0]?.summary || '-'
            });
          }
        });
      }
    }

    const timeLabel = resolvedLabel || 'ในวันนี้';
    let text = `🔄 **รายงานลูกค้าที่ทักซ้ำเรื่องเดิม (${timeLabel} vs เมื่อวานนี้):**\n\n`;

    if (repeatCases.length === 0) {
      text += `- ใน${timeLabel} **ไม่พบลูกค้าที่เคยทักแชตมาแจ้งเรื่องเดิมจากเมื่อวาน** เข้ามาในระบบค่ะ (0 ราย)`;
    } else {
      text += `📌 พบลูกค้าทักซ้ำเรื่องเดิมทั้งหมด: **${repeatCases.length} รายการ**\n\n`;
      repeatCases.forEach((item, idx) => {
        text += `${idx + 1}. 👤 **ลูกค้า ${item.customer_name}**\n`;
        text += `   - 🏷️ **หมวดปัญหา**: ${item.category_name}\n`;
        text += `   - 🕒 **เมื่อวาน (${item.yesterday_time})**: "${item.yesterday_summary}"\n`;
        text += `   - 🕒 **${timeLabel} (${item.today_time})**: "${item.today_summary}"\n\n`;
      });
    }

    return {
      period_days: timeframeMode,
      repeat_cases_count: repeatCases.length,
      repeat_cases: repeatCases,
      formatted_summary_thai: text
    };
  } catch (err) {
    console.error('Error fetching repeat customer issue tracker:', err.message);
    return {
      formatted_summary_thai: 'ไม่สามารถตรวจสอบข้อมูลลูกค้าที่ทักซ้ำเรื่องเดิมได้ในขณะนี้'
    };
  }
}

export async function getComparisonPeriodAnalytics(companyId, type = 'day_over_day') {
  try {
    let p1Label = 'วันนี้';
    let p2Label = 'เมื่อวาน';
    let p1Data, p2Data;

    if (type === 'day_over_day') {
      p1Label = 'วันนี้';
      p2Label = 'เมื่อวานนี้';
      p1Data = await getChatAnalytics(companyId, 'today');
      p2Data = await getChatAnalytics(companyId, 'yesterday');
    } else if (type === 'week_over_week') {
      p1Label = 'สัปดาห์นี้';
      p2Label = 'สัปดาห์ที่แล้ว';
      p1Data = await getChatAnalytics(companyId, 'this_week');
      p2Data = await getChatAnalytics(companyId, 'last_week');
    } else {
      p1Label = 'เดือนนี้ (สิงหาคม)';
      p2Label = 'เดือนที่แล้ว (กรกฎาคม)';
      p1Data = await getChatAnalytics(companyId, 'this_month');
      p2Data = await getChatAnalytics(companyId, 'last_month');
    }

    const p1Chats = p1Data.matched_chats_count || 0;
    const p2Chats = p2Data.matched_chats_count || 0;
    const p1Issues = p1Data.matched_issues_count || 0;
    const p2Issues = p2Data.matched_issues_count || 0;

    const diffIssues = p1Issues - p2Issues;
    const pct = p2Issues > 0 ? ((diffIssues / p2Issues) * 100).toFixed(1) : (p1Issues > 0 ? 100 : 0);

    let comparisonSummary = '';
    if (diffIssues > 0) {
      comparisonSummary = `👉 **สรุปเปรียบเทียบ:** ${p1Label}มีปัญหาเข้ามา**มากกว่า**${p2Label} **${Math.abs(diffIssues)} กรณี** (เพิ่มขึ้น ${Math.abs(pct)}%) ค่ะ`;
    } else if (diffIssues < 0) {
      comparisonSummary = `👉 **สรุปเปรียบเทียบ:** ${p2Label}มีปัญหาเข้ามา**มากกว่า**${p1Label} **${Math.abs(diffIssues)} กรณี** (${p1Label}ปัญหาน้อยลง ${Math.abs(pct)}%) ค่ะ`;
    } else {
      comparisonSummary = `👉 **สรุปเปรียบเทียบ:** ${p1Label}และ${p2Label} มีจำนวนปัญหาเท่ากันคือ **${p1Issues} กรณี** ค่ะ`;
    }

    let text = `📅 **เปรียบเทียบสถิติปัญหา (${p1Label} vs ${p2Label}):**\n\n`;
    text += `${comparisonSummary}\n\n`;
    text += `- **${p1Label}**: แชต ${p1Chats} ครั้ง (ปัญหารวม ${p1Issues} กรณี)\n`;
    text += `- **${p2Label}**: แชต ${p2Chats} ครั้ง (ปัญหารวม ${p2Issues} กรณี)\n`;
    text += `- **แนวโน้มความเปลี่ยนแปลง**: ${diffIssues < 0 ? '📉 ปัญหาน้อยลง' : diffIssues > 0 ? '📈 ปัญหาสูงขึ้น' : 'ทรงตัว'} (${diffIssues <= 0 ? 'ลดลง' : 'เพิ่มขึ้น'} ${Math.abs(pct)}%)\n\n`;
    
    if (p1Data.summary_thai_top_category) {
      text += `📌 **หมวดหมู่หลัก${p1Label}**: ${p1Data.summary_thai_top_category.replace('หมวดหมู่ปัญหาหลักที่พบมากที่สุดคือ ', '')}\n`;
    }
    if (p2Data.summary_thai_top_category) {
      text += `📌 **หมวดหมู่หลัก${p2Label}**: ${p2Data.summary_thai_top_category.replace('หมวดหมู่ปัญหาหลักที่พบมากที่สุดคือ ', '')}`;
    }

    return { comparison_summary_thai: text.trim() };
  } catch (err) {
    console.error('Error fetching comparison period analytics:', err.message);
    return { comparison_summary_thai: '📅 ไม่พบข้อมูลสถิติเปรียบเทียบย้อนหลังในระบบค่ะ' };
  }
}

/**
 * Keyword scanner helper supporting exact month boundaries & custom windows
 */
async function scanKeywordIssues(companyId, keywords = [], periodType = 'today') {
  try {
    const { startCutoff, endCutoff } = resolveDynamicTimeframe(periodType);
    
    let query = supabase.from('chats').select('id, conversation, created_at, chat_issues(summary, category_id, priority)');
    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const matchedChats = (chats || []).filter(c => {
      if (!c.created_at) return false;
      const cDate = new Date(c.created_at);
      if (cDate < startCutoff || cDate >= endCutoff) return false;

      const text = `${c.conversation || ''} ${(c.chat_issues || []).map(i => i.summary).join(' ')}`.toLowerCase();
      return keywords.some(k => text.includes(k.toLowerCase()));
    });

    return matchedChats;
  } catch (err) {
    console.error('Error scanning keyword issues:', err.message);
    return [];
  }
}

/**
 * Customer Praise & Compliments Analytics Engine
 * Scans chat messages for customer appreciation, praise, compliments, and positive feedback for admin services.
 * @param {string} [companyId]
 * @param {string} [timeframeMode='this_month']
 */
export async function getCustomerPraiseAnalytics(companyId, timeframeMode = 'this_month') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);

    let query = supabase
      .from('chats')
      .select('id, category_id, priority, created_at, summary, chat_issues(summary)');

    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const praiseKeywords = ['ชม', 'ชื่นชม', 'ประทับใจ', 'ขอบคุณ', 'น่ารัก', 'ดีมาก', 'บริการดี', 'รวดเร็ว', 'สุภาพ', 'ทันใจ'];

    const praiseChats = (chats || []).filter(c => {
      const issueSummaries = (c.chat_issues || []).map(i => i.summary || '').join(' ');
      const fullText = `${c.summary || ''} ${issueSummaries}`;
      return praiseKeywords.some(k => fullText.includes(k));
    });

    const labelText = resolvedLabel || 'ช่วงนี้';

    if (praiseChats.length === 0) {
      return {
        praise_summary_thai: `🟢 **รายงานคำชมเชยและการบริการของแอดมิน (${labelText}):**\n\n- ไม่พบรายการแชตที่ลูกค้าส่งคำชมเชยเข้ามาใน${labelText}ค่ะ`
      };
    }

    let text = `💖 **รายงานแชตที่ลูกค้าส่งคำชื่นชมการบริการของแอดมิน (${labelText}):**\n\n`;
    text += `📌 พบรายการแชตประทับใจและคำชมเชยรวม: **${praiseChats.length} รายการ**\n\n`;

    praiseChats.slice(0, 5).forEach((c, idx) => {
      let thTime = '';
      if (c.created_at) {
        try {
          const d = new Date(c.created_at);
          thTime = d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
        } catch (e) {}
      }
      const timeStr = thTime ? ` (เวลา **${thTime}**)` : '';
      
      const praiseIssue = (c.chat_issues || []).find(iss => praiseKeywords.some(k => (iss.summary || '').includes(k)));
      const snippet = praiseIssue ? praiseIssue.summary : (c.summary || 'ลูกค้าส่งคำชื่นชมและขอบคุณการดูแลของแอดมิน');

      text += `${idx + 1}. แชต \`${c.id}\`${timeStr} - "${snippet}"\n`;
    });

    text += `\n🌟 *แอดมินและทีมงานให้บริการอย่างดีเยี่ยม รวดเร็ว และเป็นกันเอง ทำให้ได้รับคำชื่นชมจากลูกค้าค่ะ* ✨`;

    return { praise_summary_thai: text };
  } catch (err) {
    return { praise_summary_thai: `- ไม่พบข้อมูลตามเงื่อนไขที่ค้นหาค่ะ` };
  }
}

/**
 * Custom Topic & Arbitrary Keyword Scan Engine (e.g. "เลขเด็ด", "หวย", "ห้องหวย")
 * Scans chat messages and issue summaries for specific non-standard topic queries.
 * @param {string} [companyId]
 * @param {string} [timeframeMode='today']
 * @param {string} [userQuery='']
 */
export async function getCustomTopicKeywordScan(companyId, timeframeMode = 'today', userQuery = '') {
  try {
    const { startCutoff, endCutoff, resolvedLabel } = resolveDynamicTimeframe(timeframeMode);

    const cleanText = (userQuery || '').toLowerCase();
    const extractedKeywords = [];

    if (cleanText.includes('หวย') || cleanText.includes('เลขเด็ด') || cleanText.includes('ห้องหวย')) {
      extractedKeywords.push('หวย', 'เลขเด็ด', 'ห้องหวย');
    }

    const keywords = extractedKeywords.length > 0 ? extractedKeywords : [cleanText.slice(0, 15)];

    let query = supabase
      .from('chats')
      .select('id, category_id, priority, created_at, chat_issues(summary, category_id)');

    if (companyId) query = query.eq('company_id', companyId);

    const { data: chats, error } = await query;
    if (error) throw error;

    const matchedChats = (chats || []).filter(c => {
      if (!c.created_at) return false;
      const cDate = new Date(c.created_at);
      if (cDate < startCutoff || cDate >= endCutoff) return false;

      const issueSummaries = (c.chat_issues || []).map(i => i.summary || '').join(' ');
      const fullText = `${c.id} ${c.category_id || ''} ${issueSummaries}`.toLowerCase();

      return keywords.some(k => fullText.includes(k));
    });

    const labelText = resolvedLabel || 'วันนี้';

    if (matchedChats.length === 0) {
      return {
        topic_scan_summary_thai: `- ไม่พบข้อมูลตามเงื่อนไขที่ค้นหาค่ะ`
      };
    }

    const topicLabel = keywords.join(', ');
    let text = `📌 **รายงานสถิติการทักเข้ามาสอบถามเรื่อง "${topicLabel}" (${labelText}):**\n\n`;
    text += `พบลูกค้าทักเข้ามาสอบถามทั้งหมด: **${matchedChats.length} รายการ**\n\n`;

    matchedChats.forEach((c, idx) => {
      let thTime = '';
      if (c.created_at) {
        try {
          const d = new Date(c.created_at);
          thTime = d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
        } catch (e) {}
      }
      const timeStr = thTime ? ` (เวลา **${thTime}**)` : '';
      const summaryText = c.chat_issues?.[0]?.summary || 'ทักเข้ามาสอบถามข้อมูล';
      text += `${idx + 1}. แชต \`${c.id}\`${timeStr} - "${summaryText}"\n`;
    });

    return { topic_scan_summary_thai: text };

  } catch (err) {
    return { topic_scan_summary_thai: `- ไม่พบข้อมูลตามเงื่อนไขที่ค้นหาค่ะ` };
  }
}

/**
 * Account Security & Freeze Complaint Scan ("ขู่อายัดบัญชี", "อายัด")
 */
export async function getAccountSecurityFreezeScan(companyId, periodType = 'today', periodLabel = 'วันนี้') {
  const matches = await scanKeywordIssues(companyId, ['อายัด', 'ขู่อายัด', 'อายัดบัญชี'], periodType);
  if (matches.length === 0) {
    return { scan_summary_thai: `- ใน${periodLabel}ไม่พบเคสแจ้งร้องเรียนหรือขู่อายัดบัญชีเข้ามาในระบบค่ะ (0 เคส)` };
  }
  let text = `🚨 **พบเคสแจ้งร้องเรียน/ขู่อายัดบัญชีใน${periodLabel} (${matches.length} เคส):**\n\n`;
  matches.forEach((c, idx) => {
    const timeStr = new Date(c.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });
    text += `${idx + 1}. แชต ${c.id} (เวลา ${timeStr} น.): ${(c.chat_issues?.[0]?.summary || c.conversation || '').slice(0, 80)}\n`;
  });
  return { scan_summary_thai: text };
}

/**
 * Birthday Bonus Inquiry Scan ("วันเกิด", "โบนัสวันเกิด")
 */
export async function getBirthdayBonusScan(companyId, periodType = 'today', periodLabel = 'วันนี้') {
  const matches = await scanKeywordIssues(companyId, ['วันเกิด', 'โบนัสวันเกิด'], periodType);
  if (matches.length === 0) {
    return { scan_summary_thai: `- ใน${periodLabel}ไม่มีลูกค้าทักเข้ามาสอบถามเรื่องโบนัสวันเกิดค่ะ (0 คน)` };
  }
  let text = `🎁 **พบลูกค้าทักสอบถามโบนัสวันเกิดใน${periodLabel} (${matches.length} คน):**\n\n`;
  matches.forEach((c, idx) => {
    const timeStr = new Date(c.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });
    text += `${idx + 1}. แชต ${c.id} (เวลา ${timeStr} น.): ${(c.chat_issues?.[0]?.summary || c.conversation || '').slice(0, 80)}\n`;
  });
  return { scan_summary_thai: text };
}
