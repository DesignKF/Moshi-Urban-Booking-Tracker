// Offline, read-only migration inventory. No Firebase or Google API calls.
// Usage: node scripts/migration-audit.mjs --sheet path/to/sheet.csv --firestore path/to/firestore.json
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const normalizeKey = v => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
export const columns = {
  id: ['bookingid', 'reservationid', 'bookingno', 'bookingnumber', 'ref', 'id'],
  guestName: ['guestname', 'guest', 'name'],
  guestId: ['guestid', 'gid', 'customerid'],
  checkIn: ['checkin', 'checkindate', 'arrival', 'arrivaldate'],
  checkOut: ['checkout', 'checkoutdate', 'departure', 'departuredate'],
  room: ['room', 'roomselection', 'selectroom'],
  bedCode: ['bedcode', 'bedselection', 'selectbed', 'unitid', 'bed'],
  status: ['status', 'state', 'bookingstatus'],
  totalAmount: ['totalamount', 'total', 'grossvalue', 'bookingtotal'],
  paidAmount: ['paidamount', 'paid', 'amountpaid'],
  depositReceived: ['depositreceived'],
  otherReceived: ['otherreceived'],
  refundsPaid: ['refundspaid'],
  balanceDue: ['balancedue', 'balance', 'outstanding'],
  currency: ['currency', 'curr'],
  email: ['email', 'emailaddress', 'mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'whatsapp'],
};
export function parseCsv(text) {
  const rows=[]; let row=[],field='',quoted=false;
  text=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else if(ch==='"'){if(field)throw new Error('Unexpected CSV quote');quoted=true;}
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';}
    else if(ch==='\r' && text[i+1]==='\n'){}
    else field+=ch;
  }
  if(quoted)throw new Error('Unclosed CSV quoted field');
  if(field!=='' || row.length){row.push(field);rows.push(row);}
  return rows;
}
const monthIndex = Object.fromEntries(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map((v,i)=>[v,i+1]));
export function normalizeDate(raw){
  const text=String(raw??'').trim();
  if(!text)return '';
  const iso=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const named=text.match(/^(\d{1,2})[ /-]([A-Za-z]{3,9})[ ,/-]+(\d{4})$/);
  let y,m,d;
  if(iso){[,y,m,d]=iso; y=Number(y);m=Number(m);d=Number(d);}
  else if(named){d=Number(named[1]);m=monthIndex[named[2].slice(0,3).toLowerCase()];y=Number(named[3]);}
  else return text;
  if(!m||!d||y<1900||y>2200)return text;
  const check=new Date(Date.UTC(y,m-1,d));
  if(check.getUTCFullYear()!==y||check.getUTCMonth()+1!==m||check.getUTCDate()!==d)return text;
  return [y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
}
const money=v=>{
  const s=String(v??'').trim().replace(/,/g,'');
  return s!==''&&Number.isFinite(Number(s))?Number(s):null;
};
export function csvBookings(text){
  const rows=parseCsv(text);
  const headerIndex=rows.findIndex(r=>{
    const keys=r.map(normalizeKey);
    return columns.id.some(k=>keys.includes(k)) && columns.guestName.some(k=>keys.includes(k));
  });
  if(headerIndex<0)throw new Error('Could not identify booking ID and guest name headers; verify correct input tab');
  const head=rows[headerIndex].map(normalizeKey);
  const find=field=>head.findIndex(h=>columns[field].includes(h));
  const ix=Object.fromEntries(Object.keys(columns).map(k=>[k,find(k)]));
  return rows.slice(headerIndex+1).filter(r=>r.some(v=>String(v??'').trim())).map(r=>{
    const record=Object.fromEntries(Object.keys(columns).map(k=>[k,ix[k]<0?'':String(r[ix[k]]??'').trim()]));
    record.checkIn=normalizeDate(record.checkIn);
    record.checkOut=normalizeDate(record.checkOut);
    // The sheet records deposits, additional payments and refunds separately.
    // Do not silently infer paidAmount if those source columns are incomplete.
    if(ix.paidAmount<0 && ix.depositReceived>=0 && ix.otherReceived>=0 && ix.refundsPaid>=0){
      const values=[record.depositReceived,record.otherReceived,record.refundsPaid].map(v=>v===''?0:money(v));
      record.paidAmount=values.some(v=>v===null)?'':String(values[0]+values[1]-values[2]);
    }
    return record;
  });
}
export function firestoreBookings(text){
  const parsed=JSON.parse(text);
  const list=Array.isArray(parsed)?parsed:Array.isArray(parsed.documents)?parsed.documents:null;
  if(!list)throw new Error('Firestore JSON must be an array of reservation objects or {documents:[...]}');
  return list.map(item=>{
    if(!item || typeof item!=='object')throw new Error('Invalid Firestore record');
    // Accept simple exported data objects, not Firestore REST typed-value exports.
    const obj=item.data && typeof item.data==='object'?item.data:item;
    return Object.fromEntries(Object.keys(columns).map(k=>[k,String(obj[k]??(k==='bedCode'?obj.unitId:'')??'').trim()]));
  });
}
const comparable=['guestName','guestId','checkIn','checkOut','room','bedCode','status','totalAmount','paidAmount','balanceDue','currency','email','phone'];
const norm=(value,field)=>{
  const s=String(value??'').trim();
  if(field==='checkIn'||field==='checkOut')return normalizeDate(s);
  return ['totalAmount','paidAmount','balanceDue'].includes(field)&&money(s)!==null?String(money(s)):s.toLowerCase();
};
export function audit(sheet,firestore){
  const index=records=>{
    const map=new Map(),duplicates=[]; let missingId=0;
    for(const r of records){
      const id=String(r.id??'').trim();
      if(!id){missingId++;continue;}
      if(map.has(id))duplicates.push(id);
      else map.set(id,r);
    }
    return {map,duplicates:[...new Set(duplicates)].sort(),missingId};
  };
  const a=index(sheet),b=index(firestore),onlySheet=[],onlyFirestore=[],different=[];
  const validate=(records)=>{
    const problems=[];
    for(let i=0;i<records.length;i++){
      const r=records[i],fields=[];
      for(const key of ['checkIn','checkOut']){
        const raw=String(r[key]??'').trim();
        if(raw && !/^\\d{4}-\\d{2}-\\d{2}$/.test(normalizeDate(raw)))fields.push(key+' (unrecognized date)');
      }
      const start=normalizeDate(r.checkIn),end=normalizeDate(r.checkOut);
      if(/^\\d{4}-\\d{2}-\\d{2}$/.test(start)&&/^\\d{4}-\\d{2}-\\d{2}$/.test(end)&&end<=start)fields.push('date range');
      for(const key of ['totalAmount','paidAmount','balanceDue']){
        const raw=String(r[key]??'').trim();
        if(raw && money(raw)===null)fields.push(key+' (invalid amount)');
      }
      if(fields.length)problems.push({row:i+1,id:String(r.id??'').trim(),fields});
    }
    return problems;
  };
  for(const [id,s] of a.map){
    if(!b.map.has(id)){onlySheet.push(id);continue;}
    const f=b.map.get(id);
    const fields=comparable.filter(k=>norm(s[k],k)!==norm(f[k],k) && String(s[k]??'').trim()!=='' && String(f[k]??'').trim()!=='');
    if(fields.length)different.push({id,fields});
  }
  for(const id of b.map.keys())if(!a.map.has(id))onlyFirestore.push(id);
  const order=(x,y)=>x.localeCompare(y);
  return {
    sheet:{rows:sheet.length,uniqueIds:a.map.size,missingIds:a.missingId,duplicateIds:a.duplicates},
    firestore:{rows:firestore.length,uniqueIds:b.map.size,missingIds:b.missingId,duplicateIds:b.duplicates},
    onlyInSheet:onlySheet.sort(order),onlyInFirestore:onlyFirestore.sort(order),
    mismatches:different.sort((x,y)=>order(x.id,y.id)),
    validation:{sheet:validate(sheet),firestore:validate(firestore)},
    missingValues:[...a.map].filter(([id,s])=>b.map.has(id)).map(([id,s])=>{
      const f=b.map.get(id);
      return {id,fields:comparable.filter(k=>(String(s[k]??'').trim()==='') !== (String(f[k]??'').trim()===''))};
    }).filter(x=>x.fields.length).sort((x,y)=>order(x.id,y.id)),
    // Unmatched fields are not assumed equal: missing values require manual review.
    notice:'Differences compare nonempty values only; unmatched columns, formatting, historical versions and business conflicts require manual review. No data was changed.'
  };
}
function main(){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--sheet'||args[2]!=='--firestore')throw new Error('Usage: node scripts/migration-audit.mjs --sheet export.csv --firestore reservations.json');
  const sheet=csvBookings(readFileSync(resolve(args[1]),'utf8'));
  const firestore=firestoreBookings(readFileSync(resolve(args[3]),'utf8'));
  const report=audit(sheet,firestore);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  // Differences do not imply errors: report for manual review without blocking inspection.
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{main();}catch(err){console.error('Audit failed:',err.message);process.exitCode=1;}
}
