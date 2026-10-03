import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const files=readdirSync(new URL("./test/",import.meta.url)).filter((name)=>name.endsWith(".test.js")).map((name)=>fileURLToPath(new URL("./test/"+name,import.meta.url)));
const result=spawnSync(process.execPath,["--test",...files],{stdio:"inherit"});
process.exit(result.status ?? 1);
