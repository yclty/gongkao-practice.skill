import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { ensureService, request } from "./ensure-service.js";

const write={idempotency_key:z.string().min(1).describe("唯一写请求键；重试同操作沿用原键")};
const binding={binding_id:z.string().min(1).describe("从本地档案选择或初始化取得，不能猜测或替换")};
const session={...binding,...write,session_id:z.string().min(1),expected_revision:z.number().int().optional()};
const training={...binding,...write,session_mode:z.enum(["auto","resume","quick","chapter","route","set","review","paper","timeboxed"]).optional(),count:z.number().int().min(1).max(50).optional(),focus_module:z.string().optional(),focus_subtype:z.string().optional(),purpose:z.enum(["practice","foundation","diagnostic","review","assessment"]).optional(),paper_id:z.string().optional(),timing_mode:z.enum(["flexible","strict"]).optional(),available_minutes:z.number().positive().max(360).optional(),ignore_unfinished:z.boolean().optional()};
export function createLearningMcp(rpc,openUi) {
  const server=new McpServer({name:"gongkao-coach",version:"1.0.0"});
  const register=(name,description,inputSchema,readOnly=false)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false}},async(input)=>{
    try{const result=await rpc(name,input);return {content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result};}
    catch(error){return {isError:true,content:[{type:"text",text:JSON.stringify({code:error.code??"LOCAL_SERVICE_ERROR",message:error.message})}]};}
  });
  register("initialize_project_learning_state","在本机创建独立学习档案或已有学习者的新考试目标，自动保存；不要重复初始化现有档案",{...write,name:z.string().min(1).max(80),learner_id:z.string().optional(),exam_type:z.enum(["国考","省考","事业单位"]).optional(),province:z.string().optional()});
  register("get_learning_context","读取本地学习目标、画像、到期复习、未完成训练和报告。换聊天从这里继续",binding,true);
  register("get_question_bank_status","读取真实库存和完整可用试卷，库存不足时不要宣称可以开始",{},true);
  register("plan_training_session","从数据库最新进度安排下一轮。默认续接、复习、覆盖诊断或弱项；不要传入旧 state",{...binding,...Object.fromEntries(Object.entries(training).filter(([key])=>!["binding_id","idempotency_key"].includes(key)))},true);
  register("start_quiz_from_bank","从真实库存开始训练，每题正式提交会自动保存。专项不足明确返回缺口",training);
  register("start_paper_from_bank","启动经过总数、题号和资源验证的完整试卷；严格模拟须整卷提交",training);
  register("start_quiz_session","导入练习题或已校验 AI 变式，来源会标记为练习或 AI，不会冒充真题",{...training,questions:z.array(z.record(z.any())).min(1).max(150)});
  register("get_quiz_session","读取原训练当前题位与已保存结果，答案在正式提交前不会公开",{...binding,session_id:z.string()},true);
  register("submit_quiz_answer","对当前普通训练题正式判分并事务保存，重试不多计。使用返回的题位 ID",{...session,session_item_id:z.string(),question_id:z.string(),answer:z.union([z.string(),z.array(z.string())])});
  register("next_quiz_question","提交后进入下一题；最后一题后读取结果",session);
  register("pause_quiz_session","保存当前位置并暂停，未提交题不判错；严格模拟不允许暂停",session);
  register("resume_quiz_session","恢复同一个持久 session，保留已保存作答和草稿；不会重新 start 覆盖进度",session);
  register("save_quiz_draft","保存严格模拟答案或普通训练未提交草稿，不增加正式作答次数",{...session,slot:z.number().int().min(0),answer:z.union([z.string(),z.array(z.string())]).optional(),note:z.string().optional()});
  register("submit_paper_session","严格模拟整卷一次提交并保存；重试返回已有结果",session);
  register("set_quiz_error_code","记录错因建议或用户确认；AI 建议不进入正式错因统计，不重算作答次数",{...binding,...write,attempt_id:z.string(),error_code:z.enum(["K","M","U","R","C","D","T","G","S"]).nullable(),reasoning:z.string().optional(),error_source:z.enum(["ai_suggested","user_confirmed"]).default("ai_suggested"),confidence:z.number().min(0).max(1).optional()});
  register("configure_project_study_route","更新本地路线和偏好；有明确进度条件的基础过关才自动推进路线",{...binding,...write,name:z.string().optional(),steps:z.array(z.record(z.any())).optional(),study_preferences:z.record(z.any()).optional(),current_step_id:z.string().optional(),reset_to_default:z.boolean().optional(),expected_revision:z.number().int().optional()});
  register("get_progress_report","读取全程与 7/30 天真实趋势，含样本数量与限制，不估算上岸概率",binding,true);
  server.registerTool("open_learning_ui",{description:"打开本地网页选择档案、继续答题、整卷训练、查看报告或导出恢复备份。首次绑定从这里开始",inputSchema:{binding_id:z.string().optional(),session_id:z.string().optional()},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async(input)=>{const result=await openUi(input);return {content:[{type:"text",text:`本地学习入口：[打开考公学习网页](${result.ui_url})。请在网页选择自己的档案；与 AI 聊天共用自动保存的进度。`}],structuredContent:result};});
  return server;
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  await ensureService();
  const server=createLearningMcp(async(method,input)=>(await request(await ensureService(),"/rpc",{method,arguments:input})).result,async(input)=>request(await ensureService(),"/ticket",input));
  await server.connect(new StdioServerTransport());
}
