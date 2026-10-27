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

test('Moshi Urban Bookings row 6 fields normalize dates and net payments',()=>{
 const csv=[
   'MOSHI URBAN HOSTEL',
   'Booking ID,Guest Name,Phone Number,Email,Guest ID,Platform,Check-in,Check-out,Room Selection,Bed Selection,Status,Currency,Gross value,Balance due,Deposit received,Other received,Refunds paid',
   'MU-101,Example Guest,123,email@example.invalid,G-101,Direct,05 Oct 2026,12 Oct 2026,Njoro,N-B1L,Confirmed,USD,140,90,35,20,5'
 ].join('\n');
 const rows=csvBookings(csv);
 assert.equal(rows.length,1);
 assert.equal(rows[0].checkIn,'2026-10-05');
 assert.equal(rows[0].checkOut,'2026-10-12');
 assert.equal(rows[0].totalAmount,'140');
 assert.equal(rows[0].paidAmount,'50');
 assert.deepEqual(audit(rows,[{...rows[0],checkIn:'2026-10-05',checkOut:'2026-10-12'}]).mismatches,[]);
});
test('reported missing columns are not silently considered matching',()=>{
 const result=audit([{id:'MU-1',guestName:'Example',currency:'USD'}],[{id:'MU-1',guestName:'Example',currency:''}]);
 assert.deepEqual(result.missingValues,[{id:'MU-1',fields:['currency']}]);
});
