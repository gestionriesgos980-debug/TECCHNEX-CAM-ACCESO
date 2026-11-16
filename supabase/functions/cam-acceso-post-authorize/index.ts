// CAM-ACCESO-PUESTO-01 — autorización de puesto (copia aislada del patrón CAM-RONDAS LAB-33).
// Candidato de laboratorio. NO DESPLEGADO. Valida el puesto local y exige autorización comercial POST central.
// Antes de producción: retirar localhost/127.0.0.1 de ALLOWED_ORIGINS por defecto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { bogotaToday, isActiveStatus, isCommercialEntitlementCurrent, isOperationalRole } from "../_shared/commercial-policy.ts";
import { createLoginRateLimiterFromEnv } from "../_shared/upstash-login-rate-limiter.ts";
import { authorizeCentralCommercial, isCentralAuthorizationUnavailable } from "../_shared/universal-bridge-client.ts";
function readSecretJson(name: string): string {
  const raw = Deno.env.get(name) || "";
  if (!raw) return "";
  try {
    const value = JSON.parse(raw)?.default;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
function serverSecretKey(): string {
  return readSecretJson("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const URL=Deno.env.get("SUPABASE_URL")||"";const SERVICE=serverSecretKey();const SECRET=Deno.env.get("CAM_ACCESO_SESSION_HMAC_SECRET")||"";
const ORIGINS=new Set(("http://localhost:5500,http://127.0.0.1:5500,https://gestionriesgos980-debug.github.io,"+(Deno.env.get("ALLOWED_ORIGINS")||"")).split(",").map(s=>s.trim()).filter(Boolean));const MAX=4096;
function reply(req:Request,status:number,body:Record<string,unknown>,extraHeaders:Record<string,string>={}){const h:Record<string,string>={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store, max-age=0","Pragma":"no-cache","X-Content-Type-Options":"nosniff","Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS",...extraHeaders};const o=req.headers.get("Origin");if(o&&ORIGINS.has(o))h["Access-Control-Allow-Origin"]=o;return new Response(JSON.stringify(body),{status,headers:h});}
function one<T>(v:T|T[]|null|undefined):T|null{return Array.isArray(v)?(v[0]??null):(v??null)}function norm(s:string){return s.trim().normalize("NFKC").toUpperCase()}
async function readBody(req:Request){const r=req.body?.getReader();if(!r)throw new Error("EMPTY");const chunks:Uint8Array[]=[];let n=0;try{while(true){const x=await r.read();if(x.done)break;n+=x.value.byteLength;if(n>MAX){await r.cancel();throw new Error("LARGE")}chunks.push(x.value)}}finally{r.releaseLock()}const b=new Uint8Array(n);let at=0;for(const c of chunks){b.set(c,at);at+=c.length}return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(b))}
function trustedClientIp(req:Request):string{
  // Use only the Cloudflare client-IP header; do not trust caller-supplied forwarding headers.
  const raw=req.headers.get("cf-connecting-ip")||"";
  const ip=raw.trim();
  if(!ip||ip.length>100||ip.includes(",")||/[\s]/.test(ip))return "";
  if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)){
    const octets=ip.split(".").map(Number);
    return octets.every(v=>v>=0&&v<=255)?ip:"";
  }
  return /^[0-9a-fA-F:]+$/.test(ip)&&ip.includes(":")?ip.toLowerCase():"";
}
async function signed(payload:Record<string,unknown>){if(SECRET.length<32)throw new Error("SECRET_NOT_CONFIGURED");const enc=new TextEncoder();const b64=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=b64(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"})));const p=b64(enc.encode(JSON.stringify(payload)));const key=await crypto.subtle.importKey("raw",enc.encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(`${h}.${p}`)));return `${h}.${p}.${b64(sig)}`}


Deno.serve(async req=>{const origin=req.headers.get("Origin");if(origin&&!ORIGINS.has(origin))return reply(req,403,{authorized:false,code:"ORIGIN_DENIED",message:"Origen no autorizado."});if(req.method==="OPTIONS")return new Response(null,{status:origin&&ORIGINS.has(origin)?204:403,headers:{...(origin&&ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}});if(req.method!=="POST")return reply(req,405,{authorized:false,code:"METHOD_NOT_ALLOWED"});if(!/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get("content-type")||""))return reply(req,415,{authorized:false,code:"UNSUPPORTED_MEDIA_TYPE"});if(!URL||!SERVICE||SECRET.length<32)return reply(req,503,{authorized:false,code:"AUTH_BACKEND_NOT_CONFIGURED"});let b:unknown;try{b=await readBody(req)}catch(e){return reply(req,e instanceof Error&&e.message==="LARGE"?413:400,{authorized:false,code:e instanceof Error&&e.message==="LARGE"?"BODY_TOO_LARGE":"INVALID_JSON"})}if(!b||typeof b!=="object"||Array.isArray(b))return reply(req,400,{authorized:false,code:"INVALID_BODY"});const x=b as Record<string,unknown>;const code=typeof x.post_code==="string"?x.post_code.trim():"";const password=typeof x.post_password==="string"?x.post_password:"";
 // Apply distributed controls before credential lookup/comparison. Missing Redis/IP fails closed.
 const clientIp=trustedClientIp(req);
 if(!clientIp)return reply(req,503,{authorized:false,code:"RATE_LIMIT_CLIENT_IP_UNAVAILABLE"});
 try{
   const limiter=createLoginRateLimiterFromEnv((name)=>Deno.env.get(name)||undefined,"CAM_ACCESO");
   const rate=await limiter.consume(code?norm(code):"__INVALID_POST_CODE__",clientIp);
   if(!rate.allowed)return reply(req,429,{authorized:false,code:"RATE_LIMIT_EXCEEDED",message:"Demasiados intentos. Intenta nuevamente más tarde."},{"Retry-After":String(rate.retryAfterSeconds)});
 }catch(e){console.error("cam-acceso rate limiter unavailable",e instanceof Error?e.message:"unknown");return reply(req,503,{authorized:false,code:"RATE_LIMIT_SERVICE_UNAVAILABLE",message:"La protección de acceso no está disponible; el ingreso permanece bloqueado."});}
 if(!code||code.length>80||!password||password.length>128||x.product_code!=="CAM-ACCESO")return reply(req,401,{authorized:false,code:"INVALID_CREDENTIALS",message:"Puesto o clave no autorizados."});
 try{const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});const {data:rows,error}=await db.from("tecchnex_product_posts").select("id,client_product_id,post_code,post_name,role,password_hash,status,contract:tecchnex_client_products!inner(id,client_id,status,start_date,end_date,client:tecchnex_clients(status),product:tecchnex_products!inner(code,status))").eq("post_code",norm(code)).eq("contract.product.code","CAM-ACCESO").limit(2);if(error){console.error("post lookup",error.message);return reply(req,503,{authorized:false,code:"AUTH_BACKEND_UNAVAILABLE"})}if(!rows||rows.length!==1)return reply(req,401,{authorized:false,code:"INVALID_CREDENTIALS",message:"Puesto o clave no autorizados."});const row=rows[0];if(!isActiveStatus(row.status))return reply(req,401,{authorized:false,code:"INVALID_CREDENTIALS",message:"Puesto o clave no autorizados."});const ok=await bcrypt.compare(password,row.password_hash);if(!ok)return reply(req,401,{authorized:false,code:"INVALID_CREDENTIALS",message:"Puesto o clave no autorizados."});const c=one(row.contract as any);const client=one(c?.client as any);const product=one(c?.product as any);const today=bogotaToday();const localEntitlementValid=!!c&&c.id===row.client_product_id&&!!c.client_id&&isCommercialEntitlementCurrent({clientStatus:client?.status,productCode:product?.code,productStatus:product?.status,contractStatus:c.status,startDate:c.start_date,endDate:c.end_date},"CAM-ACCESO",today);if(!isOperationalRole(row.role)||!localEntitlementValid)return reply(req,403,{authorized:false,code:"CONTRACT_NOT_ACTIVE",message:"El puesto no tiene un contrato CAM-ACCESO activo y vigente."});const central=await authorizeCentralCommercial({postId:String(row.id),clientId:String(c.client_id)});if(!central.authorized)return reply(req,isCentralAuthorizationUnavailable(central.code)?503:403,{authorized:false,code:central.code,message:isCentralAuthorizationUnavailable(central.code)?"No fue posible consultar la autorización central; el acceso permanece bloqueado.":"El Administrador Maestro no autorizó el acceso comercial."});const now=Math.floor(Date.now()/1000);const token=await signed({iss:"tecchnex-cam-acceso",aud:"CAM-ACCESO",sub:row.id,client_id:c.client_id,client_product_id:c.id,role:row.role,iat:now,exp:now+900,jti:crypto.randomUUID()});return reply(req,200,{authorized:true,code:"AUTHORIZED",post:{id:row.id,name:row.post_name,role:row.role},session_token:token,expires_in:900,commercial:{product_code:"CAM-ACCESO",valid_from:central.valid_from??null,valid_until:central.valid_until??null}})}catch(e){console.error("cam-acceso-post-authorize",e instanceof Error?e.message:"unknown");return reply(req,503,{authorized:false,code:"AUTH_BACKEND_UNAVAILABLE",message:"No se pudo validar el acceso en este momento."})}
});
