import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const block=name=>rules.match(new RegExp('match /'+name+' \\{([\\s\\S]*?)\\n    \\}'))?.[1]??'';
test('reservation documents are not publicly readable',()=>{
 const reservation=block('reservations/\\{reservationId\\}');
 assert.match(reservation,/allow get, list: if isPropertyManagerOrAdmin\(\)/);
 assert.doesNotMatch(reservation,/allow get, list: if true/);
});
test('signed-in users cannot assign privileged roles via their own profiles',()=>{
 const users=block('users/\\{userId\\}');
 assert.match(users,/incoming\(\)\.uid == userId/);
 assert.match(users,/incoming\(\)\.role == 'staff'/);
 assert.match(users,/incoming\(\)\.role == existing\(\)\.role/);
});
test('admin and manager authorization no longer trusts self-writable user profiles',()=>{
 const admin=rules.slice(rules.indexOf('function isDatabaseAdmin()'),rules.indexOf('function isAdmin()'));
 const manager=rules.slice(rules.indexOf('function isPropertyManager()'),rules.indexOf('function isPropertyManagerOrAdmin()'));
 assert.doesNotMatch(admin,/documents\/users\//);
 assert.doesNotMatch(manager,/documents\/users\//);
});
test('staff role directory is not listable by all authenticated accounts',()=>{
 const roles=block('user_roles/\\{email\\}');
 assert.match(roles,/allow list: if isAdmin\(\)/);
});
