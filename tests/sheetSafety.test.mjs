import test from 'node:test';
import assert from 'node:assert/strict';
import { exactBookingRow, clearBookingRequests, clearBookingsSafely, inspectWorkbookErrors, writeBookingSafely } from '../src/sheetSafety.mjs';

const headers = ['Booking ID', 'Guest Name', 'Check-in', 'Gross value', 'Notes'];
const formula = '=IF(A2="","",40)';
const cell = value => ({ userEnteredValue: { stringValue: value }, formattedValue: value });
function fixture() {
  return { properties: { title: 'Bookings', sheetId: 42, sheetType: 'GRID', gridProperties: { rowCount: 600, columnCount: 52 } },
    headerIndex: 0, idColumn: 0,
    rows: [headers, ['MU-1','Same guest','8 Oct 2026','40','total party'], ['MU-2','Same guest']],
    cells: [headers.map(cell), [cell('MU-1'),cell('Same guest'),cell('8 Oct 2026'),{userEnteredValue:{formulaValue:formula}},cell('total party')], [cell('MU-2'),cell('Same guest')]] };
}
async function mockApi(grid, run, { failWrite = false, report = false } = {}) {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === 'POST') return { ok: !failWrite, status: failWrite ? 403 : 200, json: async () => failWrite ? {error:{message:'Permission denied'}} : {} };
    if (url.includes('includeGridData')) return {ok:true,status:200,json:async()=>({sheets:[{properties:grid.properties,data:[{rowData:grid.cells.map(values=>({values}))}]}]})};
    return {ok:true,status:200,json:async()=>({sheets:[{properties:grid.properties}]})};
  };
  try { await run(calls); } finally { globalThis.fetch = old; }
}
test('exact ID does not conflate punctuation, numbers or a returning guest', () => {
  const rows = [headers, ['MU-12','Same guest'], ['MU-1-2','Same guest']];
  assert.equal(exactBookingRow(rows,0,'MU-1-2'),3);
  assert.equal(exactBookingRow(rows,0,'OTHER-12'),-1);
  assert.equal(exactBookingRow(fixture().rows,0,'MU-1'),2);
});
test('duplicate IDs are rejected before a write', () => {
  assert.throws(()=>exactBookingRow([headers,['MU-1'],['MU-1']],0,'MU-1'),/Duplicate/);
});
test('clearing retains formulas and row addresses and wipes advanced columns', () => {
  const g=fixture();g.cells[1][51]=cell('old advanced data');
  const requests=clearBookingRequests(g,[2,2]);
  assert.equal(requests.length,1);
  assert.equal(requests[0].updateCells.range.startRowIndex,1);
  assert.equal(requests[0].updateCells.rows[0].values.length,52);
  assert.deepEqual(requests[0].updateCells.rows[0].values[0],{});
  assert.deepEqual(requests[0].updateCells.rows[0].values[51],{});
  assert.equal(requests[0].updateCells.rows[0].values[3].userEnteredValue.formulaValue,formula);
  assert.ok(!JSON.stringify(requests).includes('deleteDimension'));
  assert.throws(()=>clearBookingRequests(g,[1]),/Invalid/);
});
test('single, batch and clear-all use the same non-structural mutation', async () => {
  for(const ids of [['MU-1'],['MU-1','MU-2','MU-1'],null]) await mockApi(fixture(),async calls=>{
    const count=await clearBookingsSafely('sheet','Bookings',ids,'token');
    assert.equal(count,ids?.length===1?1:2);
    const writes=calls.filter(c=>c.body);
    assert.equal(writes.length,1);
    assert.ok(writes[0].body.requests.every(r=>r.updateCells && !r.deleteDimension));
  });
});
test('missing IDs are an idempotent no-op', async () => {
  await mockApi(fixture(),async calls=>{
    assert.equal(await clearBookingsSafely('sheet','Bookings',['not-found'],'token'),0);
    assert.equal(calls.filter(c=>c.body).length,0);
  });
});
test('missing tab never falls back to the first sheet', async () => {
  await mockApi(fixture(),async calls=>{
    await assert.rejects(()=>clearBookingsSafely('sheet','Wrong',null,'token'),/not found/);
    assert.equal(calls.filter(c=>c.body).length,0);
  });
});
test('report IDs cannot be cleared as input bookings', async () => {
  const g=fixture();g.cells[1][0]={userEnteredValue:{formulaValue:'=Bookings!A2'},formattedValue:'MU-1'};
  await mockApi(g,async calls=>{
    await assert.rejects(()=>clearBookingsSafely('sheet','Bookings',null,'token'),/calculated report/);
    assert.equal(calls.filter(c=>c.body).length,0);
  });
});
test('API write failures propagate', async () => {
  await mockApi(fixture(),async()=>{await assert.rejects(()=>clearBookingsSafely('sheet','Bookings',['MU-1'],'token'),/Permission denied/);},{failWrite:true});
});
test('scan includes row 550 beyond the previous 500-row cap', async () => {
  const g=fixture();g.rows[549]=['MU-550'];g.cells[549]=[cell('MU-550')];
  await mockApi(g,async calls=>{
    assert.equal(await clearBookingsSafely('sheet','Bookings',['MU-550'],'token'),1);
    assert.equal(calls.find(c=>c.body).body.requests[0].updateCells.range.startRowIndex,549);
  });
});
test('health check detects hidden broken references and does not mutate', async () => {
  const g=fixture();g.cells[1][3]={userEnteredValue:{formulaValue:'=IFERROR(#REF!,0)'},effectiveValue:{numberValue:0}};
  await mockApi(g,async calls=>{
    const result=await inspectWorkbookErrors('sheet','token');
    assert.equal(result.remainingErrors,1);assert.equal(result.fixedCount,0);
    assert.equal(calls.filter(c=>c.body).length,0);
  });
});
test('updates preserve formulas, write only changed cells and protect literal text', async () => {
  await mockApi(fixture(),async calls=>{
    await writeBookingSafely('sheet','Bookings',{id:'MU-1'},'token',(h,r,old)=>old.map((v,i)=>i===1?'=text':i===3?'999':v),false);
    const data=calls.find(c=>c.body).body.data;
    assert.equal(data.length,1);assert.equal(data[0].range,"'Bookings'!B2");assert.equal(data[0].values[0][0],"'=text");
  });
});
test('cleared formula-only row is reused before later occupied rows', async () => {
  const g=fixture();g.cells[1]=[{}, {}, {}, {userEnteredValue:{formulaValue:formula}}];
  await mockApi(g,async calls=>{
    await writeBookingSafely('sheet','Bookings',{id:'NEW'},'token',()=>['NEW','New guest','','40',''],true);
    assert.ok(calls.find(c=>c.body).body.data.every(d=>d.range.endsWith('2')));
  });
});
test('stale update never recreates a deleted booking', async () => {
  await mockApi(fixture(),async calls=>{
    await assert.rejects(()=>writeBookingSafely('sheet','Bookings',{id:'missing'},'token',()=>[],false),/no longer exists/);
    assert.equal(calls.filter(c=>c.body).length,0);
  });
});
