import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LearningService } from "./lib/learning-service.js";
import { dataRoot, atomicJson, fail } from "./lib/local-store.js";

export const API_VERSION = 1;
const secret = () => randomBytes(32).toString("hex");
const equals = (a,b) => typeof a === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const html = readFileSync(new URL("./public/local-app.html",import.meta.url));
const script = readFileSync(new URL("./public/local-app.js",import.meta.url));
const style = readFileSync(new URL("./public/local-app.css",import.meta.url));
export function defaultBank() {
  return [process.env.QUESTION_BANK_PATH,fileURLToPath(new URL("../bank/questions.jsonl",import.meta.url)),fileURLToPath(new URL("../local-data/gongkao-question-bank.jsonl",import.meta.url))].find((path)=>path&&existsSync(path));
}
export function dispatch(service,method,input={}) {
  const binding=input.binding_id;
  switch(method) {
    case "list_profiles": return { profiles:service.store.list() };
    case "initialize_project_learning_state": return service.initialize(input);
    case "bind_profile": return service.store.bind(input.learner_id,input.goal_id);
    case "get_learning_context": return service.learningContext(binding);
    case "get_question_bank_status": return service.bankStatus();
    case "plan_training_session": return service.plan(binding,input);
    case "start_quiz_from_bank": return service.start(binding,input);
    case "start_quiz_session": return service.start(binding,input);
    case "start_paper_from_bank": return service.start(binding,{ ...input,session_mode:"paper" });
    case "get_quiz_session": { const c=service.context(binding);return service.view(c,service.store.getSession(c,input.session_id)); }
    case "submit_quiz_answer": return service.submit(binding,input);
    case "set_quiz_error_code": return service.annotate(binding,input);
    case "next_quiz_question": return service.next(binding,input);
    case "pause_quiz_session": return service.pause(binding,input);
    case "resume_quiz_session": return service.resume(binding,input);
    case "save_quiz_draft": return service.draft(binding,input);
    case "submit_paper_session": return service.submitPaper(binding,input);
    case "configure_project_study_route": return service.configure(binding,input);
    case "get_progress_report": return service.report(binding);
    case "export_backup": return service.exportBackup(service.store.context(binding).learner_id);
    case "import_backup": return service.importBackup(input.backup,input.idempotency_key);
    case "import_legacy_state": return service.importLegacy(input);
    case "apply_project_learning_events": fail("INVALID_INPUT","正式作答已经自动保存，不能用聊天摘要覆盖；旧状态请通过专用导入入口导入");break;
    default: fail("UNKNOWN_TOOL","未知操作");
  }
}
async function body(req) {
  const chunks=[];let size=0;for await(const chunk of req) { size+=chunk.length;if(size>100*1024*1024) fail("INVALID_INPUT","请求体过大");chunks.push(chunk); }
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{fail("INVALID_INPUT","JSON 格式错误");}
}
export async function createLocalServer({root=dataRoot(),bankPath=defaultBank(),assetDir,port=0,now}={}) {
  const service=new LearningService({root,bankPath,assetDir:assetDir??(bankPath?join(dirname(bankPath),"assets"):undefined),now});
  const token=secret();const browserTokens=new Set();const tickets=new Map();let origin;
  const reply=(res,status,value,headers={})=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers});res.end(JSON.stringify(value));};
  const server=createServer(async(req,res)=>{
    try {
      if(req.headers.host!==origin.slice(7)) {reply(res,403,{code:"HOST_REJECTED"});return;}
      if(req.headers.origin && req.headers.origin!==origin) {reply(res,403,{code:"ORIGIN_REJECTED"});return;}
      const url=new URL(req.url,origin);
      const bearer=req.headers.authorization?.replace(/^Bearer /,"");
      const cookie=req.headers.cookie?.match(/(?:^|;\s*)gongkao=([a-f0-9]{64})(?:;|$)/)?.[1];
      const authorized=equals(bearer,token)||browserTokens.has(bearer)||browserTokens.has(cookie);
      if(req.method==="GET" && url.pathname==="/") {res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'","Cache-Control":"no-store"});res.end(html);return;}
      if(req.method==="GET" && ["/app.js","/app.css"].includes(url.pathname)) {res.writeHead(200,{"Content-Type":url.pathname.endsWith(".js")?"text/javascript; charset=utf-8":"text/css; charset=utf-8"});res.end(url.pathname.endsWith(".js")?script:style);return;}
      if(req.method==="POST" && url.pathname==="/bootstrap") {
        const input=await body(req);const ticket=tickets.get(input.ticket);
        if(!ticket || ticket.expires<Date.now()) {reply(res,401,{code:"TICKET_EXPIRED",message:"入口已过期，请重新从 Plugin 或启动器打开"});return;}
        tickets.delete(input.ticket);const browserToken=secret();browserTokens.add(browserToken);
        reply(res,200,{ok:true},{"Set-Cookie":`gongkao=${browserToken}; HttpOnly; SameSite=Strict; Path=/`});return;
      }
      if(!authorized) {reply(res,401,{code:"LOCAL_AUTH_REQUIRED",message:"请通过 Plugin 或打开学习网页启动器进入"});return;}
      if(req.method==="GET" && url.pathname==="/health") {reply(res,200,{api_version:API_VERSION,pid:process.pid});return;}
      if(req.method==="POST" && url.pathname==="/ticket") {
        const input=await body(req);if(input.binding_id) service.store.context(input.binding_id);
        const ticket=secret();tickets.set(ticket,{expires:Date.now()+60000});reply(res,200,{ui_url:`${origin}/#ticket=${ticket}${input.binding_id?`&binding=${encodeURIComponent(input.binding_id)}`:""}${input.session_id?`&session=${encodeURIComponent(input.session_id)}`:""}`});return;
      }
      if(req.method==="POST" && url.pathname==="/rpc") {const input=await body(req);reply(res,200,{ok:true,result:dispatch(service,input.method,input.arguments)});return;}
      if(req.method==="GET" && /^\/bank-assets\/[a-f0-9]{64}$/.test(url.pathname)) {
        const name=url.pathname.slice(13);let path=service.assetDir&&join(service.assetDir,name);
        if(!path||!existsSync(path)) for(const p of service.store.list()) {const candidate=join(root,"profiles",p.id,"attachments",name);if(existsSync(candidate)){path=candidate;break;}}
        if(!path||!existsSync(path)){reply(res,404,{code:"RESOURCE_MISSING"});return;}
        const bytes=readFileSync(path);let type="image/png";if(bytes[0]===0xff&&bytes[1]===0xd8)type="image/jpeg";else if(bytes.toString("ascii",0,3)==="GIF")type="image/gif";else if(bytes.toString("ascii",8,12)==="WEBP")type="image/webp";
        res.writeHead(200,{"Content-Type":type,"X-Content-Type-Options":"nosniff","Cache-Control":"private,max-age=86400"});res.end(bytes);return;
      }
      if(req.method==="POST" && url.pathname==="/shutdown" && equals(bearer,token)){reply(res,200,{ok:true});setImmediate(()=>server.close(()=>service.close()));return;}
      reply(res,404,{code:"NOT_FOUND"});
    }catch(error){const userErrors=["INVALID_INPUT","OWNER_MISMATCH","REVISION_CONFLICT","BANK_INSUFFICIENT","SESSION_PAUSED","SESSION_EXPIRED","BACKUP_INVALID","UNKNOWN_TOOL"];reply(res,userErrors.includes(error.code)?400:500,{code:error.code??"LOCAL_SAVE_FAILED",message:error.message});}
  });
  try {await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});}
  catch(error){service.close();throw error;}
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,service,origin,token,close:()=>new Promise((resolve)=>server.close(()=>{service.close();resolve();}))};
}

