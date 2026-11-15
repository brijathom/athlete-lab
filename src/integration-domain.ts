import {contextSections,type ContextSection} from './coaching-context'
export class IntegrationError extends Error { constructor(public status:number,message:string,public code='integration_error'){super(message)} }
export interface DataSharing {
 historyDays:number;upcomingDays:number;sections:ContextSection[]
 identity:boolean;symptoms:boolean;illness:boolean;recovery:boolean;notes:boolean
}
export const defaultSharing=():DataSharing=>({historyDays:14,upcomingDays:7,sections:Object.keys(contextSections) as ContextSection[],identity:false,symptoms:false,illness:false,recovery:false,notes:false})
export function strictObject(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new IntegrationError(400,'The request contains missing or unsupported fields.','invalid_request')
 return value as Record<string,unknown>
}
export function validateSharing(value:unknown):DataSharing{
 const v=strictObject(value,['historyDays','upcomingDays','sections','identity','symptoms','illness','recovery','notes'])
 if(![7,14,28,90].includes(v.historyDays as number)||![7,14,28].includes(v.upcomingDays as number)||!Array.isArray(v.sections)||!v.sections.length||v.sections.length>8||new Set(v.sections).size!==v.sections.length||v.sections.some(k=>typeof k!=='string'||!Object.hasOwn(contextSections,k))||['identity','symptoms','illness','recovery','notes'].some(k=>typeof v[k]!=='boolean'))throw new IntegrationError(400,'Choose valid date windows, sections and data-sharing settings.','invalid_sharing')
 return structuredClone(v) as unknown as DataSharing
}
export const schemaObject=<P extends Record<string,unknown>>(properties:P)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
