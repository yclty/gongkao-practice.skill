import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataRoot, atomicJson } from "./lib/local-store.js";
import { request } from "./ensure-service.js";

// Upgrade/uninstall only stop our authenticated service. They never delete learner data.
if(process.argv.includes("--stop")) {
  const root=dataRoot(),path=join(root,"runtime","service.json");
  if(existsSync(path)) {
    const info=JSON.parse(readFileSync(path,"utf8"));
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(info.origin)||!/^[a-f0-9]{64}$/.test(info.token))throw new Error("Invalid local service metadata");
    const health=await fetch(info.origin+"/health",{headers:{Authorization:"Bearer "+info.token},signal:AbortSignal.timeout(2000)}).catch(()=>null);
    if(health?.ok) {
      if(process.argv.includes("--backup")) {
        const {result}=await request(info,"/rpc",{method:"list_profiles"});
        for(const learner of result.profiles) {
          if(!learner.goals.length)continue;
          const bound=await request(info,"/rpc",{method:"bind_profile",arguments:{learner_id:learner.id,goal_id:learner.goals[0].id}});
          const backup=await request(info,"/rpc",{method:"export_backup",arguments:{binding_id:bound.result.binding_id}});
          const dir=join(root,"profiles",learner.id,"backups");mkdirSync(dir,{recursive:true});
          atomicJson(join(dir,"upgrade-"+Date.now()+".json"),backup.result);
        }
      }
      await request(info,"/shutdown",{});
      for(let i=0;i<30&&existsSync(path);i++)await new Promise((resolve)=>setTimeout(resolve,100));
      if(existsSync(path))throw new Error("Service has not stopped yet; retry upgrade shortly.");
    }
  }
  console.log("Local service stopped; personal records retained.");
}
