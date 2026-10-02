import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LocalStore, fail, parse, transaction, digest } from "./local-store.js";
import { createProjectLearningState, applyProjectLearningEvents } from "./project-state.js";
import { evaluateQuestion, publicQuestion, summarizeSession, ERROR_CODES } from "./quiz-core.js";
import { loadQuestionBank, questionBankCatalog, selectQuestions, selectPaper, toQuizQuestion } from "./question-provider.js";
import { planAdaptiveTraining, launcherForState } from "./adaptive-scheduler.js";
import { configureStudyRoute } from "./learning-route.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const inputCount = (value, fallback, max = 50) => {
  const count = Number(value ?? fallback);
  if (!Number.isInteger(count) || count < 1 || count > max) fail("INVALID_INPUT", `题量须为 1～${max} 的整数`);
  return count;
};

export class LearningService {
  constructor({ root, bankPath, assetDir, now = () => new Date() } = {}) {
    this.store = new LocalStore(root);
    this.now = now;
    this.instanceId = randomUUID();
    this.bankPath = bankPath;
    this.assetDir = assetDir;
    this.bank = bankPath ? loadQuestionBank(bankPath) : [];
    this.catalog = questionBankCatalog(this.bank, { limit: 200 });
    this.store.registry.exec("CREATE TABLE IF NOT EXISTS initializations(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,json TEXT NOT NULL)");
  }
  timestamp() { return this.now().toISOString(); }
  envelope(context, data) { return { api_version: 1, binding_id: context.id, goal_id: context.goal_id, revision: context.state.revision, save_status: "saved", ...data }; }
  initialize(input) {
    if (!input.idempotency_key) fail("INVALID_INPUT", "初始化需要唯一请求键");
    return transaction(this.store.registry, () => {
      const old = this.store.registry.prepare("SELECT * FROM initializations WHERE key=?").get(input.idempotency_key);
      if (old) { if (old.fingerprint !== digest(input)) fail("REVISION_CONFLICT", "初始化请求键已使用"); return JSON.parse(old.json); }
      const learnerId = input.learner_id ?? this.store.createLearner(input.name);
      const db = this.store.profile(learnerId);
      const state = createProjectLearningState({ goal: input.goal ?? { exam_targets: [input.exam_type ?? "省考"], province: input.province ?? null, timezone: "Asia/Shanghai" }, now: this.now() });
      db.prepare("INSERT INTO goals VALUES(?,?)").run(state.project_state_id, JSON.stringify(state));
      const result = { ...this.store.bind(learnerId, state.project_state_id), save_status: "saved", state };
      this.store.registry.prepare("INSERT INTO initializations VALUES(?,?,?)").run(input.idempotency_key,digest(input),JSON.stringify(result));
      return result;
    });
  }
  bankStatus() { return { configured: this.bank.length > 0, stats: this.catalog.stats, catalog: this.catalog, bank_version: this.bank[0]?.bank_version ?? "local", source: "本地题库，第三方导入题保留来源标记" }; }
  context(bindingId) {
    const context = this.store.context(bindingId);
    const sessions = context.db.prepare("SELECT json FROM sessions WHERE goal_id=? AND status IN ('ACTIVE','PAUSED') ORDER BY updated_at DESC LIMIT 20").all(context.goal_id).map(parse);
    const latest = sessions[0];
    context.state.unfinished_session = latest ? { session_id: latest.session_id, project_state_id: context.goal_id, remaining_questions: latest.questions.slice(latest.index).map((q) => q.question_id), selection_context: latest.selection_context } : null;
    return { ...context, sessions };
  }
  learningContext(bindingId) {
    const c = this.context(bindingId);
    const recent_full_attempts=c.db.prepare("SELECT json FROM attempts WHERE goal_id=? ORDER BY attempted_at DESC,rowid DESC LIMIT 10").all(c.goal_id).map(parse);
    return this.envelope(c, { learner_id: c.learner_id, state: c.state,recent_full_attempts,unfinished_sessions: c.sessions.map((s) => ({ session_id: s.session_id, mode: s.mode, status: s.status, answered: s.attempts.length, total: s.questions.length })), report: this.report(bindingId) });
  }
  plan(bindingId, input = {}) {
    const c = this.context(bindingId);
    const plan = planAdaptiveTraining(c.state, input, this.now());
    // Diagnose coverage before concentrating on one route module.
    const modules = plan.strategy==="baseline" ? this.catalog.modules.filter((m) => selectQuestions(this.bank,{...plan.question_request,count:3,targets:[{module:m.module,count:3}],exclude_question_ids:[]}).length>=3) : [];
    const missing = modules.find((m) => Object.values(c.state.ability_profile.subtypes).filter((s) => s.module === m.module).reduce((sum,s) => sum+s.sample_count,0) < 3);
    if (missing && plan.strategy === "baseline" && !input.focus_module) {
      plan.target = { module: missing.module, subtype: null, reason: "这个模块的诊断样本还不足" };
      plan.question_request.targets = [{ module: missing.module, count: 3 }];
      plan.user_message = `先用 3 题了解${missing.module}，样本充分后再安排弱项训练。`;
    }
    return this.envelope(c, { plan, launcher: launcherForState(c.state,input,this.bankStatus(),this.now()) });
  }
  preserveAssets(learnerId, questions) {
    const dir = join(this.store.root,"profiles",learnerId,"attachments");
    for (const q of questions) for (const match of JSON.stringify(q).matchAll(/\/bank-assets\/([a-f0-9]{64})/g)) {
      const source = this.assetDir && join(this.assetDir, match[1]);
      if (!source || !existsSync(source)) fail("RESOURCE_MISSING", "题目图片尚未离线准备，不能开始这题");
      mkdirSync(dir,{ recursive: true });
      const target = join(dir,match[1]);
      if (!existsSync(target)) copyFileSync(source,target);
    }
  }
  start(bindingId, input = {}) {
    const c = this.context(bindingId);
    const replay=c.db.prepare("SELECT * FROM requests WHERE key=?").get(`${c.goal_id}:${input.idempotency_key}`);
    if(replay) { if(replay.fingerprint!==digest({operation:"start",input})) fail("REVISION_CONFLICT","请求键已经使用");return JSON.parse(replay.json); }
    this.store.autoBackup(c.learner_id,()=>this.exportBackup(c.learner_id));
    if (!input.idempotency_key) fail("INVALID_INPUT", "开始训练需要请求键");
    const plan = this.plan(bindingId,input).plan;
    if ((input.session_mode === "resume" || plan.session_mode === "resume") && c.sessions[0] && !input.ignore_unfinished) return this.resume(bindingId,{ ...input, session_id: c.sessions[0].session_id });
    let questions, paper = null;
    const purpose = input.purpose ?? (input.session_mode === "review" || plan.strategy === "due_review_first" ? "review" : plan.strategy === "baseline" ? "diagnostic" : "practice");
    if(purpose==="foundation" && (!input.focus_module || !input.focus_subtype || input.focus_module===input.focus_subtype))fail("INVALID_INPUT","基础过关需要具体考点；模块级标签尚未细分，请做专项练习或用 AI 补充该考点题目");
    let reviewTask = null;
    if (input.questions) {
      if (!Array.isArray(input.questions) || input.questions.length > 150 || input.questions.length < 1) fail("INVALID_INPUT", "自导入题须为 1～150 题");
      questions = input.questions.map((q) => toQuizQuestion({ ...q, interactive_supported: true, source_type: q.source_type === "ai_variant" ? "ai_variant" : "practice" }));
    } else if (input.session_mode === "paper" || input.paper_id) {
      const selected = selectPaper(this.bank,{ paper_id: input.paper_id, exam_type: input.exam_type, province: input.province, require_complete: true });
      if (!selected) fail("BANK_INSUFFICIENT", "没有符合条件的完整可用试卷；请查看题库缺口或选择章节训练");
      ({ questions, paper } = selected);
    } else {
      const request = { ...plan.question_request, ...input, targets: input.targets ?? plan.question_request?.targets, exclude_question_ids: input.exclude_question_ids ?? c.state.recent_question_ids, source_types: ["official_real","platform_import","practice"] };
      request.count = inputCount(input.count, request.count ?? 3);
      if (input.focus_module) request.targets = [{ module: input.focus_module, subtype: input.focus_subtype, count: request.count }];
      if (purpose === "foundation") {
        if (!input.focus_subtype) fail("INVALID_INPUT", "基础过关需选择一个具体叶子考点");
        request.count = 15; request.targets = [{ module: input.focus_module, subtype: input.focus_subtype,count:15 }];
        request.exclude_question_ids = [];
      }
      if (purpose === "review") {
        reviewTask = c.state.review_queue.find((task) => task.due_at <= this.timestamp());
        if (!reviewTask) fail("BANK_INSUFFICIENT", "当前没有到期复习任务，可以继续路线训练");
        request.targets = [{ module: reviewTask.module, subtype: reviewTask.subtype === "UNKNOWN" ? undefined : reviewTask.subtype,count:request.count }];
        request.exclude_question_ids = [reviewTask.anchor_question_id];
        if(reviewTask.subtype === "UNKNOWN") {
          request.exclude_question_ids = this.bank.filter((q)=>q.question_id !== reviewTask.anchor_question_id).map((q)=>q.question_id);
          request.count=1;request.targets[0].count=1;
        }
      }
      request.practice_history=Object.fromEntries(c.db.prepare("SELECT question_id,COUNT(*) seen,MAX(attempted_at) last,SUM(1-correct) wrong FROM attempts WHERE goal_id=? GROUP BY question_id").all(c.goal_id).map((r)=>[r.question_id,r]));
      questions = selectQuestions(this.bank,request);
      if (questions.length < request.count) {
        const retried = selectQuestions(this.bank,{ ...request, exclude_question_ids: reviewTask?.subtype === "UNKNOWN" ? request.exclude_question_ids : [] });
        if (retried.length >= request.count) questions = retried;
        else fail("BANK_INSUFFICIENT", `目标库存不足：需要 ${request.count} 题，只有 ${retried.length} 道可用题；没有混入其他模块`);
      }
      if (reviewTask) { const sibling = questions.findIndex((q) => q.question_id !== reviewTask.anchor_question_id); if (sibling > 0) [questions[0],questions[sibling]] = [questions[sibling],questions[0]]; questions[0].review_task_id = reviewTask.review_task_id; }
    }
    if (new Set(questions.map((q) => q.question_id)).size !== questions.length) fail("INVALID_INPUT", "同一轮不能包含重复题号");
    if(purpose==="foundation" && (questions.length!==15 || questions.some((q)=>q.module!==input.focus_module||q.subtype!==input.focus_subtype)))fail("INVALID_INPUT","基础过关必须是指定模块、同一个考点的 15 道题");
    this.preserveAssets(c.learner_id,questions);
    return this.store.write(bindingId,"start",input,(ctx) => {
      const timestamp = this.timestamp();
      const strict = input.timing_mode === "strict";
      const minutes = Number(input.available_minutes ?? 120);
      if (strict && (!Number.isFinite(minutes) || minutes <= 0 || minutes > 360)) fail("INVALID_INPUT", "模拟时长须为 0～360 分钟之间");
      const session = { session_id: `session_${randomUUID()}`, goal_id: ctx.goal_id, learner_id: ctx.learner_id, mode: input.session_mode ?? plan.session_mode, purpose, status: "ACTIVE", revision:0, created_at:timestamp, updated_at:timestamp, started_at:timestamp, server_instance:this.instanceId, questions, index:0, attempts:[], drafts:{}, elapsed:{}, timing_mode:strict ? "strict" : "flexible", deadline:strict ? new Date(this.now().getTime()+minutes*60000).toISOString() : null, paper, selection_context: { ...plan.question_request, ...input, questions: undefined } };
      this.store.putSession(ctx.db,session);
      ctx.state.unfinished_session = { session_id:session.session_id,project_state_id:ctx.goal_id,remaining_questions:questions.map((q) => q.question_id) };
      ctx.state.revision += 1; this.store.putState(ctx.db,ctx.goal_id,ctx.state);
      return this.view(ctx,session);
    });
  }
  view(c, session) {
    if (["SUBMITTED","EXPIRED","COMPLETED","ABANDONED"].includes(session.status) && session.index >= session.questions.length) return this.envelope(c,{ view:"summary", session_id:session.session_id, session_revision:session.revision, payload:{ ...summarizeSession(session),status:session.status,total:session.questions.length,foundation_passed:session.foundation_passed ?? null,paper:session.paper,attempts:session.attempts,review:session.attempts.filter((a)=>!a.correct).map((a)=>({question:publicQuestion(session.questions[a.slot],a.slot,session.questions.length),feedback:a})) } });
    const q = session.questions[session.index];
    const attempt = session.attempts.find((a) => a.slot === session.index);
    return this.envelope(c,{ view:attempt ? "feedback" : "question",session_id:session.session_id,session_revision:session.revision,status:session.status,payload:{ question:{...publicQuestion(q,session.index,session.questions.length),subtype:attempt?q.subtype:null}, session_item_id:`${session.session_id}:${session.index}`, feedback:attempt ?? null, draft:session.drafts[session.index] ?? null,answer_sheet:session.timing_mode==="strict"?session.questions.map((_q,i)=>({slot:i,answer:session.drafts[i]?.answer??""})):undefined,timing_mode:session.timing_mode,deadline:session.deadline,paper:session.paper,purpose:session.purpose } });
  }
  checkActive(session) {
    if (session.timing_mode === "strict" && this.timestamp() >= session.deadline) fail("SESSION_EXPIRED", "考试时间已到，请提交整卷或查看最终结果");
    if (session.status !== "ACTIVE") fail("SESSION_PAUSED", "请先恢复训练");
  }
  saveAttempt(c, session, slot, answer, elapsedSeconds) {
    const q = session.questions[slot];
    const result = evaluateQuestion(q,answer,elapsedSeconds);
    const attempt = { ...result,bank_version:q.bank_version,question_version:q.question_version,reasoning:session.drafts[slot]?.note??"",attempt_id:`attempt_${randomUUID()}`, session_id:session.session_id,slot, question_id:q.question_id,module:q.module,subtype:q.subtype ?? "UNKNOWN",source_type:q.source_type,review_task_id:q.review_task_id ?? null,attempted_at:this.timestamp() };
    c.db.prepare("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)").run(attempt.attempt_id,c.goal_id,session.session_id,slot,q.question_id,attempt.attempted_at,Number(attempt.correct),JSON.stringify(attempt));
    session.attempts.push(attempt);
    c.state = applyProjectLearningEvents(c.state,[attempt],{ now:this.now() }).state;
    return attempt;
  }
  complete(c, session) {
    if (session.purpose === "foundation" && session.questions.length === 15) {
      const key = `${session.questions[0].module}::${session.questions[0].subtype}`;
      session.foundation_passed = session.attempts.filter((a) => a.correct).length >= 9;
      c.state.foundation_passes ??= {};
      if (session.foundation_passed && !c.state.foundation_passes[key]) {
        c.state.foundation_passes[key] = { session_id:session.session_id,passed_at:this.timestamp() };
        const steps = c.state.study_route.steps;
        for (const step of steps) {
          if (step.module !== session.questions[0].module || (step.subtype && step.subtype !== session.questions[0].subtype)) continue;
          step.completed_sessions += 1;
          const leaves = [...new Set(this.bank.filter((q) => q.module === step.module && q.subtype && q.interactive_supported).map((q) => q.subtype))].filter((tag) => this.bank.filter((q) => q.module === step.module && q.subtype === tag && q.interactive_supported).length >= 15);
          if (step.subtype || (leaves.length && leaves.every((tag) => c.state.foundation_passes[`${step.module}::${tag}`]))) step.status = "done";
        }
        const next = steps.find((step) => step.status !== "done");
        if (next) { next.status="active"; c.state.study_route.current_step_id=next.id; }
      }
    }
    c.state.last_session_summary = { ...summarizeSession(session),session_id:session.session_id,saved_at:this.timestamp() };
    if (c.state.unfinished_session?.session_id === session.session_id) c.state.unfinished_session = null;
  }
  mutate(bindingId,operation,input,work) {
    const context=this.store.context(bindingId);
    this.store.autoBackup(context.learner_id,()=>this.exportBackup(context.learner_id));
    return this.store.write(bindingId,operation,input,(c) => {
      const session=this.store.getSession(c,input.session_id);
      if (input.expected_revision !== undefined && input.expected_revision !== session.revision) fail("REVISION_CONFLICT","训练已更新，请读取当前结果");
      if(session.timing_mode !== "strict" && session.server_instance !== this.instanceId) { session.started_at=this.timestamp();session.server_instance=this.instanceId; }
      const result=work(c,session);
      session.updated_at=this.timestamp(); session.revision+=1;
      this.store.putSession(c.db,session); this.store.putState(c.db,c.goal_id,c.state);
      return result ?? this.view(c,session);
    });
  }
  submit(bindingId,input) {
    return this.mutate(bindingId,"answer",input,(c,s) => {
      if (s.timing_mode === "strict") fail("INVALID_INPUT","严格模拟请保存草稿，再一次提交整卷");
      const slot=s.questions.findIndex((q,i) => `${s.session_id}:${i}` === input.session_item_id && q.question_id === input.question_id);
      if (slot < 0) fail("INVALID_INPUT","题位和题号不匹配");
      const existing=s.attempts.find((a) => a.slot === slot);
      if (existing) {
        if (evaluateQuestion(s.questions[slot],input.answer,0).answer !== existing.answer) fail("REVISION_CONFLICT","该题已正式提交，不能改写答案");
        return this.envelope(c,{ view:"feedback",session_id:s.session_id,payload:{ question:publicQuestion(s.questions[slot],slot,s.questions.length),feedback:existing,session_item_id:input.session_item_id } });
      }
      this.checkActive(s);
      if (slot !== s.index) fail("REVISION_CONFLICT","请提交当前题位");
      const seconds=Math.max(0,(s.elapsed[slot] ?? 0)+(this.now().getTime()-new Date(s.started_at).getTime())/1000);
      this.saveAttempt(c,s,slot,input.answer,seconds);
      if (s.attempts.length === s.questions.length) { s.status="COMPLETED"; this.complete(c,s); }
    });
  }
  next(bindingId,input) {
    return this.mutate(bindingId,"next",input,(_c,s) => {
      if (s.timing_mode !== "strict" && !s.attempts.some((a) => a.slot === s.index)) fail("INVALID_INPUT","请先提交当前题");
      if (s.status === "PAUSED") fail("SESSION_PAUSED","请恢复后继续");
      s.index=Math.min(s.timing_mode==="strict"?s.questions.length-1:s.questions.length,s.index+1); s.started_at=this.timestamp();
    });
  }
  pause(bindingId,input) {
    return this.mutate(bindingId,"pause",input,(_c,s) => {
      if (s.timing_mode === "strict") fail("INVALID_INPUT","严格模拟不能暂停");
      if (s.status === "ACTIVE") { s.elapsed[s.index]=(s.elapsed[s.index] ?? 0)+Math.max(0,(this.now().getTime()-new Date(s.started_at).getTime())/1000); s.status="PAUSED"; }
    });
  }
  resume(bindingId,input) {
    return this.mutate(bindingId,"resume",input,(c,s) => {
      if (s.timing_mode === "strict" && this.timestamp() >= s.deadline) return this.finalizePaper(c,s,true);
      if (s.status === "PAUSED" || s.status === "ACTIVE") {
        if(s.status === "ACTIVE" && s.server_instance === this.instanceId && !s.attempts.some((a)=>a.slot===s.index)) s.elapsed[s.index]=(s.elapsed[s.index]??0)+Math.max(0,(this.now().getTime()-new Date(s.started_at).getTime())/1000);
        s.status="ACTIVE"; s.started_at=this.timestamp();s.server_instance=this.instanceId;
      }
    });
  }
  draft(bindingId,input) {
    return this.mutate(bindingId,"draft",input,(_c,s) => {
      this.checkActive(s);
      const slot=Number(input.slot);
      if (!Number.isInteger(slot) || slot<0 || slot>=s.questions.length) fail("INVALID_INPUT","题位错误");
      if (s.attempts.some((a) => a.slot === slot)) fail("REVISION_CONFLICT","已正式提交题不能改草稿");
      evaluateQuestion(s.questions[slot],input.answer ?? "",0);
      s.drafts[slot]={ answer:input.answer ?? "",note:String(input.note ?? "").slice(0,10000),saved_at:this.timestamp() };
      if(s.timing_mode !== "strict" && slot===s.index) {s.elapsed[slot]=(s.elapsed[slot]??0)+Math.max(0,(this.now().getTime()-new Date(s.started_at).getTime())/1000);s.started_at=this.timestamp();}
      if (s.timing_mode === "strict") s.index=slot;
    });
  }
  finalizePaper(c,s,expired) {
    if (["SUBMITTED","EXPIRED"].includes(s.status)) return;
    for(let slot=0;slot<s.questions.length;slot++) this.saveAttempt(c,s,slot,s.drafts[slot]?.answer ?? "",null);
    s.status=expired ? "EXPIRED" : "SUBMITTED"; s.index=s.questions.length; this.complete(c,s);
  }
  submitPaper(bindingId,input) {
    return this.mutate(bindingId,"paper_submit",input,(c,s) => {
      if (s.timing_mode !== "strict") fail("INVALID_INPUT","此训练不是严格模拟");
      this.finalizePaper(c,s,this.timestamp()>=s.deadline);
    });
  }
  annotate(bindingId,input) {
    return this.store.write(bindingId,"annotation",input,(c) => {
      if (!ERROR_CODES.includes(input.error_code) && input.error_code !== null) fail("INVALID_INPUT","错因代码无效");
      const row=c.db.prepare("SELECT * FROM attempts WHERE id=? AND goal_id=?").get(input.attempt_id,c.goal_id);
      if (!row) fail("OWNER_MISMATCH","作答记录不属于当前目标");
      const attempt=parse(row);
      const source=input.error_source ?? "ai_suggested";
      if(!["ai_suggested","user_confirmed"].includes(source)) fail("INVALID_INPUT","错因来源无效");
      const reasoning=String(input.reasoning ?? attempt.reasoning ?? "").slice(0,10000);
      if(source==="ai_suggested") {
        const confidence=Number(input.confidence ?? 0.5);
        if(!Number.isFinite(confidence)||confidence<0||confidence>1) fail("INVALID_INPUT","错因置信度须在 0 到 1 之间");
        attempt.error_suggestion={error_code:input.error_code,reasoning,confidence,suggested_at:this.timestamp()};
      } else { attempt.error_code=input.error_code;attempt.reasoning=reasoning;attempt.error_source=source; }
      c.db.prepare("UPDATE attempts SET json=? WHERE id=?").run(JSON.stringify(attempt),attempt.attempt_id);
      const session=this.store.getSession(c,row.session_id); const index=session.attempts.findIndex((a)=>a.attempt_id===attempt.attempt_id);session.attempts[index]=attempt;this.store.putSession(c.db,session);
      const recent=c.state.recent_attempts.find((a)=>a.attempt_id===attempt.attempt_id);if(recent&&source==="user_confirmed") recent.error_code=input.error_code;
      const profile=c.state.ability_profile.subtypes[`${attempt.module}::${attempt.subtype}`];
      if(profile&&source==="user_confirmed") {
        const sample=profile.recent_samples.find((a)=>a.attempt_id===attempt.attempt_id || (!a.attempt_id&&a.question_id===attempt.question_id&&a.attempted_at===attempt.attempted_at));
        if(sample){sample.attempt_id=attempt.attempt_id;sample.error_code=input.error_code;}
        const counts={};for(const a of profile.recent_samples)if(a.error_code)counts[a.error_code]=(counts[a.error_code]??0)+1;profile.error_counts_30=counts;
      }
      c.state.revision++;this.store.putState(c.db,c.goal_id,c.state);return this.envelope(c,{ attempt });
    });
  }
  configure(bindingId,input) {
    return this.store.write(bindingId,"route",input,(c)=>{
      if(input.expected_revision!==undefined && input.expected_revision!==c.state.revision) fail("REVISION_CONFLICT","路线已经更新");
      const safeInput={...input,steps:input.steps?.map((step)=>({id:step.id,module:step.module,subtype:step.subtype,title:step.title,target_sessions:step.target_sessions}))};
      const oldSteps=c.state.study_route.steps;
      c.state=configureStudyRoute(c.state,safeInput,this.now()).state;
      for(const step of c.state.study_route.steps) {
        const prior=oldSteps.find((old)=>old.module===step.module && old.subtype===step.subtype);
        if(prior) {step.completed_sessions=prior.completed_sessions;if(prior.status==="done")step.status="done";}
      }
      this.store.putState(c.db,c.goal_id,c.state);return this.envelope(c,{ state:c.state });
    });
  }
  report(bindingId) {
    const c=this.store.context(bindingId);const total=c.db.prepare("SELECT COUNT(*) total,COALESCE(SUM(correct),0) correct FROM attempts WHERE goal_id=?").get(c.goal_id);
    const windows={};for(const days of [7,30]) { const since=new Date(this.now().getTime()-days*86400000).toISOString(); const rows=c.db.prepare("SELECT json FROM attempts WHERE goal_id=? AND attempted_at>=?").all(c.goal_id,since).map(parse);windows[days]={ sample_count:rows.length,accuracy:rows.length?rows.filter((a)=>a.correct).length/rows.length:null,avg_seconds:rows.filter((a)=>Number.isFinite(a.elapsed_seconds)).length?rows.filter((a)=>Number.isFinite(a.elapsed_seconds)).reduce((sum,a)=>sum+a.elapsed_seconds,0)/rows.filter((a)=>Number.isFinite(a.elapsed_seconds)).length:null }; }
    return { total_attempts:total.total,correct:total.correct,accuracy:total.total?total.correct/total.total:null,windows,modules:Object.values(c.state.ability_profile.subtypes),due_review_count:c.state.review_queue.filter((t)=>t.due_at<=this.timestamp()).length,foundation_passes:c.state.foundation_passes ?? {},limitations:["仅反映本地已提交作答；不同题源和模式不直接等同", "未校准速度的题标记为 unknown，样本不足不估算上岸概率"] };
  }
  exportBackup(learnerId) {
    const backup=this.store.backup(learnerId); const dir=join(this.store.root,"profiles",learnerId,"attachments"); const assets={};
    if(existsSync(dir)) for(const name of readdirSync(dir)) if(/^[a-f0-9]{64}$/.test(name)) assets[name]=readFileSync(join(dir,name)).toString("base64");
    const payload={ ...backup,assets };delete payload.checksum;return { ...payload,checksum:digest(payload) };
  }
  importBackup(input,key,locked=false) {
    if(key&&!locked)return transaction(this.store.registry,()=>this.importBackup(input,key,true));
    if(key) {
      if(typeof key!=="string"||key.length>200)fail("INVALID_INPUT","恢复请求键无效");
      const old=this.store.registry.prepare("SELECT * FROM initializations WHERE key=?").get("restore:"+key);
      if(old){if(old.fingerprint!==digest(input))fail("REVISION_CONFLICT","恢复请求键已使用");return JSON.parse(old.json);}
    }
    const { checksum, ...payload }=input ?? {};if(digest(payload)!==checksum) fail("BACKUP_INVALID","备份校验失败");
    for(const [name,value] of Object.entries(payload.assets ?? {})) if(!/^[a-f0-9]{64}$/.test(name)||typeof value!=="string"||value.length>14000000) fail("BACKUP_INVALID","备份资源无效");
    const base={ ...payload };delete base.assets;const result=this.store.restore({ ...base,checksum:digest(base) });
    const dir=join(this.store.root,"profiles",result.learner_id,"attachments");mkdirSync(dir,{ recursive:true });for(const [name,value] of Object.entries(payload.assets ?? {})) writeFileSync(join(dir,name),Buffer.from(value,"base64"));
    if(key)this.store.registry.prepare("INSERT INTO initializations VALUES(?,?,?)").run("restore:"+key,digest(input),JSON.stringify(result));
    return result;
  }
  importLegacy(input) {
    const old=input.state;
    if(old?.schema_version!=="0.7" || typeof old.project_state_id!=="string" || !old.project_state_id.startsWith("ps_")) fail("INVALID_INPUT","只支持合法的 v0.7 / v0.9 Project 状态 JSON");
    const result=this.initialize({name:input.name??"旧学习档案",goal:old.goal,idempotency_key:input.idempotency_key});
    return this.store.write(result.binding_id,"legacy_import",input,(c)=>{
      c.state.legacy_snapshot={source_project_id:old.project_state_id,imported_at:this.timestamp(),ability_profile:old.ability_profile,review_queue:old.review_queue,notice:"旧累计数据未包含可验证完整作答，保留为历史快照，不重放进正式次数"};
      if(Array.isArray(old.study_route?.steps)) c.state=configureStudyRoute(c.state,{steps:old.study_route.steps.map((step)=>({module:step.module,subtype:step.subtype,title:step.title})),study_preferences:old.study_preferences},this.now()).state;
      this.store.putState(c.db,c.goal_id,c.state);return {binding_id:result.binding_id,learner_id:result.learner_id,goal_id:result.goal_id,save_status:"saved",notice:c.state.legacy_snapshot.notice};
    });
  }
  close() { this.store.close(); }
}
