import {test,type Page} from '@playwright/test'
/** Navigate through the visible product UI; shared by existing feature scenarios. */
export async function navigate(page:Page,destination:string){
 const main=page.getByRole('navigation',{name:test.info().project.name.startsWith('iPhone')?'Mobile navigation':'Main navigation',exact:true})
 if(destination==='Profile'||destination==='Settings'||destination==='ChatGPT Tools'){
  await page.getByRole('button',{name:'Open settings',exact:true}).click()
  if(destination==='ChatGPT Tools'){await page.getByText('Advanced connection settings',{exact:true}).click();await page.getByRole('button',{name:'ChatGPT connection',exact:true}).click()}
 }else if(destination==='Skills'||destination==='Recovery'){
  await main.getByRole('button',{name:'Training Log',exact:true}).click()
  await page.getByRole('button',{name:destination==='Skills'?'Skills history':'Recovery observations',exact:true}).click()
 }else if(destination==='Coaching Context'){
  await main.getByRole('button',{name:'Programme',exact:true}).click();await page.getByRole('button',{name:'Share with ChatGPT',exact:true}).click()
 }else{
  const label=destination==='Activity'?'Training Log':destination==='Performance'?'Testing':destination==='Today'||destination==='Calendar'?'Programme':destination
  await main.getByRole('button',{name:label,exact:true}).click()
  if(destination==='Programme')await page.getByRole('button',{name:'Manage programme',exact:true}).click()
 }
}
