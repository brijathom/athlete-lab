import {useState} from 'react'
import type {Session,WorkoutLog} from './domain'
import {SessionEditor,WorkoutLogger} from './components'
import {SkillsLogger} from './skills-ui'
export function UnplannedTraining({initial,save,close,busy}:{initial:Session;save:(session:Session,log:WorkoutLog)=>Promise<boolean>;close:()=>void;busy:boolean}){
 const [session,setSession]=useState<Session|null>(null)
 if(!session)return <SessionEditor session={initial} save={async s=>{setSession(s);return false}} close={close} busy={busy}/>
 const Logger=session.category==='Skills'&&session.exercises.some(e=>e.skill)?SkillsLogger:WorkoutLogger
 return <Logger session={session} save={log=>save(session,log)} close={close} busy={busy}/>
}
