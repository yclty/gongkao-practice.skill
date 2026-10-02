import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  ERROR_CODES,
  evaluateQuestion,
  publicQuestion,
  summarizeSession,
} from "./lib/quiz-core.js";
import {
  bankStats,
  loadQuestionBank,
  questionBankCatalog,
  selectPaper,
  selectQuestions,
} from "./lib/question-provider.js";
import {
  applyProjectLearningEvents,
  assertSessionProjectMatch,
  createProjectLearningState,
} from "./lib/project-state.js";
import {
  launcherForState,
  planAdaptiveTraining,
} from "./lib/adaptive-scheduler.js";
import { configureStudyRoute } from "./lib/learning-route.js";

const widgetHtml = readFileSync(new URL("./public/quiz-widget.html", import.meta.url), "utf8");
const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sourceTypeSchema = z.enum(["official_real", "platform_import", "ai_variant", "practice", "real"]);

const optionSchema = z.object({
  label: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1),
});

const questionSchema = z.object({
  question_id: z.string().min(1),
  module: z.string().min(1),
  subtype: z.string().optional(),
  source_type: sourceTypeSchema.optional(),
  stem: z.string().min(1),
  material: z.string().optional(),
  options: z.array(optionSchema).min(2).max(6),
  correct_answer: z.enum(["A", "B", "C", "D"]),
  target_seconds: z.number().positive().optional(),
  fastest_method: z.string().optional(),
  explanation_short: z.string().optional(),
  explanation_full: z.string().optional(),
});

const outputSchema = {
  view: z.enum(["question", "feedback", "summary", "error"]),
  session_id: z.string(),
  payload: z.record(z.any()),
};

function now() {
  return Date.now();
}

function pruneSessions() {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [id, session] of sessions.entries()) {
    if (session.last_access_at < cutoff) sessions.delete(id);
  }
}

function touch(session) {
  session.last_access_at = now();
}

function reply(view, sessionId, payload, message = "") {
  return {
    content: message ? [{ type: "text", text: message }] : [],
    structuredContent: {
      view,
      session_id: sessionId,
      payload,
    },
  };
}

function errorReply(sessionId, message) {
  return reply("error", sessionId || "unknown", { message }, message);
}

function getSession(sessionId) {
  pruneSessions();
  const session = sessions.get(sessionId);
  if (session) touch(session);
  return session;
}

function createSession(questions, sessionId, projectStateId = null, selectionContext = null) {
  pruneSessions();
  const id = sessionId?.trim() || randomUUID();
  const session = {
    id,
    questions,
    project_state_id: projectStateId,
    selection_context: selectionContext,
    index: 0,
    attempts: [],
    created_at: now(),
    last_access_at: now(),
  };
  sessions.set(id, session);
  return session;
}

function currentQuestion(session) {
  return session.questions[session.index] ?? null;
}

function currentAttempt(session) {
  const q = currentQuestion(session);
  if (!q) return null;
  return session.attempts.find((item) => item.question_id === q.question_id) ?? null;
}

function questionPayload(session) {
  const q = currentQuestion(session);
  if (!q) return null;
  return {
    project_state_id: session.project_state_id,
    question: publicQuestion(q, session.index, session.questions.length),
    stats: summarizeSession(session),
  };
}

function feedbackPayload(session) {
  const q = currentQuestion(session);
  const attempt = currentAttempt(session);
  if (!q || !attempt) return null;
  return {
    project_state_id: session.project_state_id,
    question: publicQuestion(q, session.index, session.questions.length),
    result: {
      answer: attempt.answer,
      correct: attempt.correct,
      correct_answer: attempt.correct_answer,
      elapsed_seconds: attempt.elapsed_seconds,
      speed_status: attempt.speed_status,
      error_code: attempt.error_code ?? null,
      fastest_method: attempt.fastest_method,
      explanation_short: attempt.explanation_short,
      explanation_full: attempt.explanation_full,
    },
    error_codes: ERROR_CODES,
    stats: summarizeSession(session),
  };
}

function summaryPayload(session) {
  return {
    project_state_id: session.project_state_id,
    stats: summarizeSession(session),
    total_questions: session.questions.length,
    completed: session.index >= session.questions.length - 1,
    attempts: session.attempts.map((item) => ({
      question_id: item.question_id,
      module: item.module,
      subtype: item.subtype ?? null,
      source_type: item.source_type ?? "practice",
      exam_type: item.exam_type ?? null,
      correct: item.correct,
      elapsed_seconds: item.elapsed_seconds,
      speed_status: item.speed_status,
      error_code: item.error_code ?? null,
    })),
  };
}


