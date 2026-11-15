import {useState} from 'react'
import {addDays,dateKey} from './domain'
import {trainingHistory} from './training-activities'
import {PerformancePage,TrendChart} from './performance-ui'
type Props=Parameters<typeof PerformancePage>[0]
export function ProgressPage(props:Props){
 const [weeks,setWeeks]=useState(8),{data}=props,today=dateKey(),since=addDays(today,-weeks*7+1)
 const completed=trainingHistory(data).filter(a=>a.date>=since&&a.date<=today&&a.participated&&a.kind!=='test')
 const points=Array.from({length:weeks},(_,i)=>{const from=addDays(today,-(weeks-i)*7+1),through=addDays(from,6);return{date:through,value:completed.filter(a=>a.date>=from&&a.date<=through).reduce((n,a)=>n+(a.minutes??0),0)}})
 const lifts=new Map<string,{date:string;value:number;label:string}[]>()
 for(const log of data.logs)for(const r of log.results.filter(r=>r.done&&r.load!==''&&r.reps!=='')){
  const ex=log.exercises.find(e=>e.id===r.exerciseId),key=`${r.substitution||ex?.name||'Unknown exercise'} · ${r.reps} reps`
  if(!lifts.has(key))lifts.set(key,[]);lifts.get(key)!.push({date:log.date,value:Number(r.load),label:'Recorded load; same exercise name and reps'})
 }
 const [lift,setLift]=useState(''),selected=lift||[...lifts.keys()][0]||''
 return <div className="stack"><div className="page-heading"><div><p className="eyebrow">YOUR RECORDED PROGRESS</p><h1>Progress.</h1><p className="muted">Consistency, strength and comparable performance results.</p></div><label>Reporting period<select value={weeks} onChange={e=>setWeeks(Number(e.target.value))}>{[4,8,12,26].map(n=><option key={n} value={n}>{n} weeks</option>)}</select></label></div>
 <div className="activity-stats"><div className="panel"><strong>{completed.length}</strong><span>Training and matches recorded</span></div><div className="panel"><strong>{completed.reduce((n,a)=>n+(a.minutes??0),0)}</strong><span>Known training minutes</span></div><div className="panel"><strong>{completed.reduce((n,a)=>n+(a.load??0),0)}</strong><span>Known minutes × RPE</span></div></div>
 <section className="panel stack"><h2>Training consistency</h2><TrendChart title="Recorded training minutes per seven-day period" points={points} unit="min"/><p className="small muted">Empty periods mean no recorded training, not proof of no training. Matches count once. {completed.filter(a=>a.minutes===null).length} records have unknown duration; {completed.filter(a=>a.load===null).length} have unknown workload. Tests add no assumed training duration.</p></section>
 <section className="panel stack"><h2>Strength progression</h2>{lifts.size?<><label>Exercise and repetitions<select value={selected} onChange={e=>setLift(e.target.value)}>{[...lifts.keys()].sort().map(k=><option key={k}>{k}</option>)}</select></label><TrendChart title={selected} unit="kg" points={(lifts.get(selected)||[]).sort((a,b)=>a.date.localeCompare(b.date))}/><p className="small muted">Actual loads at the same exercise name and repetitions. Technique and equipment may still differ. No maximum is estimated.</p></>:<p className="muted">Record performed repetitions and loads to see strength history.</p>}</section>
 <PerformancePage {...props} overviewOnly/>
 </div>
}