if(process.argv.includes("--daemon")) {
  const root=dataRoot();const runtime=join(root,"runtime");mkdirSync(runtime,{recursive:true,mode:0o700});
  const lock=join(runtime,"service.lock");const infoPath=join(runtime,"service.json");let acquired=false;
  try {
    const fd=openSync(lock,"wx",0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);acquired=true;
    const preferences=join(runtime,"preferences.json");let preferred=0;
    try {const p=JSON.parse(readFileSync(preferences,"utf8")).port;if(Number.isInteger(p)&&p>=1024&&p<=65535)preferred=p;}catch{}
    let local;
    try {local=await createLocalServer({root,port:preferred});}
    catch(error){if(error.code!=="EADDRINUSE")throw error;local=await createLocalServer({root});}
    atomicJson(preferences,{port:Number(new URL(local.origin).port)});
    atomicJson(infoPath,{api_version:API_VERSION,pid:process.pid,origin:local.origin,token:local.token});
    const cleanup=()=>{try{const info=JSON.parse(readFileSync(infoPath,"utf8"));if(info.token===local.token)unlinkSync(infoPath);}catch{}if(acquired&&existsSync(lock))unlinkSync(lock);};
    local.server.on("close",cleanup);process.on("exit",cleanup);for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>local.server.close(()=>{local.service.close();process.exit(0);}));
  }catch(error){if(acquired&&existsSync(lock))unlinkSync(lock);console.error(error.message);process.exit(1);}
}