function pausePayload(session) {
  const current = currentQuestion(session);
  const currentAnswered = Boolean(currentAttempt(session));
  const startIndex = currentAnswered ? session.index + 1 : session.index;
  const remaining = session.questions.slice(startIndex).map((item) => item.question_id);

  return {
    ...summaryPayload(session),
    paused: true,
    completed: false,
    unfinished_session: {
      project_state_id: session.project_state_id,
      source_session_id: session.id,
      target: session.selection_context?.target ?? null,
      selection_context: session.selection_context ?? null,
      current_question_id: currentAnswered ? null : current?.question_id ?? null,
      remaining_questions: remaining,
      answered_questions: session.attempts.length,
      paused_at: new Date().toISOString()
    }
  };
}


function getQuestionBankStatus() {
  const path = process.env.QUESTION_BANK_PATH;
  if (!path) {
    return {
      configured: false,
      code: "QUESTION_BANK_NOT_CONFIGURED",
      message: "真题库未接入当前运行时；这与个人能力画像数据不足是两件事。",
      stats: null,
      catalog: null,
    };
  }

  try {
    const bank = loadQuestionBank(path);
    const catalog = questionBankCatalog(bank, { limit: 60 });
    return {
      configured: true,
      code: "QUESTION_BANK_READY",
      message: `题库已加载：${catalog.stats.interactive_supported} 道可交互题，${catalog.stats.papers} 套试卷。`,
      stats: catalog.stats,
      catalog,
    };
  } catch (error) {
    return {
      configured: false,
      code: "QUESTION_BANK_LOAD_FAILED",
      message: error instanceof Error ? error.message : "题库加载失败。",
      stats: null,
      catalog: null,
    };
  }
}

