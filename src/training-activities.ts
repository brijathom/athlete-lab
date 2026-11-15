import {addDays,dateKey,uid,validateSession,type AppData,type Session,type Schedule} from './domain'
export type EditScope='one'|'future'
export const eventCategories=['Team','Match','Rest'] as const
export const blankSchedule=():Schedule=>({startTime:'',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,team:'',location:'',type:'',opponent:'',competition:'',attendance:'Expected'})
export function isCompleted(data:AppData,id:string){return data.logs.some(l=>l.sessionId===id)||data.performance.matches.some(m=>m.fixtureId===id)}
export function sessionStatus(data:AppData,s:Session){const log=data.logs.find(l=>l.sessionId===s.id);return log?.team&&!log.team.attended?'Missed':isCompleted(data,s.id)?'Completed':s.status==='cancelled'?'Cancelled':s.status==='missed'?'Missed':s.category==='Rest'?'Rest day':s.proposed?'Proposed':s.date<dateKey()?'Not logged':'Planned'}
export function weeklyOccurrences(session:Session,until:string):Session[]{
 if(until<session.date||until>addDays(session.date,364)||!/^\d{4}-\d{2}-\d{2}$/.test(until))throw new Error('Choose a weekly end date within the next year.')
 const seriesId=uid(),items:Session[]=[]
 for(let day=session.date;day<=until;day=addDays(day,7))items.push({...structuredClone(session),id:items.length?uid():session.id,date:day,recurrence:{seriesId,until,exception:false}})
 return items
}
export function savePlannedActivity(data:AppData,session:Session,scope:EditScope='one',repeatUntil=''):AppData{
 const problem=validateSession(session);if(problem)throw new Error(problem)
 const before=data.sessions.find(s=>s.id===session.id)
 if(before&&isCompleted(data,before.id))throw new Error('Completed activities keep their historical prescription. Create a new session to change future training.')
 let replacements:Session[]
 if(!before)replacements=repeatUntil?weeklyOccurrences(session,repeatUntil):[session]
 else if(scope==='future'&&before.recurrence){
  const offset=Math.round((Date.parse(session.date+'T12:00:00Z')-Date.parse(before.date+'T12:00:00Z'))/86400000)
  replacements=data.sessions.filter(s=>s.recurrence?.seriesId===before.recurrence!.seriesId&&s.date>=before.date&&!isCompleted(data,s.id)&&(!s.recurrence.exception||s.id===before.id)).map(s=>({...structuredClone(session),id:s.id,date:addDays(s.date,offset),recurrence:{...s.recurrence!,until:addDays(s.recurrence!.until,offset),exception:false}}))
 }else replacements=[{...session,...(before.recurrence?{recurrence:{...before.recurrence,exception:true}}:{})}]
 for(const s of replacements){const error=validateSession(s);if(error)throw new Error(error)}
 const ids=new Set(replacements.map(s=>s.id)),sessions=[...data.sessions.filter(s=>!ids.has(s.id)),...replacements],keys=new Set<string>()
 for(const s of sessions.filter(s=>s.recurrence&&s.status!=='cancelled')){const k=JSON.stringify([s.recurrence!.seriesId,s.date,s.schedule?.startTime]);if(keys.has(k))throw new Error('This change would duplicate an occurrence. Review the series dates.');keys.add(k)}
 return {...data,sessions}
}
export interface TrainingActivity {id:string;recordId:string;kind:'workout'|'match'|'test';title:string;date:string;minutes:number|null;rpe:number|null;load:number|null;participated:boolean;detail:string}
export function trainingHistory(data:AppData):TrainingActivity[]{
 const fixtures=new Set(data.performance.matches.flatMap(m=>m.fixtureId?[m.fixtureId]:[]))
 const workouts:TrainingActivity[]=data.logs.filter(l=>!fixtures.has(l.sessionId)).map(l=>({id:'workout:'+l.id,recordId:l.id,kind:'workout',title:l.title,date:l.date,minutes:l.minutes,rpe:l.rpe,load:l.team&&!l.team.attended?0:l.minutes*l.rpe,participated:l.team?l.team.attended:true,detail:l.team?l.team.attended?`${l.team.participation} team participation`:'Did not attend':l.skillResults?`${l.skillResults.reduce((n,r)=>n+(r.successes??0),0)} successful / ${l.skillResults.reduce((n,r)=>n+(r.attempts??0),0)} attempts recorded`:`${l.results.filter(r=>r.done).length} / ${l.results.length} sets performed${l.results.some(r=>!r.done)?' · Partial session':''}`}))
 const matches:TrainingActivity[]=data.performance.matches.map(m=>({id:'match:'+m.id,recordId:m.id,kind:'match',title:`vs ${m.opponent}`,date:m.date,minutes:m.minutes,rpe:m.rpe??null,load:m.participation==='Did not play'?0:m.minutes!==null&&m.rpe!==undefined?m.minutes*m.rpe:null,participated:m.participation!=='Did not play',detail:`${m.position||'Position not recorded'} · ${m.result}`}))
 const tests:TrainingActivity[]=data.performance.results.map(r=>({id:'test:'+r.id,recordId:r.id,kind:'test',title:r.definition.name,date:r.date,minutes:null,rpe:null,load:null,participated:true,detail:`${r.value} ${r.definition.unit} · ${r.quality}`}))
 return [...workouts,...matches,...tests].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))
}
