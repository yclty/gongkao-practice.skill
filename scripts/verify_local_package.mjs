// Runs only in newly created temporary directories. Never uses real learner data.
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {Client} from "../plugin-ui/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import {StdioClientTransport} from "../plugin-ui/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
const archive=resolve(process.argv[2]),codex=process.argv[3],dir=mkdtempSync(join(tmpdir(),"考公 包验证-"));
const report={archive,windows:process.platform,checks:[],temporary_directory:dir};
const check=(name)=>{report.checks.push(name);console.log("PASS "+name);};
function run(command,args,env={}){const r=spawnSync(command,args,{env:{...process.env,...env},encoding:"utf8",windowsHide:true,maxBuffer:8*1024*1024});if(r.status!==0)throw new Error((r.error?.message??"")+r.stdout.slice(-2000)+"\n"+r.stderr.slice(-5000));return r.stdout;}
const quote=(v)=>"'"+v.replaceAll("'","''")+"'";
const extract=join(dir,"中文 空格 解压");
run("powershell.exe",["-NoProfile","-EncodedCommand",Buffer.from("$ProgressPreference='SilentlyContinue'\n$ErrorActionPreference='Stop'\nExpand-Archive -LiteralPath "+quote(archive)+" -DestinationPath "+quote(extract),"utf16le").toString("base64")]);
const pkg=join(extract,readdirSync(extract)[0]),install=join(dir,"本地 安装");
const rootA=join(dir,"用户甲 数据"),rootB=join(dir,"用户乙 数据");
const env={GONGKAO_DATA_DIR:rootA};
run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",join(pkg,"install.ps1"),"-InstallRoot",install,"-SkipCodex","-NoOpen","-NoShortcut"],env);
check("Windows PowerShell 5.1 install from a ZIP in a Unicode/space path");
const installed=JSON.parse(readFileSync(join(install,"current.json"),"utf8")).package;
const plugin=join(installed,"plugins","gongkao-coach"),node=join(plugin,"runtime","node.exe"),entry=join(plugin,"server","mcp-stdio.js");
const clients=[],dataDirectories=new Set();
async function connect(root,entryPath=entry,nodePath=node){dataDirectories.add(root);const c=new Client({name:"package-verification",version:"1.0"});await c.connect(new StdioClientTransport({command:nodePath,args:[entryPath],env:{...process.env,GONGKAO_DATA_DIR:root,PATH:process.env.SystemRoot+"\\System32"},stderr:"pipe"}));clients.push(c);return c;}
async function call(c,name,args){const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);return r.structuredContent;}
const key=()=>crypto.randomUUID();
const finishAnswer=async(c,binding,v,choice="A")=>call(c,"submit_quiz_answer",{binding_id:binding,session_id:v.session_id,session_item_id:v.payload.session_item_id,question_id:v.payload.question.question_id,answer:choice,idempotency_key:key()});
const next=async(c,b,v)=>call(c,"next_quiz_question",{binding_id:b,session_id:v.session_id,idempotency_key:key()});
async function stop(root){const path=join(root,"runtime","service.json");if(!existsSync(path))return;const info=JSON.parse(readFileSync(path,"utf8"));await fetch(info.origin+"/shutdown",{method:"POST",headers:{Authorization:"Bearer "+info.token}}).catch(()=>{});}
async function rpc(root,method,input={}){const info=JSON.parse(readFileSync(join(root,"runtime","service.json"),"utf8"));const r=await fetch(info.origin+"/rpc",{method:"POST",headers:{Authorization:"Bearer "+info.token,"Content-Type":"application/json"},body:JSON.stringify({method,arguments:input})});assert.ok(r.ok,await r.clone().text());return (await r.json()).result;}
try{
  const a=await connect(rootA),b=await connect(rootB);
  const tools=(await a.listTools()).tools;assert.equal(tools.length,18);check("Bundled Node and dependencies start all 18 stdio tools without global Node/npm");
  const pa=await call(a,"initialize_project_learning_state",{name:"安装包验证甲",exam_type:"省考",idempotency_key:key()});
  const pb=await call(b,"initialize_project_learning_state",{name:"安装包验证乙",exam_type:"省考",idempotency_key:key()});
  let va=await call(a,"start_quiz_from_bank",{binding_id:pa.binding_id,session_mode:"quick",idempotency_key:key()});
  for(let i=0;i<2;i++){va=await finishAnswer(a,pa.binding_id,va);va=await next(a,pa.binding_id,va);}
  await call(a,"save_quiz_draft",{binding_id:pa.binding_id,session_id:va.session_id,slot:2,answer:"B",note:"跨入口草稿",idempotency_key:key()});
  assert.equal((await call(b,"get_progress_report",{binding_id:pb.binding_id})).total_attempts,0);
  check("Same public ZIP, separate data directories and learner identities");
  const info=JSON.parse(readFileSync(join(rootA,"runtime","service.json"),"utf8"));
  process.kill(info.pid,"SIGKILL");
  va=await call(a,"resume_quiz_session",{binding_id:pa.binding_id,session_id:va.session_id,idempotency_key:key()});
  assert.equal(va.payload.question.progress.current,3);assert.equal(va.payload.draft.note,"跨入口草稿");
  assert.equal((await call(a,"get_progress_report",{binding_id:pa.binding_id})).total_attempts,2);
  check("Forced service termination restores two committed answers and the third draft");
  va=await finishAnswer(a,pa.binding_id,va);await next(a,pa.binding_id,va);
  assert.equal((await rpc(rootA,"get_progress_report",{binding_id:pa.binding_id})).total_attempts,3);
  check("MCP answers are immediately visible through the browser HTTP API");
  let vb=await call(b,"start_quiz_from_bank",{binding_id:pb.binding_id,session_mode:"quick",idempotency_key:key()});
  for(let i=0;i<3;i++){vb=await finishAnswer(b,pb.binding_id,vb);vb=await next(b,pb.binding_id,vb);}
  const c=await connect(rootA);
  assert.equal((await call(c,"get_progress_report",{binding_id:pa.binding_id})).total_attempts,3);
  check("A fresh chat connection continues the same explicitly bound history");
  const backup=await rpc(rootA,"export_backup",{binding_id:pa.binding_id});
  const restored=await rpc(rootB,"import_backup",{backup,idempotency_key:"portable-restore"});
  const bound=await rpc(rootB,"bind_profile",{learner_id:restored.learner_id,goal_id:restored.goals[0]});
  assert.equal((await call(b,"get_progress_report",{binding_id:bound.binding_id})).total_attempts,3);
  assert.equal((await call(b,"get_progress_report",{binding_id:pb.binding_id})).total_attempts,3);
  check("Personal backup restores into a new learner without overwriting another learner");
  run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",join(pkg,"install.ps1"),"-InstallRoot",install,"-SkipCodex","-NoOpen","-NoShortcut"],env);
  assert.equal((await call(c,"get_progress_report",{binding_id:pa.binding_id})).total_attempts,3);
  check("Repeated installation prepares a backup and existing MCP connections reconnect");
  let mock=await call(c,"start_paper_from_bank",{binding_id:pa.binding_id,timing_mode:"strict",available_minutes:0.001,ignore_unfinished:true,idempotency_key:key()});
  assert.equal(JSON.stringify(mock).includes("correct_answer"),false);
  await new Promise((r)=>setTimeout(r,100));
  mock=await call(c,"resume_quiz_session",{binding_id:pa.binding_id,session_id:mock.session_id,idempotency_key:key()});
  assert.equal(mock.payload.status,"EXPIRED");
  const total=(await call(c,"get_progress_report",{binding_id:pa.binding_id})).total_attempts;
  await call(c,"submit_paper_session",{binding_id:pa.binding_id,session_id:mock.session_id,idempotency_key:key()});
  assert.equal((await call(c,"get_progress_report",{binding_id:pa.binding_id})).total_attempts,total);
  check("Packaged real paper retains its deadline and is graded only once after expiry");
  if(codex){
    // The official CODEX_HOME override is scoped to these child processes for an isolated install.
    const isolated={CODEX_HOME:join(dir,"Codex 验证配置")};
    mkdirSync(isolated.CODEX_HOME,{recursive:true});
    run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",join(pkg,"install.ps1"),"-InstallRoot",install,"-NoOpen","-NoShortcut","-CodexPath",codex],{...env,...isolated});
    const registration=JSON.parse(run(codex,["plugin","marketplace","add",install,"--json"],isolated));
    const added=JSON.parse(run(codex,["plugin","add","gongkao-coach@gongkao-local","--json"],isolated));
    const listing=JSON.parse(run(codex,["plugin","list","--json"],isolated));
    const item=listing.installed.find((p)=>p.pluginId==="gongkao-coach@gongkao-local");assert.ok(item?.enabled);assert.equal(item.version,"1.0.0");
    report.codex={registration,installed:added,plugin:item};
    check("Native Codex CLI registers, installs and discovers the Plugin in an isolated configuration");
    const cache=added.installedPath;
    const portable=JSON.parse(readFileSync(join(cache,"mcp.json"),"utf8")).mcpServers["gongkao-local"];
    const expand=(s)=>s.replaceAll("${PLUGIN_ROOT}",cache);
    const cached=await connect(join(dir,"缓存 运行验证"),expand(portable.args[0]),expand(portable.command));
    assert.equal((await call(cached,"get_question_bank_status",{})).stats.interactive_supported,7623);
    check("The installed Codex cache launches its portable mcp.json with the bundled runtime");
  }
}finally{for(const c of clients)await c.close();for(const root of dataDirectories)await stop(root);}
const path=join(resolve("docs"),"local-package-verification.json");
writeFileSync(path,JSON.stringify(report,null,2));console.log("Report: "+path);
