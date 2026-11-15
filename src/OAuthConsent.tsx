import { useEffect, useState } from 'react'
import { supabase } from './supabase'
export function OAuthConsent({signedIn,goProfile}:{signedIn:boolean;goProfile:()=>void}) {
  const id=new URLSearchParams(location.search).get('authorization_id')
  const [details,setDetails]=useState<{client:{name?:string;uri?:string};scope:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[approved,setApproved]=useState(false)
  useEffect(()=>{let active=true;if(signedIn&&id&&supabase)void supabase.auth.oauth.getAuthorizationDetails(id).then(result=>{if(!active)return;if(result.error)setError('This authorisation request is unavailable or expired.');else if(result.data&&'authorization_id' in result.data)setDetails(result.data);else setError('This request was already processed. Return to your ChatGPT connection.');});return()=>{active=false}},[signedIn,id])
  const decide=async(accept:boolean)=>{
    if(!id||!supabase||!signedIn||!details||(accept&&!approved))return
    setBusy(true);setError('')
    const result=accept?await supabase.auth.oauth.approveAuthorization(id):await supabase.auth.oauth.denyAuthorization(id)
    if(result.error||!result.data){setError('Could not complete authorisation. Please retry.');setBusy(false);return}
    // Redirect only to the URL returned by Supabase for this validated request.
    location.assign(result.data.redirect_url)
  }
  return <section className="panel stack"><h2>Authorise a coaching connection</h2>{!signedIn?<><p>Sign in before reviewing this connection. No access is granted by opening this page.</p><button className="button primary" onClick={goProfile}>Sign in to review</button></>:details?<><p>Client: <strong>{details.client.name||'Unnamed OAuth client'}</strong></p><p className="small">Requested scopes: {details.scope}</p><p>Only authorise a client you recognise. Tool access additionally requires your category permissions, server client allowlisting and audience validation. Workout changes still require separate review in Athlete Lab.</p><label className="goal-check"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>I recognise this client and approve this connection.</label><div className="flex gap-3"><button className="button primary" disabled={busy||!approved} onClick={()=>void decide(true)}>Authorise connection</button><button className="button secondary" disabled={busy} onClick={()=>void decide(false)}>Deny connection</button></div></>:<p>{id?'Loading connection details…':'No authorisation request was supplied.'}</p>}{error&&<p role="alert">{error}</p>}</section>
}
