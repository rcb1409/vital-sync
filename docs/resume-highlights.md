# VitalSync — Resume Highlights

A production-deployed agentic AI fitness coach: full-stack TypeScript app with a custom ReAct agent on AWS Bedrock (Claude Haiku 4.5), trace-driven evaluation, and end-to-end IaC on AWS.

> **One-line pitch:** *Built and deployed an agentic AI coach on AWS Bedrock with a custom ReAct tool-calling loop, dual-LLM long-term memory, trace-driven LLM-as-judge evaluation, and Redis-backed dynamic context injection — full stack on AWS via Terraform + OIDC CI/CD.*

---

## 1. Custom ReAct agent loop (no LangChain, no framework)

- Hand-rolled the **ReAct (Reason + Act)** loop on Anthropic Claude Haiku 4.5 via AWS Bedrock — manage the message array myself, correlate `tool_use` ↔ `tool_result` blocks by ID, execute multiple tools **in parallel** (`Promise.all`), bound the loop with `MAX_AGENT_TURNS=5` to prevent runaway cost.
- **6 production tools** the agent can invoke: `fetchHistoricalWorkouts`, `logFood`, `searchExercises`, `createWorkoutTemplate`, `logWeight`, `webSearch` (Tavily).
- **Semantic vs system error classification:** when a tool throws, the executor labels the error.
  - **Semantic** (bad arguments — wrong date format, invalid enum) → returned to the model so it can self-correct on the next turn.
  - **System** (DB/network failure) → sanitized generic message; raw error logged server-side only, never leaked to the LLM.
- The framework choice was deliberate: writing the loop manually means I understand exactly what gets sent to the model and what comes back — no LangChain abstraction tax, no surprise token bloat.

## 2. Dual-LLM architecture for long-term memory

- **Two independent LLM calls per user turn** with separate responsibilities:
  1. **Conversation agent** — tools + persona + dynamic context, returns the user-facing reply.
  2. **Memory extractor** — runs *after* the reply is sent (non-blocking), no shared state, uses **forced `tool_choice`** on a single `save_memory_facts` tool to guarantee structured JSON output. Anthropic's structured-output equivalent of `responseSchema`.
- Each fact carries an optional `expiresAt` ISO date — the context builder filters expired facts at read time, giving free-form **TTL-scoped memory** without a cron job.
- Memory is persisted to MySQL (source of truth) and **cache-invalidated** in Redis on write, so the next turn reads the new fact without a stale-cache window.

## 3. Dynamic context injection + Redis as the shared data plane

The context built into every chat turn is identical to what the dashboard renders — Redis serves both, **once**:

- **4 parallel DB queries** build today's snapshot: nutrition totals, streaks, profile + memory, today's workout count.
- All four are wrapped by a **cache-aside** layer (`@/server/src/services/cache.service.ts`) — Redis first, DB on miss, write-back, **tag-scoped invalidation** using `SCAN` (not `KEYS` — `KEYS` blocks Redis at scale).
- The same cached blocks power both the dashboard widgets and the LLM context string. **One read path, two consumers** — no duplicate queries, no drift between what the user sees and what the agent reasons over.
- Historical/trend data (7d/30d) is **not** auto-injected — it's only fetched by the agent via `fetchHistoricalWorkouts` when the user asks. Result: smaller, cheaper prompts; ~50% fewer tokens per turn vs naive "stuff everything in the system prompt."

## 4. Evaluation: trace-driven, golden-dataset-backed, LLM-as-judge

- **Langfuse** instruments the entire stack — every turn produces a hierarchical trace: top-level `chatWithCoach` → spans for context build + each tool execution → generation events with model, prompts, output, and token usage. Prompt revisions are tagged with `PROMPT_VERSION` so you can A/B compare versions in production.
- **Trace-mined golden dataset:** real production conversations from Langfuse are curated into a golden dataset of representative scenarios (logging, retrieval, planning, edge cases, refusals).
- **LLM-as-judge harness** scores each response against the golden dataset across multiple criteria (tool selection correctness, factual grounding, persona adherence, safety). The judge runs against every prompt revision before merge — same loop as unit tests, but for behavior.
- **Evaluation feeds prompt iteration** — failing cases get added back to the dataset, the prompt is revised, the judge re-scores. Closed feedback loop with measurable regression coverage.

## 5. Reactive ↔ Proactive split (ReAct + ProAct)

