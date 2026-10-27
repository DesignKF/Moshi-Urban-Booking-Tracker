import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,csvBookings,firestoreBookings,audit} from '../scripts/migration-audit.mjs';

test('CSV handles BOM, quoted commas, newlines and escaped quotes',()=>{
 const rows=parseCsv('\uFEFFid,name\r\nMU-1,"A, ""Guest""\nName"\r\n');
 assert.deepEqual(rows,[['id','name'],['MU-1','A, "Guest"\nName']]);
});
test('CSV import identifies header below introductory rows',()=>{
 const r=csvBookings('Hostel Bookings\nBooking ID,Guest Name,Check-in,Check-out,Currency\nMU-1,Jane,2026-10-01,2026-10-03,TZS\n');
 assert.equal(r.length,1);
 assert.equal(r[0].checkIn,'2026-10-01');
 assert.equal(r[0].currency,'TZS');
});
test('CSV refuses unknown booking table',()=>assert.throws(()=>csvBookings('A,B\nC,D'),/headers/));
test('Firestore importer accepts direct arrays and data wrappers',()=>{
 assert.equal(firestoreBookings('[{"id":"MU-1","guestName":"One","unitId":"N-B1L"}]')[0].bedCode,'N-B1L');
 assert.equal(firestoreBookings('{"documents":[{"data":{"id":"MU-2"}}]}')[0].id,'MU-2');
 assert.throws(()=>firestoreBookings('{"wrong":[]}'),/array/);
});
test('reconciliation is deterministic and identifies duplicates, omissions and mismatches',()=>{
 const a=[{id:'B',guestName:'Jane',totalAmount:'1,000',currency:'USD'},{id:'A',guestName:'Amy'},
          {id:'B',guestName:'Jane duplicate'},{id:'',guestName:'Missing'}];
 const b=[{id:'C',guestName:'Cara'},{id:'B',guestName:'Jane',totalAmount:'1000',currency:'TZS'}];
 const report=audit(a,b);
 assert.deepEqual(report.onlyInSheet,['A']);
 assert.deepEqual(report.onlyInFirestore,['C']);
 assert.deepEqual(report.sheet.duplicateIds,['B']);
 assert.equal(report.sheet.missingIds,1);
 assert.deepEqual(report.mismatches,[{id:'B',fields:['currency']}]);
 assert.deepEqual(audit(a,b),report);
});
test('comparison never changes input records',()=>{
 const a=[{id:'Z',guestName:'Guest'}],b=[];
 const before=JSON.stringify(a);
 audit(a,b);
 assert.equal(JSON.stringify(a),before);
});
