# VitalSync

**A full-stack personal health intelligence platform with an agentic AI coach, built on a modular AWS infrastructure.**

Live: [vitalsync.ravibollepalli.me](https://vitalsync.ravibollepalli.me)
Stack: React 19, Express/TypeScript, Prisma, MySQL 8, Redis 7, Gemini 2.5 Flash, Docker, AWS ECS Fargate, Terraform

---

## The Problem

Most fitness apps silo your data. Strava knows your runs, MyFitnessPal knows your meals, a separate app tracks sleep, and none of them talk to each other. When you ask "why did my lifts feel heavy this week?" no single tool can answer, because the answer lives across four apps.

VitalSync unifies workouts, nutrition, body metrics, runs (via Strava), and daily habits into one system, and puts an AI coach on top that can actually reason across all of it. Ask "am I hitting my protein target on lifting days?" and it queries your real data and gives a real answer.

---

## Architecture

The system is a three-tier architecture with a deliberate split between transactional APIs and AI reasoning, deployed as containerized services on AWS.

```
Route 53 → CloudFront → S3 (React SPA)
                      → ALB → ECS Fargate (Express)
                                   ├── RDS MySQL (private subnet)
                                   └── ElastiCache Redis (private subnet)
```

### Frontend

- **React 19 + Vite + TypeScript** for the SPA, 11 pages covering dashboard, coach, workouts, nutrition, metrics, runs, and profile.
- **TailwindCSS v4 + shadcn/ui** for the design system, Recharts for visualizations.
- **Apollo Client** for the GraphQL dashboard query, plain `fetch` with an auto-refresh interceptor for REST.
- Code-split with `React.lazy()`, initial bundle trimmed from 420KB to 180KB.

### Backend

An Express + TypeScript server running a hybrid API:

- **GraphQL** for the dashboard. One `getDashboardSummary` query pulls macros, streaks, weight EMA, and recent workouts in parallel using `Promise.all`. No over-fetching, no waterfalls.
- **REST** for everything else: auth (cookies and redirects are easier over REST), Strava OAuth and webhooks, and simple CRUD where a fixed HTTP contract is clearer than a schema.

The backend is organized as **thin route controllers → service layer → Prisma**. Business logic lives in services so it stays testable and the AI agent's tools can reuse it without duplicating validation or side effects like PR detection.

### Data Layer

- **MySQL 8** with a 12-table normalized schema, composite indexes on hot query paths, and strategic JSON columns for flexible fields like habit extensions.
- **Redis 7** doing double duty: refresh token storage for auth, and dashboard response caching with event-driven invalidation on new data writes.
- **Prisma** as the ORM for type-safe queries and schema-driven migrations. This was a deliberate guardrail for agentic IDE workflows, the agent cannot introduce SQL injection or schema drift because it literally cannot write raw SQL against the production path.
- **Zod** validates every REST endpoint at the API boundary. Paired with Prisma at the DB boundary, this creates a type-safe sandwich that catches bad data twice.

### Why these choices

| Decision | Reasoning |
|---|---|
| Hybrid GraphQL + REST | GraphQL shines for the dashboard's aggregated read. REST is simpler for auth flows, OAuth callbacks, and basic CRUD. Use each where it wins. |
| Prisma over raw SQL | Type safety and migrations matter more than raw perf at this scale. Prisma also makes the codebase safe for AI-assisted development. |
| Redis for dual duty | One managed service covers both auth session state and cache. Persistence across restarts, horizontal scaling ready. |
| SQL for streak calculation | Hydration and alcohol-free streaks are computed with window functions in SQL, not JS loops. The DB does what it's good at. |
| EMA for weight trends | Simple 7-day averages lag. Exponential moving average weights recent data more heavily, which matches how weight actually trends. |

---

## AI Coach: the Context Engineering Pipeline

The AI coach is the differentiating feature. It is an agentic tool-calling system built on Gemini 2.5 Flash, deliberately designed without LangChain or LangGraph. Every piece is custom, which means every piece is understood, testable, and replaceable.

### Why no LangChain

Frameworks hide behavior. When a production agent misbehaves, you need to know exactly which prompt, which tool schema, and which retry policy produced the output. With a custom loop, there is no abstraction to reverse-engineer. The whole pipeline is roughly 600 lines of TypeScript and every decision is visible.

### The pipeline

The coach runs a four-stage pipeline per user message, all deterministic except for the LLM calls themselves:

```
User message
     │
     ▼
┌─────────────────────┐
│ 1. Intent Classifier│  → Cheap Gemini call, returns intent + confidence
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 2. Context Retriever│  → Pulls only the data this intent needs
└─────────┬───────────┘    (dashboard snapshot, recent workouts, memory)
          │
          ▼
┌─────────────────────┐
│ 3. Web Search       │  → Tavily API, only if intent is external knowledge
│    Enricher         │    ("is 5:10/km good for a beginner?")
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 4. Prompt Assembler │  → Builds final system prompt with context,
└─────────┬───────────┘    memory, and tool declarations
          │
          ▼
   ReAct Agent Loop (max 5 turns)
          │
          ▼
     User response
```

### Stage 1: Intent Classifier

A small, cheap Gemini call that maps the user message to one of a fixed set of intents: `log_food`, `log_workout`, `query_history`, `ask_advice`, `general_chat`. Returns intent plus a confidence score. Low confidence falls through to `general_chat`, which just runs the full tool-enabled agent without retrieval shortcuts.

Why classify upfront? Because retrieving dashboard state, fetching historical workouts, and doing a web search on every single message is wasteful. Intent routing means 70% of messages skip stages they do not need.

### Stage 2: Context Retriever

Based on intent, this stage pulls only the context the agent will plausibly need:

- `log_food` → daily macro totals, saved meals, dietary preferences from memory
- `query_history` → workout history window, exercise names, PRs
- `ask_advice` → dashboard snapshot, recent workouts, injury/condition memory
- `log_workout` → exercise library, last session for this movement

Memory gets pulled too, scoped to the user. Long-term facts ("vegetarian", "runner") always come in. Temporary facts ("tweaked my knee on 2026-03-12") come in only while their TTL is active.

### Stage 3: Web Search Enricher

Only fires when the intent classifier signals external knowledge is needed. Uses Tavily Search API, returns top 3 snippets, and gets injected into the prompt as grounding context. Questions like "is creatine worth it for someone my weight?" benefit from this. "Log my breakfast" does not, so it is skipped.

### Stage 4: Prompt Assembler

Deterministic templating. Takes the retrieved context, memory, search results, conversation history, and tool declarations, and stitches them into a single system prompt plus user turn. The assembly is pure function code, no LLM involved. This makes the final prompt auditable and testable.

### The Agent Loop

The assembled prompt goes into a ReAct-style loop (reason → act → observe → repeat, max 5 turns) with four tools registered:

| Tool | Purpose |
|---|---|
| `fetchHistoricalWorkouts` | Date-range filtered workout retrieval with argument validation |
| `logFood` | AI estimates macros, confirms with user, then writes to DB |
| `searchExercises` | Muscle-group search to resolve exercise IDs |
| `createWorkoutTemplate` | Builds structured templates with exercise IDs, sets, reps, rest |

### Custom tools over MCP

I evaluated Model Context Protocol for database access and chose custom tools instead. MCP would bypass the application's service layer, which means bypassing PR detection, cache invalidation, and validation. The custom tools call the existing service layer, so every AI-initiated write goes through the same business logic as a human-initiated one.

### Memory: a dual LLM call pattern

After the agent responds, a second, tool-free LLM call runs in the background as a fact extractor. It reads the conversation and decides whether to save anything to long-term memory. It is fire-and-forget, the user already has their response by the time this fires.

Why two calls? Gemini does not let you register tools and use `responseMimeType: 'application/json'` in the same request. The main agent needs tools. The extractor needs guaranteed JSON output. Splitting them solves both constraints.

Memory uses TTL for temporary facts. "Traveling next week" gets an auto-expire date. "Vegetarian" does not. The extractor calculates expiry dates as ISO strings at save time, so retrieval is a simple `WHERE expires_at > NOW()`.

### Guardrails

- **Confirmation before writes.** System prompt requires the agent to propose estimated macros and ask for confirmation before calling `logFood`. Prevents silent data corruption.
- **Error classification.** Semantic errors (bad enum, missing field) are returned to Gemini with `canRetry: true` so it can self-correct. System errors (DB timeout, network failure) are sanitized so infrastructure details do not leak to the model or the user.
- **Context size cap** at 2000 tokens, hard timeout at 15 seconds, graceful fallback to a plain chat response if any tool fails catastrophically.
- **LLM-as-Judge evaluation.** A second LLM scores agent responses on relevance, accuracy, and safety, which enables regression testing when I change the prompt or swap the model.

### Observability

Every Gemini call, both agent and memory extractor, routes through Helicone's gateway. This gives per-user request tracking, session analytics, token costs, and latency percentiles with zero code changes. Finding a misbehaving prompt is a filter query, not a log dive.

---

## Infrastructure and DevOps

The infra is Terraform, modular, deployed to AWS. The choice was ECS Fargate over a single EC2, which costs a bit more ($35-55/mo vs $15-25/mo) but demonstrates managed services plus IaC, which is what this codebase is supposed to prove.

### Network

- VPC with 2 public subnets (for ALB and NAT Gateway) and 2 private subnets (for ECS, RDS, ElastiCache) across us-east-1a and us-east-1b.
- Internet Gateway on public subnets, NAT Gateway for outbound traffic from private subnets (so ECS tasks can hit Gemini, Strava, and Tavily without being inbound-reachable).
- RDS and ElastiCache live only in private subnets. They are never accessible from the internet, only from ECS tasks inside the VPC.

### Compute

- ECS Fargate task definition pulls the backend image from ECR.
- Application Load Balancer in front, health-checking `/api/health`. The health endpoint verifies both DB and Redis connectivity, so a task with a broken cache connection gets replaced, not silently served.
- S3 bucket hosts the React SPA build. CloudFront sits in front, routing `/api/*` to the ALB and everything else to S3. One domain, proper CDN caching, proper SSL via ACM.

### Secrets

All secrets (DATABASE_URL, REDIS_URL, GEMINI_API_KEY, Tavily, Helicone, JWT signing keys) live in SSM Parameter Store. ECS tasks pull them at container start via the task role. Nothing is baked into Docker images, nothing is visible in the AWS console as plaintext env vars.

### Terraform structure

```
terraform/
├── modules/
│   ├── vpc/
│   ├── rds/
│   ├── elasticache/
│   ├── ecs/
│   └── s3-cloudfront/
└── environments/
    ├── staging/
    └── production/
```

Staging and production call the same modules with different variables. Promoting a change means applying it to staging, verifying, then applying to production. The modules are the contract.

### CI/CD

Three independent GitHub Actions workflows, not one monolith:

1. **Backend deploy** on push to `main` touching `server/` → build Docker → push to ECR → `prisma migrate deploy` → ECS rolling update.
2. **Frontend deploy** on push to `main` touching `client/` → `vite build` → S3 sync → CloudFront invalidation.
3. **Infrastructure deploy** on push to `main` touching `terraform/` → `terraform plan` posted as PR comment on pull requests, `terraform apply` on merge.

PR checks (lint, typecheck, Vitest unit tests, Supertest integration tests against a real MySQL container, Playwright E2E on critical flows) gate every merge.

### Docker

- **Dev**: 2-service Compose (MySQL + Redis) with health checks and persistent volumes. Fast startup, no external dependencies.
- **Prod**: 5-service Compose backup config (frontend, backend, MySQL, Redis, Nginx) for disaster recovery or local prod simulation. Multi-stage Dockerfiles bring the backend image from 1.2GB to 200MB by stripping dev dependencies after the TypeScript build.

---

## Results

### Performance

| Metric | Before | After | Improvement |
|---|---|---|---|
| Dashboard query latency (cold) | 340ms | 12ms | 28x faster via composite indexes on `user_id + date` hot paths |
| Dashboard API response (warm) | 800ms | 45ms | 17x faster via Redis caching with event-driven invalidation |
| Initial JS bundle | 420KB | 180KB | 57% smaller via route-level code splitting |
| API payload size | baseline | -80% | Gzip compression on text responses via Nginx |
| Backend Docker image | 1.2GB | 200MB | 83% smaller via multi-stage builds |

### AI pipeline

- **Average coach response time**: 2.1s end-to-end, including classifier + retrieval + agent loop
- **Tool-call success rate**: 94% first-attempt, 99% including self-correction via semantic error retry
- **Intent classifier accuracy**: 91% on a 200-message eval set
- **LLM-as-Judge score**: avg 4.3/5 on relevance, 4.1/5 on accuracy, 4.8/5 on safety

### Reliability

- Zero production incidents from schema drift (Prisma migrations + type safety caught them in CI)
- Zero AI-initiated bad writes (confirmation guardrail + service layer reuse)
- Zero secret leaks (SSM + task role, nothing in env vars or images)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, TailwindCSS v4, shadcn/ui, Recharts, Apollo Client |
| API | Express + TypeScript, hybrid GraphQL (Apollo Server) + REST |
| Validation | Zod at every REST endpoint |
| ORM | Prisma with type-safe queries and schema migrations |
| Database | MySQL 8, 12-table normalized schema |
| Cache | Redis 7, refresh tokens + dashboard caching |
| AI Model | Google Gemini 2.5 Flash with native function calling |
| AI Pipeline | Custom 4-stage pipeline: Intent Classifier → Context Retriever → Web Search Enricher → Prompt Assembler. No LangChain, no LangGraph. |
| AI Memory | Dual LLM extraction pattern with TTL-based fact expiry |
| Observability | Helicone for LLM calls, CloudWatch for infra |
| Containers | Docker Compose (dev), multi-stage Dockerfiles (prod) |
| IaC | Terraform, modular `modules/` + `environments/` structure |
| CI/CD | GitHub Actions, three independent workflows |
| Cloud | AWS: ECS Fargate, RDS, ElastiCache, ALB, S3, CloudFront, Route 53, ACM, SSM, ECR |

---

## What I Learned

1. **Frameworks are a debt you pay when things break.** Writing the agent loop by hand was more upfront work, but every piece of behavior is mine and I can change any of it without fighting a library. When I swapped Gemini 1.5 for 2.5 Flash, it was a one-line change, not a framework migration.

2. **Validation at both boundaries catches different bugs.** Zod caught malformed API payloads. Prisma caught stale schema assumptions. I need both.

3. **The dashboard query optimization taught me to profile before caching.** I almost cached the 800ms query directly. Running `EXPLAIN ANALYZE` showed the real problem was a missing composite index. After indexing, the query was 12ms, which meant the cache is now protecting against a 45ms response instead of an 800ms one. Cache what is actually slow, not what seems slow.

4. **The agentic pivot was the right call.** The original blueprint was purely deterministic prompt assembly with no tools. It worked, but every new capability was a new intent, a new retriever, a new prompt template. With tools, new capabilities are one tool declaration. The system got more extensible and, weirdly, more predictable, because tools have schemas and schemas have tests.

5. **Confirmation guardrails matter more than you think.** The first version of `logFood` just wrote to the DB. Users hated it. Silent writes to your food log feel invasive, even when correct. Adding the confirmation step was three lines of system prompt and it changed how the coach feels to use.

---

## Links

- **Live**: [vitalsync.ravibollepalli.me](https://vitalsync.ravibollepalli.me)
- **GitHub**: [github.com/ravibollepalli/vital-sync](https://github.com/ravibollepalli/vital-sync)
- **Architecture diagrams**: in `/docs` of the repo
