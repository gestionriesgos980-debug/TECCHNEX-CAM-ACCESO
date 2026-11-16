// CAM-ACCESO LAB-29 — administración de puestos con código único entre contratos CAM-ACCESO.
// Candidato local LAB-29. No desplegar sin migración aprobada, revisión, respaldo y pruebas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { bogotaToday, isCommercialEntitlementCurrent, isOperationalPostStatus, isOperationalRole } from "../_shared/commercial-policy.ts";
const URL = Deno.env.get("SUPABASE_URL") || "";
function readSecretJson(name: string): string {
  const raw = Deno.env.get(name) || "";
  if (!raw) return "";
  try {
    const value = JSON.parse(raw)?.default;
    return typeof value === "string" ? value : "";
  } catch { return ""; }
}
const ANON = readSecretJson("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = readSecretJson("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// CORS: conservar orígenes base y sumar los adicionales configurados en Supabase.
// No usar wildcard: solo se reflejan orígenes explícitamente permitidos.
const DEFAULT_ORIGINS = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://gestionriesgos980-debug.github.io",
];
const EXTRA_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const ORIGINS = new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS]);
function corsHeaders(req: Request): Record<string,string> {
  const h: Record<string,string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  const origin = req.headers.get("Origin");
  if (origin && ORIGINS.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(req:Request,status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders(req),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
function obj(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v)}
function uuid(v:unknown):v is string{return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)}
function norm(s:string){return s.trim().normalize("NFKC").toUpperCase()}
function one<T>(v:T|T[]|null|undefined):T|null{return Array.isArray(v)?(v[0]??null):(v??null)}
async function getCamAccesoContract(db:any,clientId:string,contractId:string){
 const {data:c,error}=await db.from("tecchnex_client_products").select("id,client_id,product_id,contract_number,start_date,end_date,status,client:tecchnex_clients(status),product:tecchnex_products(code,status)").eq("id",contractId).maybeSingle();
 if(error)throw new Error("CONTRACT_LOOKUP_FAILED");
 const product=one(c?.product);
 // La tabla de puestos es compartida con CAM-ACCESO: toda mutación debe probar CAM-ACCESO.
 if(!c||c.client_id!==clientId||String(product?.code||"").trim().toUpperCase()!=="CAM-ACCESO")throw new Error("CONTRACT_NOT_CAM_ACCESO");
 return c;
}
async function validContract(db:any,clientId:string,contractId:string){
 const c=await getCamAccesoContract(db,clientId,contractId);
 const client=one(c?.client);const product=one(c?.product);
 if(!isCommercialEntitlementCurrent({clientStatus:client?.status,productCode:product?.code,productStatus:product?.status,contractStatus:c.status,startDate:c.start_date,endDate:c.end_date},"CAM-ACCESO",bogotaToday()))throw new Error("CONTRACT_NOT_ACTIVE");
 return c;
}
Deno.serve(async(req)=>{
 const origin=req.headers.get("Origin");
 // El preflight debe resolverse antes de autenticación, JSON y demás lógica de negocio.
 if(req.method==="OPTIONS"){
  const allowed=!!origin&&ORIGINS.has(origin);
  return new Response(null,{status:allowed?204:403,headers:corsHeaders(req)});
 }
 if(origin&&!ORIGINS.has(origin))return reply(req,403,{ok:false,code:"ORIGIN_DENIED",message:"Origen no autorizado."});
 if(req.method!=="POST")return reply(req,405,{ok:false,message:"Método no permitido."});
 try{
  const match=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i);if(!match)return reply(req,401,{ok:false,message:"Sesión administrativa requerida."});
  const auth=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}});const {data:cd,error:ce}=await auth.auth.getClaims(match[1]);const claims=cd?.claims as Record<string,unknown>|undefined;
  if(ce||!claims?.sub)return reply(req,401,{ok:false,message:"La sesión no es válida o venció."});if(claims.aal!=="aal2")return reply(req,403,{ok:false,message:"Se requiere MFA AAL2."});
  const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});const actor=String(claims.sub);
  const {data:profile,error:pe}=await db.from("tecchnex_user_profiles").select("user_id,role,status,is_temporary,expires_at").eq("user_id",actor).maybeSingle();if(pe)return reply(req,503,{ok:false,message:"No se pudo verificar el perfil administrativo."});
  const expiry=profile?.expires_at==null?null:new Date(profile.expires_at).getTime();if(!profile||profile.role!=="admin_tecchnex"||profile.status!=="active"||profile.is_temporary===true||(expiry!==null&&(!Number.isFinite(expiry)||expiry<=Date.now())))return reply(req,403,{ok:false,message:"Perfil sin autorización administrativa vigente."});
  let body:unknown;try{body=await req.json()}catch{return reply(req,400,{ok:false,message:"JSON inválido."})}if(!obj(body)||typeof body.action!=="string")return reply(req,400,{ok:false,message:"Solicitud inválida."});
  const action=body.action;
  if(action==="list"){
   if(!uuid(body.client_id))return reply(req,400,{ok:false,message:"client_id inválido."});
   const {data:product,error:prodErr}=await db.from("tecchnex_products").select("id").eq("code","CAM-ACCESO").maybeSingle();if(prodErr||!product)return reply(req,503,{ok:false,message:"No se pudo verificar CAM-ACCESO."});
   const {data:contracts,error:conErr}=await db.from("tecchnex_client_products").select("id,contract_number,start_date,end_date,status").eq("client_id",body.client_id).eq("product_id",product.id).order("created_at",{ascending:false});if(conErr)return reply(req,503,{ok:false,message:"No se pudieron consultar los contratos."});
   const ids=(contracts||[]).map((c:any)=>c.id);if(!ids.length)return reply(req,200,{ok:true,data:[]});
   const {data:rows,error}=await db.from("tecchnex_product_posts").select("id,client_product_id,post_code,post_name,role,status,created_at,updated_at").in("client_product_id",ids).order("created_at",{ascending:false}).limit(200);if(error){console.error("post list failed",error.message);return reply(req,503,{ok:false,message:"No se pudieron consultar los puestos."});}
   const byId=new Map((contracts||[]).map((c:any)=>[c.id,c]));return reply(req,200,{ok:true,data:(rows||[]).map((r:any)=>({...r,display_name:r.post_name,contract_number:byId.get(r.client_product_id)?.contract_number??null}))});
  }
  if(action==="create"){
   if(!uuid(body.client_id)||!uuid(body.client_product_id))return reply(req,400,{ok:false,message:"Cliente o contrato inválido."});
   const code=typeof body.post_code==="string"?body.post_code.trim():"";const name=typeof body.display_name==="string"?body.display_name.trim():typeof body.post_name==="string"?body.post_name.trim():"";const role=typeof body.role==="string"?body.role:"";const password=typeof body.password==="string"?body.password:"";
   if(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(code)||!name||name.length>100||!isOperationalRole(role)||password.length<12||password.length>128)return reply(req,400,{ok:false,message:"Revisa código, nombre, rol y clave (12–128 caracteres)."});
   await validContract(db,body.client_id,body.client_product_id);const normalized=norm(code);
   // El ingreso busca el puesto solo por código dentro del producto: dos coincidencias lo bloquean.
   // La base solo garantiza unicidad por contrato, por eso se verifica aquí en todo el producto.
   const {data:dup,error:dupErr}=await db.from("tecchnex_product_posts").select("id,contract:tecchnex_client_products!inner(product:tecchnex_products!inner(code))").eq("post_code",normalized).eq("contract.product.code","CAM-ACCESO").limit(1);
   if(dupErr){console.error("post duplicate check failed",dupErr.message);return reply(req,503,{ok:false,message:"No se pudo verificar que el código sea único. Intenta de nuevo."});}
   if(dup&&dup.length>0)return reply(req,409,{ok:false,message:"Ese código de puesto ya existe en CAM-ACCESO. Incluye el nombre del cliente (por ejemplo porteria-casa-linda)."});
   const hash=await bcrypt.hash(password,12);
   const {data,error}=await db.from("tecchnex_product_posts").insert({client_product_id:body.client_product_id,post_code:normalized,post_name:name,password_hash:hash,role,status:"active"}).select("id,client_product_id,post_code,post_name,role,status,created_at,updated_at").single();
   if(error){console.error("post create failed",error.code,error.message);return reply(req,error.code==="23505"?409:503,{ok:false,message:error.code==="23505"?"Ese código de puesto ya está asignado en otro contrato CAM-ACCESO. Utiliza uno diferente.":"No se pudo crear el puesto. Confirma que la migración de rol fue aprobada y aplicada."});}return reply(req,200,{ok:true,data:data?{...data,display_name:data.post_name}:null});
  }
  if(action==="rotate_password"){
   if(!uuid(body.id)||typeof body.password!=="string"||body.password.length<12||body.password.length>128)return reply(req,400,{ok:false,message:"La clave debe tener 12–128 caracteres."});
   const {data:r,error:e}=await db.from("tecchnex_product_posts").select("id,status,client_product_id,client_product:tecchnex_client_products(id,client_id)").eq("id",body.id).maybeSingle();const c=one(r?.client_product);if(e||!r||!c)return reply(req,404,{ok:false,message:"No se encontró el puesto o su contrato."});if(!isOperationalPostStatus(r.status))return reply(req,409,{ok:false,message:"Estado de puesto no válido."});await validContract(db,c.client_id,c.id);
   const hash=await bcrypt.hash(body.password,12);const {data,error}=await db.from("tecchnex_product_posts").update({password_hash:hash,updated_at:new Date().toISOString()}).eq("id",body.id).select("id,status,updated_at").single();if(error||!data)return reply(req,503,{ok:false,message:"No se pudo confirmar el cambio de contraseña."});return reply(req,200,{ok:true,data});
  }
  if(action==="set_status"){
   if(!uuid(body.id)||!isOperationalPostStatus(String(body.status)))return reply(req,400,{ok:false,message:"Estado no permitido."});const {data:r,error:e}=await db.from("tecchnex_product_posts").select("id,status,client_product_id,client_product:tecchnex_client_products(id,client_id)").eq("id",body.id).maybeSingle();const c=one(r?.client_product);if(e||!r||!c)return reply(req,404,{ok:false,message:"No se encontró el puesto o su contrato."});await getCamAccesoContract(db,c.client_id,c.id);if(body.status==="active")await validContract(db,c.client_id,c.id);const {data,error}=await db.from("tecchnex_product_posts").update({status:body.status,updated_at:new Date().toISOString()}).eq("id",body.id).select("id,status,updated_at").single();if(error||!data)return reply(req,503,{ok:false,message:"No se pudo confirmar el cambio de estado."});return reply(req,200,{ok:true,data});
  }
  return reply(req,400,{ok:false,message:"Acción de puestos no reconocida."});
 }catch(e){const m=e instanceof Error?e.message:"unknown";if(m==="CONTRACT_NOT_ACTIVE")return reply(req,409,{ok:false,message:"El cliente o contrato CAM-ACCESO no está activo o vigente."});if(m==="CONTRACT_NOT_CAM_ACCESO")return reply(req,404,{ok:false,message:"No se encontró un contrato CAM-ACCESO asociado a este puesto."});console.error("cam-acceso-post-admin",m);return reply(req,503,{ok:false,message:"No se pudo completar la operación."});}
});
