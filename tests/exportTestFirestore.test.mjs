import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTarget,parseArgs,toReservation,encodeFirestore} from '../scripts/export-test-firestore-reservations.mjs';

test('known production project and named database are blocked',()=>{
 assert.throws(()=>verifyTarget({project:'gen-lang-client-0837479015',database:'(default)',output:'private.json'}),/Refusing/);
 assert.throws(()=>verifyTarget({project:'moshi-urban-migration-test',database:'ai-studio-moshiurbanhostel-566fa31d-f9a6-45cd-a21f-d1b89541acb3',output:'private.json'}),/Refusing/);
});
test('unapproved projects and missing targets are rejected',()=>{
 assert.throws(()=>verifyTarget({project:'random-project',database:'(default)',output:'private.json'}),/designated/);
 assert.throws(()=>verifyTarget({project:'moshi-urban-migration-test',database:'(default)'}),/Provide/);
});
test('operator options are explicit and deterministic',()=>{
 assert.deepEqual(parseArgs(['--project','moshi-urban-migration-test','--database','(default)','--output','private.json']),
 {project:'moshi-urban-migration-test',database:'(default)',output:'private.json'});
 assert.throws(()=>parseArgs(['--oops','x']),/Usage/);
});
test('export document ID is authoritative and mismatch is refused',()=>{
 assert.deepEqual(toReservation({id:'MU-1',data:()=>({guestName:'Example Guest'})}),{id:'MU-1',guestName:'Example Guest'});
 assert.throws(()=>toReservation({id:'MU-1',data:()=>({id:'MU-2'})}),/differs/);
});
test('timestamp-like objects are converted without timezone guessing',()=>{
 assert.deepEqual(encodeFirestore({when:{toDate:()=>new Date('2026-10-01T00:00:00.000Z')}}),{when:'2026-10-01T00:00:00.000Z'});
});