function createQuizServer() {
  const server = new McpServer({
    name: "gongkao-quiz",
    version: "0.9.0",
  });

  registerAppResource(
    server,
    "gongkao-quiz-widget",
    "ui://gongkao/quiz-v0.9.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://gongkao/quiz-v0.9.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: []
              }
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "start_quiz_session",
    {
      title: "Start gongkao quiz session",
      description:
        "Starts a short multiple-choice training session and renders the interactive quiz card. Use after the coach has selected the questions for the user's current time budget.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        project_state_id: z.string().startsWith("ps_").optional(),
        questions: z.array(questionSchema).min(1).max(200),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.9.html" },
      },
    },
    async ({ session_id, project_state_id, questions }) => {
      const session = createSession(
        questions,
        session_id,
        project_state_id ?? null,
        { source: "direct" }
      );
      return reply("question", session.id, questionPayload(session), "Quiz session started.");
    }
  );

  registerAppTool(
    server,
    "start_quiz_from_bank",
    {
      title: "Start quiz from local question bank",
      description:
        "Selects single-choice questions from the configured local canonical question bank using scheduler targets, exclusions, exam filters, and source provenance, then starts the interactive quiz session.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        project_state_id: z.string().startsWith("ps_").optional(),
        count: z.number().int().min(1).max(50).default(5),
        targets: z.array(
          z.object({
            module: z.string().min(1).optional(),
            subtype: z.string().min(1).optional(),
            count: z.number().int().min(1).max(50),
          })
        ).max(10).optional(),
        exclude_question_ids: z.array(z.string().min(1)).max(5000).optional(),
        source_types: z.array(sourceTypeSchema).max(5).optional(),
        exam_type: z.string().min(1).optional(),
        province: z.string().min(1).optional(),
        year_min: z.number().int().min(1990).max(2100).optional(),
        year_max: z.number().int().min(1990).max(2100).optional(),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.9.html" },
      },
    },
    async (input) => {
      try {
        const bank = loadQuestionBank(process.env.QUESTION_BANK_PATH);
        const questions = selectQuestions(bank, input);
        if (!questions.length) {
          return errorReply(input.session_id, "No compatible questions matched the current bank filters.");
        }
        const session = createSession(
          questions,
          input.session_id,
          input.project_state_id ?? null,
          {
            source: "bank",
            target: input.targets?.[0] ?? null,
            filters: {
              exam_type: input.exam_type ?? null,
              province: input.province ?? null,
              year_min: input.year_min ?? null,
              year_max: input.year_max ?? null,
              source_types: input.source_types ?? null
            }
          }
        );
        return reply(
          "question",
          session.id,
          {
            ...questionPayload(session),
            bank_selection: {
              requested_count: input.count,
              selected_count: questions.length,
              source: "QUESTION_BANK_PATH"
            }
          },
          `Started a quiz with ${questions.length} question(s) from the local bank.`
        );
      } catch (error) {
        return errorReply(
          input.session_id,
          error instanceof Error ? error.message : "Question bank selection failed."
        );
      }
    }
  );


  registerAppTool(
    server,
    "start_paper_from_bank",
    {
      title: "Start a real paper from the question bank",
      description:
        "Starts one complete imported exam paper from the configured canonical question bank. Use for full-paper practice when the learner chooses 做一套真题试卷.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        project_state_id: z.string().startsWith("ps_").optional(),
        paper_id: z.string().min(1).optional(),
        source_types: z.array(sourceTypeSchema).max(5).optional(),
        exam_type: z.string().min(1).optional(),
        province: z.string().min(1).optional(),
        year_min: z.number().int().min(1990).max(2100).optional(),
        year_max: z.number().int().min(1990).max(2100).optional(),
        require_complete: z.boolean().optional(),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.9.html" },
      },
    },
    async (input) => {
      try {
        const bank = loadQuestionBank(process.env.QUESTION_BANK_PATH);
        const selected = selectPaper(bank, {
          ...input,
          require_complete: input.require_complete !== false,
        });
        if (!selected?.questions?.length) {
          return errorReply(
            input.session_id,
            "No complete interactive paper matched the current filters."
          );
        }

        const session = createSession(
          selected.questions,
          input.session_id,
          input.project_state_id ?? null,
          {
            source: "paper",
            paper: selected.paper,
            filters: {
              exam_type: input.exam_type ?? null,
              province: input.province ?? null,
              year_min: input.year_min ?? null,
              year_max: input.year_max ?? null,
            },
          }
        );

        return reply(
          "question",
          session.id,
          {
            ...questionPayload(session),
            paper_selection: selected.paper,
          },
          `Started paper: ${selected.paper.title} (${selected.paper.interactive_questions} questions).`
        );
      } catch (error) {
        return errorReply(
          input.session_id,
          error instanceof Error ? error.message : "Question paper selection failed."
        );
      }
    }
  );

  registerAppTool(
    server,
    "submit_quiz_answer",
    {
      title: "Submit quiz answer",
      description:
        "Grades the current multiple-choice answer for an active gongkao quiz session. Usually called by the embedded quiz UI.",
      inputSchema: {
        session_id: z.string().min(1),
        question_id: z.string().min(1),
        answer: z.enum(["A", "B", "C", "D"]),
        elapsed_seconds: z.number().nonnegative().optional(),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.9.html" },
      },
    },
    async ({ session_id, question_id, answer, elapsed_seconds }) => {
      const session = getSession(session_id);
      if (!session) return errorReply(session_id, "Session expired or was not found.");
      const q = currentQuestion(session);
      if (!q || q.question_id !== question_id) {
        return errorReply(session_id, "Question is no longer active.");
      }
      const existing = currentAttempt(session);
      if (existing) return reply("feedback", session_id, feedbackPayload(session));

      const result = evaluateQuestion(q, answer, elapsed_seconds);
      session.attempts.push({
        question_id: q.question_id,
        module: q.module,
        subtype: q.subtype ?? null,
        source_type: q.source_type ?? "practice",
        exam_type: q.provenance?.exam_type ?? null,
        ...result,
      });
      return reply(
        "feedback",
        session_id,
        feedbackPayload(session),
        result.correct ? "Correct." : "Incorrect."
      );
    }
  );

  registerAppTool(
    server,
    "set_quiz_error_code",
    {
      title: "Set quiz error code",
      description:
        "Records the learner's corrected primary error code for the current answer. Usually called from the quiz UI after an incorrect answer.",
      inputSchema: {
        session_id: z.string().min(1),
        question_id: z.string().min(1),
        error_code: z.enum(ERROR_CODES),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.9.html" },
      },
    },
    async ({ session_id, question_id, error_code }) => {
      const session = getSession(session_id);
      if (!session) return errorReply(session_id, "Session expired or was not found.");
      const q = currentQuestion(session);
      const attempt = currentAttempt(session);
      if (!q || q.question_id !== question_id || !attempt) {
        return errorReply(session_id, "No graded current question was found.");
      }
      attempt.error_code = error_code;
      return reply("feedback", session_id, feedbackPayload(session), "Error code updated.");
    }
  );

  registerAppTool(
    server,
    "next_quiz_question",
    {
      title: "Next quiz question",
      description:
        "Advances an active gongkao quiz session to the next question, or returns the session summary when complete. Usually called by the embedded quiz UI.",
      inputSchema: {
        session_id: z.string().min(1),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.9.html" },
      },
    },
    async ({ session_id }) => {
      const session = getSession(session_id);
      if (!session) return errorReply(session_id, "Session expired or was not found.");
      if (!currentAttempt(session)) {
        return errorReply(session_id, "Submit the current answer before continuing.");
      }

      if (session.index >= session.questions.length - 1) {
        return reply("summary", session_id, summaryPayload(session), "Quiz session completed.");
      }

      session.index += 1;
      return reply("question", session_id, questionPayload(session), "Next question.");
    }
  );



  registerAppTool(
    server,
    "pause_quiz_session",
    {
      title: "Pause quiz session",
      description:
        "Pauses the current quiz at any point and returns attempts plus an unfinished-session descriptor that the current Project can persist for later continuation.",
      inputSchema: {
        session_id: z.string().min(1),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.9.html" },
      },
    },
    async ({ session_id }) => {
      const session = getSession(session_id);
      if (!session) return errorReply(session_id, "Session expired or was not found.");
      return reply(
        "summary",
        session_id,
        pausePayload(session),
        "Quiz paused. Save unfinished_session in the current Project to continue later."
      );
    }
  );



  server.registerTool(
    "get_question_bank_status",
    {
      title: "Get question bank status",
      description:
        "Reports whether the canonical question bank is configured and returns available modules, subtypes, and imported papers. Use this to distinguish missing personal learning history from missing question-bank data.",
      inputSchema: {
        include_catalog: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false
      },
    },
    async ({ include_catalog }) => {
      const status = getQuestionBankStatus();
      const structuredContent = include_catalog
        ? status
        : {
            configured: status.configured,
            code: status.code,
            message: status.message,
            stats: status.stats,
          };
      return {
        content: [{ type: "text", text: status.message }],
        structuredContent,
      };
    }
  );

  server.registerTool(
    "configure_project_study_route",
    {
      title: "Configure Project study route",
      description:
        "Pure Project-state reducer for customizing the learner's route and study-scene preferences. It returns a new state but does not persist user data on the MCP server.",
      inputSchema: {
        state: z.record(z.any()),
        project_state_id: z.string().startsWith("ps_"),
        name: z.string().min(1).optional(),
        exam_type: z.string().min(1).optional(),
        reset_to_default: z.boolean().optional(),
        current_step_id: z.string().min(1).optional(),
        steps: z.array(
          z.object({
            id: z.string().min(1).optional(),
            module: z.string().min(1),
            subtype: z.string().nullable().optional(),
            title: z.string().min(1).optional(),
            target_sessions: z.number().int().positive().nullable().optional(),
          })
        ).max(50).optional(),
        study_preferences: z.record(z.any()).optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false
      },
    },
    async ({
      state,
      project_state_id,
      name,
      exam_type,
      reset_to_default,
      current_step_id,
      steps,
      study_preferences,
    }) => {
      try {
        assertSessionProjectMatch(state, project_state_id);
        const result = configureStudyRoute(state, {
          name,
          exam_type,
          reset_to_default,
          current_step_id,
          steps,
          study_preferences,
        });
        return {
          content: [{
            type: "text",
            text: `学习路线已生成新版本（revision ${result.state.revision}），请保存回当前 Project。`
          }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: error instanceof Error ? error.message : "Study route update failed."
          }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "plan_training_session",
    {
      title: "Plan adaptive training",
      description:
        "Creates a start-first, interruptible training plan from the current Project state. Time is optional; normal use can simply start and pause whenever needed.",
      inputSchema: {
        state: z.record(z.any()),
        intent: z.enum(["start", "review", "focus"]).optional(),
        session_mode: z.enum(["auto", "quick", "route", "chapter", "set", "paper", "review", "resume"]).optional(),
        study_context: z.enum(["auto", "fragmented", "deep", "neutral"]).optional(),
        local_hour: z.number().int().min(0).max(23).optional(),
        local_weekday: z.number().int().min(0).max(6).optional(),
        count: z.number().int().min(1).max(200).optional(),
        paper_id: z.string().min(1).optional(),
        exam_type: z.string().min(1).optional(),
        province: z.string().min(1).optional(),
        year_min: z.number().int().min(1990).max(2100).optional(),
        year_max: z.number().int().min(1990).max(2100).optional(),
        available_minutes: z.number().positive().max(180).optional(),
        focus_module: z.string().min(1).optional(),
        focus_subtype: z.string().min(1).optional(),
        ignore_unfinished: z.boolean().optional(),
        include_launcher: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false
      },
    },
    async (input) => {
      try {
        assertSessionProjectMatch(input.state, input.state.project_state_id);
        const bankStatus = getQuestionBankStatus();
        const plan = planAdaptiveTraining(input.state, input);
        const launcher = input.include_launcher
          ? launcherForState(input.state, input, bankStatus)
          : null;
        return {
          content: [{ type: "text", text: plan.user_message }],
          structuredContent: {
            plan,
            launcher,
            bank_status: {
              configured: bankStatus.configured,
              code: bankStatus.code,
              message: bankStatus.message,
              stats: bankStatus.stats,
            },
          },
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: error instanceof Error ? error.message : "Training planning failed."
          }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "initialize_project_learning_state",
    {
      title: "Initialize Project learning state",
      description:
        "Creates a new independent learning-state document for the current ChatGPT Project. The returned state must be saved by the host in that Project; the MCP server does not persist it.",
      inputSchema: {
        goal: z.record(z.any()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
    },
    async ({ goal }) => {
      const state = createProjectLearningState({ goal: goal ?? {} });
      return {
        content: [{
          type: "text",
          text: `Initialized independent Project learning state ${state.project_state_id}.`
        }],
        structuredContent: {
          project_state_id: state.project_state_id,
          state,
        },
      };
    }
  );

  server.registerTool(
    "apply_project_learning_events",
    {
      title: "Apply learning events to Project state",
      description:
        "Pure state reducer: validates that the quiz/session belongs to the supplied Project state, applies attempt events, and returns a new state. The server does not retain the resulting state.",
      inputSchema: {
        state: z.record(z.any()),
        project_state_id: z.string().startsWith("ps_"),
        attempts: z.array(
          z.object({
            question_id: z.string().min(1),
            module: z.string().min(1),
            subtype: z.string().nullable().optional(),
            source_type: sourceTypeSchema.optional(),
            exam_type: z.string().nullable().optional(),
            correct: z.boolean(),
            elapsed_seconds: z.number().nonnegative().nullable().optional(),
            speed_status: z.enum(["ok", "slow", "unknown"]).optional(),
            error_code: z.enum(ERROR_CODES).nullable().optional(),
            attempted_at: z.string().optional(),
          })
        ).max(200),
        session_summary: z.record(z.any()).optional(),
        session_completed: z.boolean().optional(),
        unfinished_session: z.record(z.any()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
    },
    async ({
      state,
      project_state_id,
      attempts,
      session_summary,
      session_completed,
      unfinished_session,
    }) => {
      try {
        assertSessionProjectMatch(state, project_state_id);
        const result = applyProjectLearningEvents(state, attempts, {
          session_summary,
          session_completed,
          unfinished_session,
        });
        return {
          content: [{
            type: "text",
            text: `Applied ${result.patch.attempts_applied} attempt(s) to ${project_state_id}; revision ${result.patch.to_revision}.`
          }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: error instanceof Error ? error.message : "Project state update failed."
          }],
          isError: true,
        };
      }
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res
      .writeHead(200, { "content-type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ name: "gongkao-quiz", version: "0.9.0", mcp: MCP_PATH }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
    const token = process.env.OPENAI_APPS_CHALLENGE;
    if (!token) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not configured");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(token);
    return;
  }

  const methods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && methods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createQuizServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`Gongkao quiz MCP listening on http://localhost:${port}${MCP_PATH}`);
});
