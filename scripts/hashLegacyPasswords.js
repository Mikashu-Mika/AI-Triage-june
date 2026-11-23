/**
 * One-time migration: hash every user password that is still stored as plaintext.
 *
 *   node scripts/hashLegacyPasswords.js           # dry run, shows what would change
 *   node scripts/hashLegacyPasswords.js --apply   # writes the bcrypt hashes
 *
 * Safe to run again: passwords that are already bcrypt hashes are skipped.
 * Users keep their current password; only the stored form changes.
 * Never prints a password or a hash.
 */
import { supabase } from '../src/supabase.js';
import { hashPassword, isBcryptHash } from '../src/password.js';

const apply = process.argv.includes('--apply');

const { data: users, error } = await supabase.from('users').select('id, email, role, password');
if (error) throw new Error('Failed to read users: ' + error.message);

let hashed = 0;
let skipped = 0;
let empty = 0;
let failed = 0;

for (const u of users) {
  const stored = (u.password || '').trim();
  if (!stored) {
    empty++;
    console.log(`  ! ${u.email} (${u.role}): no password set, left unchanged`);
    continue;
  }
  if (isBcryptHash(stored)) {
    skipped++;
    continue;
  }
  if (!apply) {
    hashed++;
    console.log(`  - would hash ${u.email} (${u.role})`);
    continue;
  }
  const { error: updErr } = await supabase
    .from('users')
    .update({ password: await hashPassword(stored) })
    .eq('id', u.id)
    .eq('password', u.password); // skip if the password changed since we read it
  if (updErr) {
    failed++;
    console.error(`  x ${u.email}: ${updErr.message}`);
  } else {
    hashed++;
    console.log(`  + hashed ${u.email} (${u.role})`);
  }
}

console.log(
  `\n${apply ? 'Done' : 'Dry run'}: ${users.length} users, ` +
  `${hashed} ${apply ? 'hashed' : 'to hash'}, ${skipped} already hashed, ${empty} empty, ${failed} failed`
);
if (!apply && hashed > 0) console.log('Run again with --apply to write the changes.');
process.exitCode = failed > 0 ? 1 : 0;
