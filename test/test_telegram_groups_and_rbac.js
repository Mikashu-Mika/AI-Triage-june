import assert from 'assert';
import { handleTelegramMessage } from '../src/telegramBot.js';
import { 
  getCompanyByTelegramChatId, 
  upsertTelegramGroup, 
  upsertTelegramMember, 
  getTelegramMemberRole,
  updateTelegramMemberRole,
  getTelegramGroups,
  getTelegramGroupMembers,
  supabase
} from '../src/supabase.js';

async function runTests() {
  console.log('🧪 Starting Telegram Group Mapping & Member RBAC Tests...\n');

  // Test 1: Helper functions error resilience when tables not yet populated
  console.log('▶️ Test 1: Testing helper function robustness with non-existent or unmapped group');
  const nonExistentCompany = await getCompanyByTelegramChatId('-9999999999');
  assert.strictEqual(nonExistentCompany, null, 'Unmapped group should return null');
  console.log('✅ Test 1 Passed: Unmapped group correctly returns null.');

  // Test 2: Unmapped Group Message (Choice A Enforcement)
  console.log('\n▶️ Test 2: Unmapped Group Message -> Choice A Response');
  const unmappedGroupMsg = {
    _dryRun: true,
    chat: { id: -8888777766, type: 'supergroup', title: 'Random New Group' },
    from: { id: 123456789, first_name: 'Somchai', last_name: 'Jaidee', username: 'somchai_j' },
    text: 'สรุปปัญหาในเดือนนี้หน่อยครับ'
  };

  const resUnmapped = await handleTelegramMessage(unmappedGroupMsg);
  assert.strictEqual(resUnmapped?.ok, false, 'Unmapped group should return ok: false');
  assert.strictEqual(resUnmapped?.error, 'Group unmapped to company', 'Should return Group unmapped error');
  console.log('✅ Test 2 Passed: Unmapped group triggered Choice A alert notice.');

  // Test 3: new_chat_members event handling (capturing contact_id & user info)
  console.log('\n▶️ Test 3: new_chat_members event handling');
  const joinEventMsg = {
    _dryRun: true,
    chat: { id: -5495142610, type: 'supergroup', title: 'Mika Co. VIP Support' },
    new_chat_members: [
      { id: 987654321, first_name: 'Anan', last_name: 'Panyarachun', username: 'anan_p', is_bot: false }
    ]
  };

  const resJoin = await handleTelegramMessage(joinEventMsg);
  assert.strictEqual(resJoin?.ok, true, 'Join event should succeed');
  assert.strictEqual(resJoin?.event, 'new_chat_members', 'Should identify as new_chat_members event');
  console.log('✅ Test 3 Passed: new_chat_members event successfully intercepted and captured.');

  // Test 4: Bot joining new group event
  console.log('\n▶️ Test 4: Bot added to new group event');
  const botJoinMsg = {
    _dryRun: true,
    chat: { id: -7777666655, type: 'supergroup', title: 'New Customer Support' },
    new_chat_members: [
      { id: 8365412791, first_name: 'Sift AI Bot', username: 'Mikashu_bot', is_bot: true }
    ]
  };

  const resBotJoin = await handleTelegramMessage(botJoinMsg);
  assert.strictEqual(resBotJoin?.ok, true, 'Bot join event should succeed');
  console.log('✅ Test 4 Passed: Bot join event handled and guidance sent.');

  // Test 5: RBAC - Non-executive member blocked from financial queries
  console.log('\n▶️ Test 5: RBAC - Non-executive member blocked from financial queries');
  const nonExecFinancialMsg = {
    _dryRun: true,
    chat: { id: -5495142610, type: 'supergroup', title: 'Mika Co. VIP Support' },
    from: { id: 99999999, first_name: 'Staff Member', last_name: 'One', username: 'staff1' },
    text: 'ขอยอดเงินฝากและยอดถอนเดือนนี้หน่อยครับ'
  };

  const resNonExecFinancial = await handleTelegramMessage(nonExecFinancialMsg);
  assert.strictEqual(resNonExecFinancial?.ok, false, 'Non-executive should be blocked');
  assert.strictEqual(resNonExecFinancial?.error, 'Restricted: Executive Only in Groups');
  console.log('✅ Test 5 Passed: Non-executive blocked from financial queries.');

  // Test 6: RBAC - Non-executive member blocked from general issue queries (Cannot ask anything in any case)
  console.log('\n▶️ Test 6: RBAC - Non-executive member blocked from general issue queries');
  const nonExecGeneralMsg = {
    _dryRun: true,
    chat: { id: -5495142610, type: 'supergroup', title: 'Mika Co. VIP Support' },
    from: { id: 99999999, first_name: 'Staff Member', last_name: 'One', username: 'staff1' },
    text: 'สรุปปัญหาในเดือนนี้หน่อยครับ'
  };

  const resNonExecGeneral = await handleTelegramMessage(nonExecGeneralMsg);
  assert.strictEqual(resNonExecGeneral?.ok, false, 'Non-executive member should not be allowed to ask anything');
  assert.strictEqual(resNonExecGeneral?.error, 'Restricted: Executive Only in Groups');
  console.log('✅ Test 6 Passed: Non-executive member blocked from general queries (Blocked in all cases).');

  // Test 7: RBAC - Executive allowed to query general issue stats
  console.log('\n▶️ Test 7: RBAC - Executive allowed to query general issue stats');
  const execGeneralMsg = {
    _dryRun: true,
    chat: { id: -5495142610, type: 'supergroup', title: 'Mika Co. VIP Support' },
    from: { id: 834472739, first_name: 'JUNE', last_name: '🐰', username: 'june_rabbit' },
    text: 'สรุปปัญหาในเดือนนี้หน่อยค่ะ'
  };

  const resExecGeneral = await handleTelegramMessage(execGeneralMsg);
  assert.strictEqual(resExecGeneral?.ok, true, 'Executive should be allowed');
  console.log('✅ Test 7 Passed: Executive allowed to query general issue stats.');

  // Test 8: RBAC - Executive asking sensitive financial question (Allowed)
  console.log('\n▶️ Test 8: RBAC - Executive allowed to query sensitive financial data');
  const execFinancialMsg = {
    _dryRun: true,
    chat: { id: -5495142610, type: 'supergroup', title: 'Mika Co. VIP Support' },
    from: { id: 834472739, first_name: 'JUNE', last_name: '🐰', username: 'june_rabbit' },
    text: 'สรุปยอดเงินและปัญหาของเดือนนี้ให้หน่อย'
  };

  const resExecFinancial = await handleTelegramMessage(execFinancialMsg);
  assert.strictEqual(resExecFinancial?.ok, true, 'Executive should be allowed');
  // Cleanup test artifacts from DB so table remains 100% clean
  console.log('\n🧹 Cleaning up test artifacts from database...');
  await supabase.from('telegram_group_members').delete().in('telegram_user_id', ['123456789', '987654321', '99999999']);
  await supabase.from('telegram_groups').delete().in('chat_id', ['-8888777766', '-7777666655']);
  console.log('✅ Test database cleaned up successfully.');

  console.log('\n🎉 ALL 8 TESTS PASSED SUCCESSFULLY! 🚀');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
