import {LocalStore} from "../../lib/local-store.js";
const store=new LocalStore(process.argv[2]),c=store.context(process.argv[3]);
c.db.exec("BEGIN IMMEDIATE");
c.db.prepare("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)").run("partial",c.goal_id,process.argv[4],0,"partial-question",new Date().toISOString(),1,"{}");
c.state.recent_attempts.push({question_id:"partial-question",correct:true});
store.putState(c.db,c.goal_id,c.state);
process.send({inside_transaction:true});
setInterval(()=>{},1000);