- The chat agent is **reactive** — it waits for the user to ask, then plans and acts via the ReAct loop.
- The dashboard hosts a **proactive briefing** generated independently — surfaces insights ("you're 400 calories under target with 4 hours left", "hydration streak is at risk") without the user asking. Same data plane (Redis-cached today snapshot), different surface.
- This is the **agentic-product pattern** of 2026: don't just answer when prompted, surface signal proactively. Both modes share the long-term memory store and the cached context, so they never disagree.

## 6. Production safety: constrained tool surface

- **The LLM never touches the database, filesystem, or shell.** It can only emit `tool_use` blocks; the server-side executor (`@/server/src/services/ai/executor.ts`) is the only path to side effects, and every tool argument is validated before any DB write.
- No MCP server exposed, no arbitrary code execution, no SQL generation — the agent's blast radius is exactly the 6 tools I wrote.
- Every tool's input schema is a JSON Schema enforced at the model boundary; the executor re-validates server-side (defense in depth).
- Background memory writes are wrapped in try/catch with graceful degradation — a memory-extraction failure never breaks the user reply, which is already sent.

## 7. Full-stack on AWS via Terraform + OIDC

- **Modular Terraform** (5 modules: VPC, RDS MySQL, ElastiCache Redis, ECS Fargate + ALB, S3 + CloudFront) provisions the entire environment.
- **GitHub Actions OIDC federation** — the deploy pipeline assumes a short-lived AWS role; **no long-lived AWS access keys stored anywhere**.
- **Secrets via AWS Secrets Manager**, injected into ECS tasks at container boot — no secrets in images or `.env` files in production.
- **CI-gated CD:** backend deploys are chained to CI (`workflow_run`) so a failing build can never reach production. ECR images are tagged by commit SHA for deterministic rollbacks.
- ECS tasks live in private subnets with ALB-only ingress on a single port.

## 8. Stack at a glance

| Layer | Tech |
|---|---|
| **Agent / LLM** | Anthropic Claude Haiku 4.5, AWS Bedrock, custom ReAct loop, forced tool_choice |
| **Observability / Eval** | Langfuse (traces, generations, spans), LLM-as-judge harness, golden dataset |
| **Backend** | Node.js, TypeScript, Express, GraphQL (Apollo), Prisma, Zod |
| **Data** | MySQL (RDS), Redis (ElastiCache) — cache-aside + tag-scoped invalidation |
| **Auth** | JWT access + refresh-token rotation (Redis-backed, single-use), bcrypt-12 |
| **Frontend** | React 19, Vite, TailwindCSS, recharts, react-markdown |
| **Infra** | Terraform (modular), AWS ECS Fargate, ALB, ACM, S3, CloudFront, ECR |
| **CI/CD** | GitHub Actions, OIDC federation, path-filtered + workflow-chained deploys |

---

## 9. Quantification placeholders to fill in (run once, then bake into resume)

Replace the `[N]` markers with real numbers from your Langfuse traces and eval runs. Don't ship bullets without these.

- `[N]%` LLM-as-judge pass rate across `[N]` golden-dataset scenarios on `[N]` evaluation criteria.
- `[N]ms` p95 chat latency (non-streaming, single-turn).
- `[N]%` token reduction per turn vs naive context (justify with prompt-token logs).
- `[N]` average tool calls per multi-step user request.
- `[N]ms` p95 dashboard load reduction from Redis cache hits vs cold MySQL.
- `[N]` Terraform-managed AWS resources across `[N]` modules.

---

## 10. ATS keyword bank (mix into Skills + bullets + LinkedIn)

**Agentic AI:** Agentic AI · ReAct pattern · Tool calling · Function calling · LLM agents · Multi-step reasoning · Autonomous agents · Agent loop · Proactive AI

**LLM platform:** AWS Bedrock · Anthropic Claude · LLM integration · Prompt engineering · System prompts · Structured output · Long-term memory · Context engineering · Token optimization · Streaming (SSE)

**Evaluation:** LLM-as-judge · Golden dataset · Evaluation harness · Trace-driven development · Observability · Langfuse · Production tracing · Prompt versioning · Regression evaluation

**Backend / data:** Node.js · TypeScript · Express · GraphQL · Prisma · MySQL · Redis · Cache-aside · Distributed cache · JWT · Refresh-token rotation · OAuth (Strava)

**Cloud / DevOps:** AWS · ECS Fargate · ALB · CloudFront · S3 · Secrets Manager · ElastiCache · RDS · Terraform · IaC · GitHub Actions · OIDC · ECR · CI/CD · Docker

**Safety / production:** Guardrails · Tool sandbox · Least-privilege · Input validation · Defense in depth · Graceful degradation
