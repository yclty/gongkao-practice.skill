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
import { loadQuestionBank, selectQuestions } from "./lib/question-provider.js";

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

function createSession(questions, sessionId) {
  pruneSessions();
  const id = sessionId?.trim() || randomUUID();
  const session = {
    id,
    questions,
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
    question: publicQuestion(q, session.index, session.questions.length),
    stats: summarizeSession(session),
  };
}

function feedbackPayload(session) {
  const q = currentQuestion(session);
  const attempt = currentAttempt(session);
  if (!q || !attempt) return null;
  return {
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
    stats: summarizeSession(session),
    total_questions: session.questions.length,
    completed: session.index >= session.questions.length - 1,
    attempts: session.attempts.map((item) => ({
      question_id: item.question_id,
      correct: item.correct,
      elapsed_seconds: item.elapsed_seconds,
      speed_status: item.speed_status,
      error_code: item.error_code ?? null,
    })),
  };
}

function createQuizServer() {
  const server = new McpServer({
    name: "gongkao-quiz",
    version: "0.6.0",
  });

  registerAppResource(
    server,
    "gongkao-quiz-widget",
    "ui://gongkao/quiz-v0.5.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://gongkao/quiz-v0.5.html",
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
        questions: z.array(questionSchema).min(1).max(20),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false
      },
      _meta: {
        ui: { resourceUri: "ui://gongkao/quiz-v0.5.html" },
      },
    },
    async ({ session_id, questions }) => {
      const session = createSession(questions, session_id);
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
        count: z.number().int().min(1).max(20).default(5),
        targets: z.array(
          z.object({
            module: z.string().min(1).optional(),
            subtype: z.string().min(1).optional(),
            count: z.number().int().min(1).max(20),
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
        ui: { resourceUri: "ui://gongkao/quiz-v0.5.html" },
      },
    },
    async (input) => {
      try {
        const bank = loadQuestionBank(process.env.QUESTION_BANK_PATH);
        const questions = selectQuestions(bank, input);
        if (!questions.length) {
          return errorReply(input.session_id, "No compatible questions matched the current bank filters.");
        }
        const session = createSession(questions, input.session_id);
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
        ui: { resourceUri: "ui://gongkao/quiz-v0.5.html" },
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
        ui: { resourceUri: "ui://gongkao/quiz-v0.5.html" },
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
        ui: { resourceUri: "ui://gongkao/quiz-v0.5.html" },
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
      .end(JSON.stringify({ name: "gongkao-quiz", version: "0.6.0", mcp: MCP_PATH }));
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
