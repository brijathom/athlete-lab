import {addDays,dateKey,uid,validateSession,type AppData,type Programme,type Session} from './domain'
import {validateBackupData} from './backup'
import {object,text,list,choice,id,fail,date,type RecordValue} from './validation'
import {contentFingerprint} from './content-fingerprint'
import {isCompleted,weeklyOccurrences} from './training-activities'
import {same} from './sync-domain'
import {skillSchema} from './programme-proposals'
export interface ProgrammePreview {title:string;key:string;fingerprint:string;baseline:AppData;candidate:AppData;changes:{before:Session|null;after:Session}[];programme:Programme;alreadyApplied:boolean}
const string={type:'string'},calendarDate={type:'string',format:'date'}
const scheduleSchema={type:'object',additionalProperties:false,required:['startTime','timeZone','team','location','type','opponent','competition','attendance'],properties:{startTime:string,timeZone:string,team:string,location:string,type:string,opponent:string,competition:string,attendance:{enum:['Expected','Unavailable','Undecided']}}}
const exerciseSchema={type:'object',additionalProperties:false,required:['name','sets','prescription'],properties:{name:string,sets:{type:'integer',minimum:1,maximum:20},prescription:string,rest:string,notes:string,measurement:{enum:['reps','distance','duration']},skill:skillSchema}}
export const sessionExchangeSchema={type:'object',additionalProperties:false,required:['title','date','category','minutes','exercises'],properties:{title:string,date:calendarDate,category:{enum:['Strength','Power','Speed','Conditioning','Skills','Tactical','Recovery','Team','Match','Testing','Rest']},minutes:{type:'integer',minimum:0,maximum:600},notes:string,focus:{type:'array',items:string},schedule:scheduleSchema,exercises:{type:'array',maxItems:30,items:exerciseSchema}}}
export const programmeExchangeSchema={type:'object',additionalProperties:false,required:['format','version','idempotencyKey','title','changes'],properties:{format:{const:'athlete-lab-programme'},version:{const:1},idempotencyKey:{type:'string',minLength:8,maxLength:100,pattern:'^[A-Za-z0-9_-]{8,100}$'},title:{type:'string',maxLength:100},programme:{type:'object',additionalProperties:false,required:['name','description'],properties:{id:string,expectedFingerprint:string,name:string,description:string,startDate:calendarDate,endDate:calendarDate}},changes:{type:'array',minItems:1,maxItems:180,items:{type:'object',additionalProperties:false,required:['operation'],description:'add: session; update: targetId, expectedFingerprint, session; reschedule: targetId, expectedFingerprint, date. repeatUntil is allowed only on new team training.',properties:{operation:{enum:['add','update','reschedule']},targetId:string,expectedFingerprint:string,date:calendarDate,repeatUntil:calendarDate,session:sessionExchangeSchema}}}}}
export function prepareProgrammeChanges(value:unknown,data:AppData,today=dateKey(),allowNotes=true):ProgrammePreview{
 const p=object(value,'Programme import',['format','version','idempotencyKey','title','changes'],['programme'])
 if(p.format!=='athlete-lab-programme'||p.version!==1)fail('Programme import','choose an Athlete Lab programme JSON version 1.')
 text(p.idempotencyKey,'Import key',100,true);if(!/^[\w-]{8,100}$/.test(p.idempotencyKey as string))fail('Import key','use 8–100 letters, digits, underscores or hyphens.');text(p.title,'Import title',100,true)
 const fingerprint=contentFingerprint(value),receipt=data.imports?.find(r=>r.key===p.idempotencyKey)
 if(receipt&&receipt.fingerprint!==fingerprint)fail('Import key','this key was already used for different changes. Use the original file or a new key.')
 if(receipt)return{title:p.title as string,key:p.idempotencyKey as string,fingerprint,baseline:structuredClone(data),candidate:structuredClone(data),changes:[],programme:data.programmes.find(p=>p.id===data.activeProgrammeId)!,alreadyApplied:true}
 let programme=data.programmes.find(p=>p.id===data.activeProgrammeId)!,programmes=data.programmes
 if(p.programme!==undefined){const q=object(p.programme,'Training block',['name','description'],['id','expectedFingerprint','startDate','endDate']);text(q.name,'Programme name',100,true);text(q.description,'Programme description',500);if(q.id!==undefined){id(q.id,'Programme identifier');const old=data.programmes.find(p=>p.id===q.id);if(!old||q.expectedFingerprint!==contentFingerprint(old))fail('Programme','the block changed or is unavailable. Export fresh context.');programme={...old!,name:q.name as string,description:allowNotes?q.description as string:old!.description}}else programme={id:uid(),name:q.name as string,description:q.description as string};for(const k of ['startDate','endDate'] as const)if(q[k]!==undefined){date(q[k],`Programme.${k}`);programme[k]=q[k] as string};programmes=[...data.programmes.filter(p=>p.id!==programme.id),programme]}
 const changes:ProgrammePreview['changes']=[],seen=new Set<string>()
 const existingKey=(s:Session)=>contentFingerprint([s.programmeId,s.date,s.title.trim().toLowerCase(),s.category,s.schedule?.startTime||''])
 const keys=new Set(data.sessions.filter(s=>s.status!=='cancelled').map(existingKey))
 for(const [i,v]of list(p.changes,'Programme changes',180).entries()){
  const a=object(v,`Change ${i+1}`,['operation'],['targetId','expectedFingerprint','session','date','repeatUntil']);choice(a.operation,`Change ${i+1}.operation`,['add','update','reschedule'])
  const before=a.operation==='add'?null:data.sessions.find(s=>s.id===a.targetId)
  if(a.operation!=='add'&&(!before||isCompleted(data,before.id)||before.date<today||a.expectedFingerprint!==contentFingerprint(before)))fail(`Change ${i+1}`,'the target is completed, historical, stale or unavailable. Export fresh context before updating it.')
  if(before&&seen.has(before.id))fail('Programme changes','the same session is changed more than once.')
  if(before)seen.add(before.id)
  let after:Session
  if(a.operation==='reschedule'){date(a.date,'Rescheduled date');after={...before!,date:a.date as string,...(before!.recurrence?{recurrence:{...before!.recurrence,exception:true}}:{})}}
  else{
   const s=object(a.session,`Change ${i+1}.session`,['title','date','category','minutes','exercises'],['notes','focus','schedule'])
   const exercises=list(s.exercises,'Exercises',30).map((v,j)=>{const e=object(v,`Exercise ${j+1}`,['name','sets','prescription'],['rest','notes','skill','measurement']);return{...e,id:uid(),rest:e.rest??'',notes:e.notes??''}})
   after={...s,id:before?.id||uid(),programmeId:before?.programmeId||programme.id,exercises,notes:s.notes??'',proposed:false,...(before?.recurrence?{recurrence:{...before.recurrence,exception:true}}:{})} as unknown as Session
  }
  if(before&&!allowNotes)after={...after,notes:before.notes,exercises:after.exercises.map(e=>({...e,notes:before.exercises.find(old=>old.name===e.name)?.notes||e.notes}))}
  const problem=validateSession(after);if(problem)fail(`Change ${i+1}`,problem)
  if(after.date<today||after.date>addDays(today,366))fail('Programme dates','plan training from today up to one year ahead.')
  const occurrences=a.repeatUntil!==undefined?(after.category==='Team'&&a.operation==='add'?weeklyOccurrences(after,String(a.repeatUntil)):fail('Recurrence','only new team sessions can repeat weekly.')):[after]
  for(const s of occurrences){const key=existingKey(s);if(!before&&keys.has(key)&&!receipt)fail('Duplicate activity',`${s.title} is already scheduled on ${s.date}.`);keys.add(key);changes.push({before:before||null,after:s})}
 }
 if(!changes.length||changes.length>180)fail('Programme changes','include between 1 and 180 activities, including recurrence.')
 if(receipt)return{title:p.title as string,key:p.idempotencyKey as string,fingerprint,baseline:structuredClone(data),candidate:structuredClone(data),changes:[],programme,alreadyApplied:true}
 const ids=new Set(changes.map(c=>c.after.id)),candidate=validateBackupData({...data,programmes,activeProgrammeId:p.programme?programme.id:data.activeProgrammeId,sessions:[...data.sessions.filter(s=>!ids.has(s.id)),...changes.map(c=>c.after)],imports:[...(data.imports||[]),{key:p.idempotencyKey,fingerprint,at:new Date().toISOString()}]})
 return{title:p.title as string,key:p.idempotencyKey as string,fingerprint,baseline:structuredClone(data),candidate,changes,programme,alreadyApplied:false}
}
export function approveProgrammeChanges(data:AppData,preview:ProgrammePreview,confirmed:boolean):AppData{
 if(!confirmed)throw new Error('Review the programme and explicitly approve saving it.')
 if(preview.alreadyApplied)throw new Error('This programme import has already been saved.')
 if(!same(data,preview.baseline))throw new Error('Your records changed after the preview. Validate the programme again before approving.')
 return validateBackupData(preview.candidate)
}
