import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "./lib/local-store.js";

export async function ensureService() {
  const root=dataRoot();const runtime=join(root,"runtime");mkdirSync(runtime,{recursive:true,mode:0o700});
  const infoPath=join(runtime,"service.json");const lock=join(runtime,"service.lock");
  const check=async()=>{
    try{const info=JSON.parse(readFileSync(infoPath,"utf8"));if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(info.origin)||!/^[a-f0-9]{64}$/.test(info.token))return null;
      const response=await fetch(`${info.origin}/health`,{headers:{Authorization:`Bearer ${info.token}`},signal:AbortSignal.timeout(1000)});
      const health=await response.json();if(response.ok&&health.pid===info.pid&&health.api_version===1)return info;
    }catch{}return null;
  };
  const existing=await check();if(existing)return existing;
  if(existsSync(lock)) {
    try {const pid=JSON.parse(readFileSync(lock,"utf8")).pid;process.kill(pid,0);}
    catch {unlinkSync(lock);}
  }
  const child=spawn(process.execPath,[fileURLToPath(new URL("./local-service.js",import.meta.url)),"--daemon"],{env:process.env,detached:true,stdio:"ignore",windowsHide:true});child.unref();
  for(let attempt=0;attempt<60;attempt++){await new Promise((resolve)=>setTimeout(resolve,150));const info=await check();if(info)return info;}
  throw new Error("本地学习服务未启动，请检查运行时、题库和数据目录；未修改个人记录");
}
export async function request(info,path,input) {
  const response=await fetch(`${info.origin}${path}`,{method:"POST",headers:{Authorization:`Bearer ${info.token}`,"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.message??result.code),{code:result.code});return result;
}
if(process.argv.includes("--open")) {
  const info=await ensureService();const {ui_url}=await request(info,"/ticket",{});
  if(process.platform==="win32")spawn("rundll32.exe",["url.dll,FileProtocolHandler",ui_url],{stdio:"ignore",windowsHide:true}).unref();
  else spawn(process.platform==="darwin"?"open":"xdg-open",[ui_url],{stdio:"ignore"}).unref();
  console.log("已打开本地学习网页；个人进度会自动保存在本机。");
}
