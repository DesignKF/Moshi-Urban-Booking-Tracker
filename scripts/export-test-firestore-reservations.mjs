// Extract only reservations from an isolated temporary Firestore database.
// Never import this module into the browser. It requires a separately installed firebase-admin package.
// A read-only IAM identity is required. This script does not write to Firestore.
import {writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

export const BLOCKED_PROJECTS=new Set(['gen-lang-client-0837479015']);
export const BLOCKED_DATABASES=new Set(['ai-studio-moshiurbanhostel-566fa31d-f9a6-45cd-a21f-d1b89541acb3']);
export function verifyTarget({project,database,output}){
  if(!project||!database||!output)throw new Error('Provide --project, --database and --output explicitly');
  if(BLOCKED_PROJECTS.has(project)||BLOCKED_DATABASES.has(database))throw new Error('Refusing to connect to the known live project or database');
  if(!/^(moshi-urban-migration|moshi-urban-audit)[a-z0-9-]*$/.test(project))throw new Error('Project must be a designated, isolated moshi-urban-migration* or moshi-urban-audit* project');
  if(!/^[-a-z0-9()]{1,63}$/.test(database))throw new Error('Invalid database ID');
  const path=resolve(output);
  if(existsSync(path))throw new Error('Refusing to overwrite an existing export');
  if(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT!==project)throw new Error('GOOGLE_CLOUD_PROJECT disagrees with explicit project');
  return path;
}
export function encodeFirestore(value){
  if(value===null||value===undefined)return value??null;
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(encodeFirestore);
  if(value && typeof value.toDate==='function')return value.toDate().toISOString();
  if(value && typeof value==='object'){
    if(typeof value.path==='string' && typeof value.id==='string')return value.path;
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeFirestore(v)]));
  }
  return value;
}
export function toReservation(doc){
  const data=encodeFirestore(doc.data());
  if(!data || typeof data!=='object'||Array.isArray(data))throw new Error('Malformed reservation document');
  if(data.id && data.id!==doc.id)throw new Error('Booking document ID differs from reservation ID: '+doc.id);
  return { ...data,id:doc.id };
}
export function parseArgs(args){
  const options={};
  for(let i=0;i<args.length;i+=2){
    const key=args[i];
    if(!['--project','--database','--output'].includes(key)||i+1>=args.length||options[key.slice(2)])throw new Error('Usage: --project moshi-urban-migration-... --database "(default)" --output /private/reservations.json');
    options[key.slice(2)]=args[i+1];
  }
  return options;
}
async function main(){
  const {project,database,output}=parseArgs(process.argv.slice(2));
  const path=verifyTarget({project,database,output});
  const require=createRequire(import.meta.url);
  let admin;
  try{admin=require('firebase-admin');}
  catch{throw new Error('firebase-admin is required in an isolated operator environment; do not install credentials or service account files in GitHub');}
  const app=admin.initializeApp({projectId:project});
  try{
    const db=admin.firestore.getFirestore(app,database);
    const snapshot=await db.collection('reservations').get();
    const records=snapshot.docs.map(toReservation).sort((a,b)=>a.id.localeCompare(b.id));
    // Exclusive create: refuses to overwrite an existing file.
    writeFileSync(path,JSON.stringify(records,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
    console.log(JSON.stringify({exported:records.length,output:path,project,database,collection:'reservations'}));
  }finally{await app.delete();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(error=>{console.error('Export failed:',error.message);process.exitCode=1;});
}
