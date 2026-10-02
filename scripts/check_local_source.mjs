import {readFileSync,readdirSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import assert from "node:assert/strict";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const plugin=resolve(root,"plugins/gongkao-coach");
const json=(p)=>JSON.parse(readFileSync(p,"utf8"));
const manifest=json(resolve(plugin,"plugin.json")),mcp=json(resolve(plugin,"mcp.json"));
assert.equal(manifest.name,"gongkao-coach");assert.equal(manifest.version,"1.0.0");
const ui=manifest.extensions["com.openai"].interface;
assert.ok([...ui.shortDescription].length<=30);assert.ok(ui.defaultPrompt.length<=3);
assert.equal(mcp.mcpServers["gongkao-local"].type,"stdio");
assert.equal(mcp.mcpServers["gongkao-local"].command,"${PLUGIN_ROOT}/runtime/node.exe");
for(const name of ["gongkao-coach","gongkao-onboarding"]){
  const skill=resolve(plugin,"skills",name,"SKILL.md"),content=readFileSync(skill,"utf8");
  assert.ok(content.startsWith("---\n")||content.startsWith("---\r\n"));
  assert.ok(content.includes("name: "+name));
  for(const match of content.matchAll(/\]\(([^)]+\.md)\)/g))assert.ok(existsSync(resolve(dirname(skill),match[1])),match[1]);
  assert.equal(content,readFileSync(resolve(root,"plugin-package/gongkao-coach/skills",name,"SKILL.md"),"utf8"));
}
const files=[];
function scan(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory()){if(!["node_modules",".runtime"].includes(entry.name))scan(path);}else if(/\.(js|mjs)$/.test(entry.name))files.push(path);}}
scan(resolve(root,"plugin-ui"));scan(resolve(root,"scripts"));
for(const path of files){const result=spawnSync(process.execPath,["--check",path],{encoding:"utf8"});assert.equal(result.status,0,path+"\n"+result.stderr);}
console.log("Portable source contracts and "+files.length+" JavaScript syntax checks passed.");
