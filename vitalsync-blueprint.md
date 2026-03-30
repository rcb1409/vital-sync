# VitalSync — Complete Project Blueprint

---

## What We're Building

A **full-stack personal health intelligence platform** with a React frontend, Express backend, MySQL database, Redis cache, and an **AI coach powered by a context engineering pipeline**. All containerized with Docker, deployed to AWS with Terraform, tested at multiple levels, and shipped through a CI/CD pipeline.

The API is **hybrid**: **GraphQL** for the dashboard and AI coach (flexible queries, no over-fetching, streaming responses), and **REST** for auth, Strava OAuth/webhooks, and simple CRUD where a fixed HTTP contract is simpler.

The user logs **workouts, nutrition, body weight, and daily habits** (sleep, water, alcohol). A dashboard visualizes trends across all data. An **AI personal trainer** (Google Gemini API) uses a **context engineering pipeline** that classifies intent, retrieves only the relevant health data across tagged domains, optionally enriches with web search results, and assembles a token-optimized prompt. Single LLM call, streamed response. No single fitness app does this today because they all operate in silos.

---

## The Core Problem It Solves

Every fitness app only sees one slice of your life. MyFitnessPal knows your calories but not your sleep. Strava knows your runs but not your nutrition. No app connects the dots: *"You've been under-eating protein by 40g daily, sleeping under 6 hours, and wondering why your bench press stalled for 3 weeks."*

VitalSync is one app, one database, one AI with a context engine that sees everything and retrieves exactly the right data for every question.

---

## Five Modules + Dashboard + AI Coach

### Module 1: Workout Tracker
- **Log workouts**: pick exercises from a seeded library (200+ exercises with muscle group and equipment tags), add sets with reps, weight, and RPE (rate of perceived exertion)
- **Workout templates**: save any workout as a reusable template ("Push Day A"), load and modify it next session
- **Auto PR detection**: backend compares every logged set against historical data per exercise, flags new personal records automatically
- **Volume tracking**: total weekly volume per muscle group (sets x reps x weight), trend over time
- **Workout history**: filterable list with search, expandable detail view

### Module 2: Nutrition Tracker
- **Quick-add food**: enter food name + calories + protein + carbs + fat manually
- **Meal tagging**: breakfast, lunch, dinner, snack — each entry tagged
- **Saved meals**: save frequent meals ("My usual breakfast") and log them with one tap
- **Daily targets vs actuals**: calorie and macro targets (set in user profile), shown as progress bars for the day
- **Weekly averages**: 7-day rolling average of calorie and macro intake

### Module 3: Body Weight
- **Daily weight logging**: simple number entry with date
- **7-day exponential moving average**: smooths out daily fluctuations (water retention, food timing) to show the real trend
- **Trend direction indicator**: gaining, losing, or maintaining — based on the moving average slope over the last 14 days
- **Goal tracking**: target weight set in profile, projected date to reach it based on current rate

### Module 4: Daily Habits
- **Sleep**: hours slept + quality rating (1-5)
- **Water intake**: glasses or ml logged through the day
- **Alcohol**: yes/no toggle + number of units if yes
- **Streak tracking**: consecutive alcohol-free days, consecutive days hitting water target, consecutive days sleeping 7+ hours
- **Flexible by design**: stored as structured JSON so you can add new habit types without schema migrations (interview talking point)

### Module 5: Run Tracking (Strava Integration)
- **Connect Strava**: OAuth2 flow that links a VitalSync user to their Strava athlete account
- **Auto-import runs**: webhook + manual sync to pull new run activities (distance, duration, pace, elevation) into our database
- **Unified training history**: runs live alongside gym workouts so the dashboard and AI coach see total training load, not just lifting
- **Run metrics**: weekly distance, average pace per km, longest run, and time since last run

### Dashboard (The Visual Centerpiece)
- **Today summary cards**: calories eaten / target, last workout + days since, last run + distance & pace, current weight + trend arrow, sleep last night, current alcohol-free streak
- **Charts (Recharts)**:
  - Weight trend line with moving average overlay (dual line chart)
  - Weekly workout volume stacked bar chart (by muscle group)
  - Weekly running distance chart (line or bar)
  - Running pace trend line chart (min/km)
  - Daily calorie intake vs target (bar chart with target line)
  - Macro breakdown donut chart (protein / carbs / fat)
  - Habit consistency calendar heat map (green = hit all targets, yellow = partial, gray = no data)
  - Sleep trend line chart with quality color coding
- **Date range selector**: 7 days / 30 days / 90 days / custom
- **Served via GraphQL** — client requests exactly the summary and chart fields it needs. **Redis-cached** per query + variables; invalidated on new data entry.

---

## AI Coach with Context Engineering Pipeline (The Killer Feature)

This is the architectural centerpiece that differentiates VitalSync from every other fitness app and demonstrates **AI/ML engineering depth**. Instead of dumping all user data into a prompt or using an agent that makes multiple unpredictable LLM round trips, the AI coach uses a **deterministic context engineering pipeline** that classifies intent, retrieves only relevant data, and assembles a precision-targeted prompt. One LLM call, streamed response.

### Why Context Engineering Instead of Agents or Static Dumps

There are three common approaches to giving an LLM access to user data:

1. **Static dump (what juniors do)**: pull all data, stuff it into the prompt, hope the LLM figures it out. Wastes tokens, includes irrelevant data, can't scale.
2. **Agentic approach**: let the LLM decide what to fetch via tool calling. Adds 3-5x latency from multiple LLM round trips, introduces non-deterministic tool selection, costs more, and is overkill when the problem domain is bounded.
3. **Context engineering (what we do)**: a deterministic pipeline that classifies the question, retrieves exactly the right data, and gives the LLM a perfectly targeted context window. Faster, cheaper, more reliable, and fully observable.

The VitalSync problem is **bounded**: 6 data domains, a predictable question space, and well-defined cross-domain correlations. Context engineering is the right tool for this job. It's also what companies like Anthropic, OpenAI, and every serious AI team are focused on right now: **the real skill in AI applications is what you feed the model, not how many times you call it.**

### Context Engineering Pipeline Architecture

The pipeline sits between the user's question and the LLM call. It has four stages:

```
User Question + Conversation History
      |
      v
  [1. Intent Classifier]     <-- Tags question with relevant domains + date range
      |                            Rule-based + keyword matching (deterministic, zero latency)
      v
  [2. Context Retriever]     <-- Fetches compressed summaries from tagged domains only
      |                            Each domain has a buildContext() function
      |                            Runs in parallel via Promise.all
      v
  [3. Web Search Enricher]   <-- Optional: Tavily search for external knowledge
      |                            Only triggered when intent flags needsWebSearch
      v
  [4. Prompt Assembler]      <-- System prompt + user profile/goals + domain contexts
      |                            + web search results + conversation history (last 5)
      |                            + the question
      v
  Single LLM Call (Gemini)   <-- Streamed response via GraphQL subscription / SSE
      |
      v
  Streamed Response          <-- Status indicators + streaming text to frontend
```

### Stage 1: Intent Classifier

A deterministic router that tags each question with relevant data domains, a date range, and whether web search is needed. No LLM call required.

```typescript
// context-engine/router.ts
type Domain = "workouts" | "nutrition" | "body_metrics" | "habits" | "runs" | "exercise_history";

interface ContextPlan {
  domains: Domain[];
  dateRange: number;       // days to look back
  needsWebSearch: boolean;
  exerciseName?: string;   // extracted for exercise-specific queries
}

function planContext(question: string, history: Message[]): ContextPlan {
  const q = question.toLowerCase();
  const domains: Domain[] = [];

  // Exercise-specific queries
  if (matches(q, ["bench", "squat", "deadlift", "stall", "PR", "exercise", "lift", "press"]))
    domains.push("exercise_history", "workouts");

  // Nutrition queries
  if (matches(q, ["calorie", "protein", "macro", "eating", "diet", "nutrition", "food"]))
    domains.push("nutrition");

  // Body composition queries
  if (matches(q, ["weight", "gaining", "losing", "cut", "bulk", "body"]))
    domains.push("body_metrics", "nutrition");

  // Recovery and habit queries
  if (matches(q, ["sleep", "recovery", "tired", "alcohol", "water", "habit", "rest"]))
    domains.push("habits");

  // Running queries
  if (matches(q, ["run", "pace", "distance", "cardio", "strava", "jog"]))
    domains.push("runs");

  // Broad overview queries
  if (matches(q, ["week", "overview", "summary", "track", "progress", "how am i"]))
    domains.push("workouts", "nutrition", "body_metrics", "habits", "runs");

  // Cross-domain: stall/plateau questions always need recovery context
  if (matches(q, ["stall", "plateau", "stuck", "not progressing"]))
    domains.push("habits", "nutrition");

  // Web search for questions needing external knowledge
  const needsWebSearch = matches(q, [
    "good for", "should I", "normal", "recommended", "beginner",
    "optimal", "how much", "compared to", "average"
  ]);

  // Extract exercise name if present
  const exerciseName = extractExerciseName(q);

  // Default date range: 30 days. Progression queries: 90 days.
  const dateRange = matches(q, ["progress", "trend", "stall", "plateau", "over time"]) ? 90 : 30;

  return {
    domains: [...new Set(domains)],
    dateRange,
    needsWebSearch,
    exerciseName,
  };
}
```

### Stage 2: Context Retriever

Each data domain has a `buildContext()` function that queries the database and returns a **compressed summary**, not raw rows. Only the domains tagged by the intent classifier are fetched, and they run in parallel.

```typescript
// context-engine/builder.ts
const contextFetchers: Record<Domain, ContextFetcher> = {
  workouts: async (userId, days) => {
    const data = await workoutService.getSummary(userId, days);
    return formatWorkoutContext(data);
    // Returns: "18 sessions (4.5/week), volume trending up,
    //          recent PRs: Bench 100kg x 5, Squat 140kg x 3,
    //          missed: shoulders, calves. Last workout: 2 days ago."
  },
  nutrition: async (userId, days) => {
    const data = await nutritionService.getSummary(userId, days);
    return formatNutritionContext(data);
    // Returns: "Avg 2340 cal (target 2600, deficit 260),
    //          protein 142g (target 180, short 38g),
    //          72% days logged."
  },
  body_metrics: async (userId, days) => {
    const data = await metricsService.getWeightSummary(userId, days);
    return formatBodyContext(data);
    // Returns: "Current 82.4kg (was 83.1 30d ago),
    //          losing 0.23kg/week, target 80kg,
    //          ETA ~10 weeks at current rate."
  },
  habits: async (userId, days) => {
    const data = await habitsService.getSummary(userId, days);
    return formatHabitsContext(data);
    // Returns: "Avg sleep 6.2h (quality 3.1/5),
    //          6 alcohol days, 4-day sober streak,
    //          avg water 2100ml."
  },
  runs: async (userId, days) => {
    const data = await runService.getSummary(userId, days);
    return formatRunsContext(data);
    // Returns: "10 runs (2.5/week), avg 5.3km at 5:10/km,
    //          longest 12km, last run 1 day ago."
  },
  exercise_history: async (userId, days, exerciseName?) => {
    const data = await workoutService.getExerciseProgression(userId, exerciseName, days);
    return formatExerciseHistory(data);
    // Returns: "Bench Press: 85kg x 5 (8 weeks ago) -> 95kg x 5 (4 weeks ago)
    //          -> 95kg x 5 (this week). Plateaued for 4 weeks."
  },
};

async function buildContext(userId: string, plan: ContextPlan): Promise<string> {
  const fetchers = plan.domains.map(domain =>
    contextFetchers[domain](userId, plan.dateRange, plan.exerciseName)
  );
  const results = await Promise.all(fetchers);

  // Each fetcher returns a compressed summary
  // Total context stays under 1200 tokens
  return results.filter(Boolean).join("\n\n");
}
```

### Stage 3: Web Search Enricher (Optional)

When the intent classifier flags `needsWebSearch`, the pipeline makes a Tavily Search API call before the LLM call and includes the results in the prompt. This handles questions the database can't answer: "is 5:10/km a good pace for a beginner?", "optimal protein intake for cutting at 82kg?", "how many rest days per week?"

```typescript
// context-engine/enricher.ts
async function enrichWithWebSearch(question: string, plan: ContextPlan): Promise<string | null> {
  if (!plan.needsWebSearch) return null;

  const results = await tavily.search({
    query: question,
    maxResults: 3,
    searchDepth: "basic",
  });

  // Compress search results into a concise reference block
  return results.map(r => `[${r.title}]: ${r.content.slice(0, 200)}`).join("\n");
}
```

### Stage 4: Prompt Assembler

Assembles the final prompt from all the pieces: system instructions, user profile, retrieved domain contexts, optional web search results, conversation history, and the question.

```typescript
// context-engine/assembler.ts
function assemblePrompt(
  userProfile: UserProfile,
  domainContext: string,
  webSearchResults: string | null,
  conversationHistory: Message[],
  question: string
): ChatMessage[] {
  const systemPrompt = `You are a personal fitness coach analyzing real health data.
Be specific with numbers. Reference the data provided. Cross-reference domains
to find patterns (e.g., sleep affecting strength, nutrition affecting weight).
If web search results are provided, combine them with the user's actual data
to give personalized advice, not generic recommendations.`;

  const userContext = `USER PROFILE:
${userProfile.name}, ${userProfile.goals.target_weight}kg target,
${userProfile.goals.calorie_target} cal/day, ${userProfile.goals.protein_target}g protein/day,
${userProfile.goals.training_days_per_week} training days/week.`;

  let fullContext = `${userContext}\n\nHEALTH DATA:\n${domainContext}`;

  if (webSearchResults) {
    fullContext += `\n\nREFERENCE (from web):\n${webSearchResults}`;
  }

  return [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-5), // last 5 messages for follow-ups
    { role: "user", content: `${fullContext}\n\nQUESTION: ${question}` },
  ];
}
```

### Example: How the Pipeline Handles "Why is my bench press stalling?"

**Without context engineering (static dump):** pull all 30 days of data across every domain, compress into ~8000 tokens, hope the LLM finds the bench press signal in the noise.

**With the context engineering pipeline:**

1. **Intent classifier** tags: `[exercise_history, workouts, habits, nutrition]`, dateRange: 90 days, needsWebSearch: false, exerciseName: "Bench Press"
2. **Context retriever** runs 4 fetchers in parallel (~50ms total):
   - `exercise_history`: "Bench Press: plateaued at 95kg x 5 for 4 weeks"
   - `workouts`: "chest volume increased 20% over 4 weeks"
   - `habits`: "avg sleep 5.8h, quality 3.1/5, 6 alcohol days"
   - `nutrition`: "protein 135g avg (target 180g, short 45g)"
3. **Web search**: skipped (not flagged)
4. **Prompt assembler**: builds a ~800 token context with user profile + 4 domain summaries + question
5. **Single Gemini API call**, streamed response: "Your bench press has been stuck at 95kg for 4 weeks. Here's why: you increased chest volume by 20% while averaging only 5.8 hours of sleep and falling 45g short on daily protein. Prioritize sleep and hit 180g protein before pushing intensity."

**Result**: ~800 tokens of context (not 8000), one LLM call (not 3-5 agent iterations), sub-2-second response (not 5-8 seconds), deterministic and fully observable.

### Frontend: Status Indicators

Even without agent tool calls, the frontend shows status indicators based on the context plan. When the pipeline tags `exercise_history`, the UI shows "Analyzing your bench press data..." while context is being assembled. Same UX as an agent, deterministic timing.

```
  Analyzing your bench press data...
  Checking sleep and nutrition patterns...
  Building your personalized response...

  Your bench press has been stuck at 95kg for 4 weeks. Here's why...
```

### Context Snapshot (What Gets Stored)

Every AI conversation stores the full pipeline trace: the question, the context plan (which domains were tagged), the assembled context, web search results if any, the response, and performance metrics. This enables debugging, reproducibility, and prompt optimization.

```json
{
  "question": "Why is my bench press stalling?",
  "context_plan": {
    "domains": ["exercise_history", "workouts", "habits", "nutrition"],
    "dateRange": 90,
    "needsWebSearch": false,
    "exerciseName": "Bench Press"
  },
  "context_snapshot": {
    "exercise_history": "Bench Press: plateaued at 95kg x 5 for 4 weeks...",
    "workouts": "chest volume increased 20%...",
    "habits": "avg sleep 5.8h, quality 3.1/5...",
    "nutrition": "protein 135g avg (target 180g)..."
  },
  "web_search_results": null,
  "response": "Your bench press has been stuck at 95kg for 4 weeks...",
  "context_tokens": 812,
  "total_tokens": 1340,
  "duration_ms": 1850,
  "domains_fetched": 4
}
```

### Pre-built Quick Prompts
- "How was my week?"
- "Am I on track for my goal?"
- "Am I overtraining?"
- "What should I change?"
- "Why am I stalling on [exercise]?"
- "What's a good protein target for my weight?" (triggers web search + body_metrics)
- "Compare my running pace to beginner benchmarks" (triggers web search + runs)

### Chat Interface
- Conversation history stored in database with full pipeline traces
- Streaming response rendered in real-time with domain-based status indicators
- Quick prompt buttons for common questions
- Conversation list sidebar
- Context plan shown as collapsible "what was analyzed" panel per message

---

## Architecture

```
+----------------------------------------------+
|              REACT + VITE                     |
|         TypeScript + Tailwind                 |
|       shadcn/ui + Recharts + SSE              |
|     Context pipeline status indicators        |
|            (Port 5173 dev)                    |
+---------------------+------------------------+
                      |
          HTTPS (REST + GraphQL + SSE)
                      |
+---------------------v------------------------+
|                   NGINX                       |
|     /api/*, /graphql  -> Express backend      |
|     /*      -> React static build             |
|     gzip / brotli / rate limiting             |
+--------+-------------------+-----------------+
         |                   |
+--------v--------+  +------v-----------------+
|   EXPRESS       |  |   REACT STATIC         |
|   BACKEND       |  |   BUILD (nginx)        |
|  Port 4000      |  +------------------------+
|                  |
|  Middleware:      |
|  - JWT auth       |
|  - Zod            |
|  - Rate limit     |
|  - Error handler  |
|                  |
|  Services:        |
|  - workout        |
|  - nutrition      |
|  - metrics        |
|  - dashboard      |
|  - AI coach       |
|    - Context Engine    |
|      - Intent Classifier   <-- Deterministic domain tagging
|      - Context Retriever   <-- Parallel domain fetchers
|      - Web Search Enricher <-- Optional Tavily search
|      - Prompt Assembler    <-- Token-optimized prompt construction
|    - Gemini API (streaming) |
+---+----------+---+
    |          |
+---v---+ +----v----+   +---------------+
| MySQL | | Redis   |   | Tavily Search |
|       | |         |   | API (optional)|
+-------+ +---------+   +---------------+
```

### Docker Compose (5 containers)
1. **frontend** — multi-stage build: npm install -> vite build -> nginx serves static files
2. **backend** — multi-stage build: npm install -> tsc compile -> node runs compiled JS
3. **db** — MySQL 8 Alpine with health check and persistent volume
4. **cache** — Redis 7 Alpine with health check
5. **nginx** — reverse proxy routing /api to backend, everything else to frontend

---

## Database Schema

```sql
users
├── id (uuid, PK)
├── email (unique)
├── password_hash
├── name
├── goals (JSON) -> { calorie_target, protein_target, target_weight, training_days_per_week }
├── created_at
└── updated_at

exercises
├── id (PK)
├── name
├── muscle_group (enum: chest, back, shoulders, biceps, triceps, legs, core, cardio)
├── equipment (enum: barbell, dumbbell, machine, cable, bodyweight, other)
├── user_id (nullable — null = default library, set = user-created custom)
└── INDEX on (muscle_group), INDEX on (user_id)

workouts
├── id (uuid, PK)
├── user_id (FK -> users)
├── name (e.g., "Push Day", "Upper Body")
├── started_at (timestamp)
├── duration_min
├── notes
└── INDEX on (user_id, started_at DESC)

workout_sets
├── id (uuid, PK)
├── workout_id (FK -> workouts, CASCADE)
├── exercise_id (FK -> exercises)
├── set_number (int)
├── reps (int)
├── weight_kg (decimal)
├── rpe (int, nullable, 1-10)
├── is_pr (boolean, default false) <-- computed by backend on insert
└── INDEX on (workout_id), INDEX on (exercise_id, user_id) for PR lookups

workout_templates
├── id (uuid, PK)
├── user_id (FK -> users)
├── name
├── exercises (JSON) -> [{ exercise_id, sets, reps, weight }]
└── INDEX on (user_id)

nutrition_logs
├── id (uuid, PK)
├── user_id (FK -> users)
├── food_name (text)
├── calories (int)
├── protein_g (decimal)
├── carbs_g (decimal)
├── fat_g (decimal)
├── meal_type (enum: breakfast, lunch, dinner, snack)
├── is_saved_meal (boolean)
├── date (date)
└── INDEX on (user_id, date)

body_metrics
├── id (uuid, PK)
├── user_id (FK -> users)
├── weight_kg (decimal)
├── date (date, unique per user)
└── INDEX on (user_id, date DESC)

daily_habits
├── id (uuid, PK)
├── user_id (FK -> users)
├── sleep_hours (decimal)
├── sleep_quality (int, 1-5)
├── water_ml (int)
├── alcohol (boolean)
├── alcohol_units (decimal, nullable)
├── notes (text, nullable)
├── date (date, unique per user)
└── INDEX on (user_id, date DESC)

strava_accounts
├── id (uuid, PK)
├── user_id (FK -> users, unique)
├── strava_athlete_id (bigint, unique)
├── access_token (text)
├── refresh_token (text)
├── token_expires_at (timestamp)
├── created_at
└── updated_at

run_activities
├── id (uuid, PK)
├── user_id (FK -> users)
├── strava_activity_id (bigint, unique)
├── distance_m (int)
├── moving_time_s (int)
├── elevation_gain_m (int)
├── average_pace_s_per_km (int)
├── start_time (timestamp)
├── source (enum: strava, manual)
├── raw (JSON) -> full Strava payload for debugging/future features
└── INDEX on (user_id, start_time DESC)

ai_conversations
├── id (uuid, PK)
├── user_id (FK -> users)
├── question (text)
├── response (text)
├── context_plan (JSON)       <-- intent classification result: domains, dateRange, needsWebSearch
├── context_snapshot (JSON)   <-- assembled context per domain sent to the LLM
├── web_search_results (JSON) <-- Tavily search results if web search was triggered (nullable)
├── context_tokens (int)      <-- tokens used by the context window
├── total_tokens (int)        <-- total tokens used (prompt + completion)
├── duration_ms (int)         <-- end-to-end pipeline execution time
├── domains_fetched (int)     <-- number of domains the context retriever queried
├── created_at
└── INDEX on (user_id, created_at DESC)
```

**12 tables total.** Normalized. Every query path has an index. JSON is used strategically (goals, templates, AI context plans/snapshots, raw Strava payloads) — not as a crutch.

---

## API Strategy: Hybrid GraphQL + REST

**Use GraphQL for:**
- **Dashboard** — One query that returns exactly the summary + chart fields the client needs. Different views (mobile summary vs desktop full charts) share one schema; no over-fetching. Cache key: query hash + variables.
- **AI coach** — One streaming operation (subscription or mutation with `@stream`/`@defer`) for "ask coach". Context pipeline status indicators and LLM response streamed back in real time.
- **Optional: nested reads** — Workouts with sets and exercise details, exercise history, nutrition for a date plus saved meals. One query, flexible shape; use DataLoader to avoid N+1.

**Use REST for:**
- **Auth** — Login, register, refresh, logout are standard HTTP flows; cookies and redirects are REST-friendly.
- **Strava** — OAuth callback and webhook are HTTP endpoints called by Strava; they must be REST.
- **Simple CRUD** — Log weight, delete nutrition entry, etc. REST is straightforward when the client does not need variable response shapes.

---

## API Endpoints

**REST (auth, Strava, CRUD)**

```
AUTH
  POST   /api/auth/register          -> Create account
  POST   /api/auth/login              -> Returns access + refresh tokens
  POST   /api/auth/refresh            -> Rotate refresh token
  POST   /api/auth/logout             -> Invalidate refresh token
  GET    /api/auth/me                 -> Current user profile
  PUT    /api/auth/me                 -> Update profile + goals

WORKOUTS
  GET    /api/workouts                -> List workouts (paginated, filterable by date range)
  POST   /api/workouts                -> Log complete workout with sets (transaction)
  GET    /api/workouts/:id            -> Single workout with all sets
  PUT    /api/workouts/:id            -> Update workout
  DELETE /api/workouts/:id            -> Delete workout
  GET    /api/workouts/stats          -> Volume trends, frequency, muscle group breakdown

EXERCISES
  GET    /api/exercises               -> List all (default + user custom), filterable by muscle group
  POST   /api/exercises               -> Create custom exercise
  GET    /api/exercises/:id/history   -> PR history and volume for specific exercise

TEMPLATES
  GET    /api/templates               -> User's saved templates
  POST   /api/templates               -> Save new template
  PUT    /api/templates/:id           -> Edit template
  DELETE /api/templates/:id           -> Delete template

NUTRITION
  GET    /api/nutrition?date=YYYY-MM-DD     -> All entries for a date
  POST   /api/nutrition                      -> Log food entry
  DELETE /api/nutrition/:id                  -> Delete entry
  GET    /api/nutrition/summary?range=7d     -> Daily averages over range
  GET    /api/nutrition/saved-meals          -> User's saved meals
  POST   /api/nutrition/saved-meals          -> Save a meal for reuse

BODY METRICS
  GET    /api/metrics/weight?range=30d       -> Weight entries with computed moving average
  POST   /api/metrics/weight                 -> Log weight

HABITS
  GET    /api/metrics/habits?range=30d       -> Habit entries over range
  POST   /api/metrics/habits                 -> Log today's habits
  PUT    /api/metrics/habits/:id             -> Edit habit entry
  GET    /api/metrics/streaks                -> Current streak counts

STRAVA / RUNS
  GET    /api/runs?range=30d                 -> Synced runs with distance, pace, elevation
  POST   /api/strava/connect                 -> Begin OAuth flow (redirect to Strava)
  GET    /api/strava/callback                -> OAuth callback, exchange code for tokens
  POST   /api/strava/webhook                 -> Strava webhook receiver for new/updated activities
  POST   /api/strava/sync                    -> Manually sync last 30 days of activities
```

**GraphQL** (single endpoint: `POST /graphql`)

- **Query `dashboard(range)`** — Returns exactly what the client asks for: `today { calories, protein, lastWorkout, lastRun, weight, sleep, streak }`, `charts { weightTrend, volumeWeekly, runDistanceWeekly, runPaceTrend, caloriesDaily, macros, habitsHeatmap, sleepTrend }`. Redis-cached per (query + variables); invalidated on new data.
- **Subscription `aiChat(question)`** — Streams context pipeline status indicators (which domains are being analyzed) followed by the LLM response. Frontend renders "Analyzing your bench press data..." then streams the coach's answer.
- **Query `aiConversations`** — List past conversations with context plans.
- **Query `aiConversation(id)`** — Single conversation detail including full context snapshot and pipeline trace.
- **Optional queries** — `workout(id) { sets { exercise { name } } }`, `exercise(id) { history }`, `nutrition(date)`, `savedMeals` for flexible nested reads.

---

## Build Stages

### Stage 1: Foundation (Days 1-2)

**What you build:**
- Scaffold React app (Vite + TypeScript + Tailwind + React Router)
- Scaffold Express app (TypeScript + Prisma + Zod) with **both REST and GraphQL** mounted: `/api/*` for REST, `POST /graphql` for GraphQL (e.g. Apollo Server or graphql-yoga)
- Docker Compose: app + mysql + redis (dev config)
- Prisma schema with all 12 tables, run migrations, write seed script (200 exercises, sample user with 30 days of fake data across all modules)
- Auth (REST): register, login, JWT access token (15 min) + refresh token (7 days, stored in Redis), auth middleware; same JWT used for GraphQL context when resolving protected queries
- Frontend: login/register pages, axios client with interceptor for auto-refresh, auth context, protected route wrapper
- Layout shell: sidebar navigation, header with user name, dark mode toggle, responsive mobile menu

**Junior developer version:** Uses plain `localStorage` for auth, no refresh tokens, no seed data, skips Docker, runs everything locally with `npm start`.

**Your version:** JWT with refresh token rotation (refresh tokens are single-use, stored in Redis, rotated on every refresh call — this is how production auth works). Docker from day 1. Seed script generates realistic data so your dashboard looks populated in demos and screenshots. Zod validates every request body.

---

### Stage 2: Workout Module (Days 3-5)

**What you build:**
- Backend: full CRUD with transactions (workout + sets created atomically), PR detection service (query historical max for each exercise, flag `is_pr` on insert), volume calculation service
- Frontend: exercise picker with search and muscle group filter, set logger (add rows, fill reps/weight/RPE, delete), workout history page with expandable cards, template save/load flow, PR badge animation when a new PR is hit

**Key differentiators:**
- **Transactions**: workout + all sets saved atomically. If set #5 fails validation, the whole workout rolls back. This shows you understand data integrity.
- **PR detection algorithm**: for each set logged, query `MAX(weight) WHERE exercise_id = X AND reps <= Y` from historical data. If current weight exceeds it, mark `is_pr = true`. This is actual business logic, not just CRUD.
- **Volume calculation**: `SUM(sets x reps x weight)` per muscle group per week, computed in a SQL query using date functions. Not calculated in JavaScript.
- **Service layer separation**: routes call services, services contain business logic, services call Prisma. Route files are thin. This is how real backends are structured.

---

### Stage 3: Nutrition Module (Days 6-7)

**What you build:**
- Backend: log food entry, daily summary aggregation (SQL query that sums calories/macros grouped by date), saved meals CRUD, weekly rolling averages
- Frontend: food entry form (name + macros), daily view with meal sections (breakfast/lunch/dinner/snack), progress bars showing calories and each macro vs daily target, saved meals dropdown for quick logging

**Key differentiators:**
- **Aggregation queries in SQL, not JavaScript**: `SELECT date, SUM(calories), SUM(protein_g)... FROM nutrition_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3 GROUP BY date` — the database does the math, not your app server.
- **Saved meals as a UX optimization**: shows you think about repeat user behavior, not just feature checkboxes.
- **Target comparison**: requires joining user goals with nutrition aggregations — a real query that touches two tables.

---

### Stage 3.5: Strava Run Integration (Days 7-8)

**What you build:**
- Backend: Strava OAuth2 integration (connect/disconnect), `strava_accounts` + `run_activities` tables, webhook endpoint to receive new activities, manual sync endpoint to backfill the last 30 days.
- Frontend: settings page to connect Strava, simple runs list showing recent activities (distance, pace, elevation, date), manual "Sync now" button.
- Sync logic: map Strava activities into `run_activities`, ignore non-run types, and make sync idempotent (no duplicate rows if Strava retries webhooks).

**Key differentiators:**
- **OAuth2 with refresh**: you store Strava access + refresh tokens and rotate them when expired, just like you do with your own JWTs.
- **Webhook-driven sync**: new runs appear automatically shortly after they are recorded in Strava — no manual imports.
- **Idempotent imports**: you use `strava_activity_id` as a unique key so replays/webhook retries can't create duplicates.

---

### Stage 4: Body Weight + Habits (Days 8-9)

**What you build:**
- Backend: weight CRUD with unique constraint (one entry per user per day), moving average calculation, trend slope computation, habit CRUD with streak calculation
- Frontend: weight entry with trend indicator, weight chart with raw data points + smoothed moving average line, habit entry form (sleep/water/alcohol), streak display cards, habit calendar heat map

**Key differentiators:**
- **Exponential moving average**: not a simple average — it weights recent data more heavily. This is ~15 lines of math but shows algorithmic thinking. Implemented as a pure function with unit tests.
- **Streak calculation**: single SQL query that finds the current streak. Not a loop in JavaScript.
- **JSON for habits**: the habits schema uses a JSON column for extensibility. In an interview you say: "I used a JSON column for the habits module because habit types are likely to change — adding a 'meditation' tracker shouldn't require a migration. But I used normalized columns for workouts and nutrition because those schemas are stable and need relational queries."

---

### Stage 5: Dashboard (Days 10-11)

**What you build:**
- Backend: **GraphQL query `dashboard(range)`** that runs aggregation queries across ALL modules (optimized MySQL queries), returns exactly the fields the client requests, caches the result in Redis by (query + variables) with a 5-minute TTL, invalidates cache when any new data is logged.
- Frontend: GraphQL client (e.g. Apollo Client) requests only the summary and chart fields needed; responsive grid of summary cards + charts, date range selector that refetches with new variables, skeleton loaders while data loads

**Key differentiators:**
- **Single GraphQL query for dashboard**: one request with the exact shape needed. Backend runs 4-5 optimized SQL queries in parallel (`Promise.all`), assembles the response, caches by query + variables.
- **Redis caching with invalidation**: dashboard result is cached for 5 minutes. When you log a workout (or any data), the cache key is invalidated so the next dashboard load gets fresh data. Measured: "Dashboard response time: 800ms uncached -> 45ms cached."
- **SQL query optimization**: EXPLAIN ANALYZE on dashboard queries, composite indexes. "Dashboard query dropped from 340ms to 12ms after adding composite index on (user_id, date)."
- **Skeleton loading**: shows you understand perceived performance, not just actual performance.

---

### Stage 6: AI Coach with Context Engineering Pipeline (Days 12-15)

This is the most technically dense stage and the one that demonstrates **AI/ML engineering capabilities**. Split into two sub-stages.

#### Stage 6a: Context Engine + Basic Streaming (Days 12-13)

**What you build:**
- **Intent classifier**: deterministic router that tags each question with relevant data domains (`workouts`, `nutrition`, `body_metrics`, `habits`, `runs`, `exercise_history`), a date range, and a `needsWebSearch` flag. Rule-based + keyword matching. Zero latency, fully testable.
- **Context retriever**: one `buildContext()` function per domain that queries the database and returns a compressed summary (not raw rows). All tagged domains fetched in parallel via `Promise.all`.
- **Prompt assembler**: combines system prompt + user profile/goals + domain contexts + conversation history (last 5 messages) + the question into a single optimized prompt.
- **Gemini API integration**: single streaming LLM call via the Google Generative AI SDK. Response streamed via GraphQL subscription or SSE.
- **Conversation storage**: save question + response + context_plan + context_snapshot + performance metrics to `ai_conversations` table.

#### Stage 6b: Web Search + Chat UI + Polish (Days 14-15)

**What you build:**
- **Web search enrichment**: Tavily Search API integration. When the intent classifier flags `needsWebSearch`, the pipeline makes a search call and includes results in the prompt. The LLM combines external knowledge with the user's actual data for personalized advice.
- **Conversation memory**: last 5 messages included in prompt assembly so follow-up questions work naturally. "What about my sleep?" works after asking about bench press.
- **Frontend chat UI**: message history, streaming text rendering, domain-based status indicators ("Analyzing your bench press data...", "Checking nutrition patterns..."), quick prompt buttons, conversation list sidebar.
- **Context plan viewer**: collapsible panel per message showing which domains were analyzed, context tokens used, and response time. Demonstrates observability.
- **Guardrails**: max context size cap (2000 tokens), 15-second timeout on Gemini call, graceful fallback if a domain fetcher fails (continue with available data).

**Junior developer version:** Sends "here's my data, what do you think?" to an LLM with no structure. No streaming. Response takes 10 seconds with no feedback. No conversation history. No selective data retrieval.

**Your version:**
- **Context engineering pipeline**: deterministic intent classification, selective domain retrieval, token-optimized prompt assembly. The LLM gets exactly the right data, not everything.
- **Hybrid context**: pipeline combines database queries with web search for questions that need external knowledge. The LLM personalizes generic advice using the user's actual metrics.
- **Full observability**: every conversation stores the complete pipeline trace: context plan, domain snapshots, web search results, token counts, and execution time. You can debug exactly why any response was good or bad.
- **Token optimization**: selective retrieval keeps context under 1200 tokens avg vs 8000+ for a static dump. This means faster responses and lower API cost.
- **Sub-2-second responses**: one LLM call vs 3-5 agent iterations. The pipeline adds ~50ms of overhead for intent classification + parallel data fetching. The rest is just the Gemini streaming time.
- **Deterministic and testable**: the intent classifier is pure functions with unit tests. You can verify that "why is my bench stalling" always tags `[exercise_history, workouts, habits, nutrition]`. No non-deterministic LLM routing to debug.

---

### Stage 7: Docker + CI/CD (Days 16-18)

**What you build:**
- Multi-stage Dockerfiles for frontend and backend (build stage -> production stage, final image has no dev dependencies)
- Production Docker Compose with all 5 services, health checks, restart policies, resource limits, environment-based config
- Nginx configuration: reverse proxy, gzip compression, rate limiting, security headers, static file caching
- GitHub Actions CI pipeline (runs on PR): lint -> typecheck -> unit tests -> integration tests -> build check
- GitHub Actions CD pipeline (runs on merge to main): all CI steps -> build Docker images -> push to GitHub Container Registry -> deploy to server via SSH

**Key differentiators:**
- **Multi-stage builds**: production image is 200MB instead of 1.2GB.
- **Health checks**: Docker knows when your app is actually ready, not just when the container started.
- **Nginx production config**: rate limiting (100 req/min per IP), gzip on all text responses, security headers (X-Frame-Options, CSP, HSTS), static asset caching with cache-busting hashes.
- **CI that actually gates deployment**: PRs cannot merge without passing lint, type checks, and tests.
- **Automated deployment**: merge to main -> tests pass -> Docker image built and pushed -> deployed to production automatically. Zero manual steps.

---

### Stage 8: Testing (Days 18-19)

**What you build:**
- **Unit tests (Vitest)**: moving average algorithm, PR detection logic, streak calculation, TDEE calculator, macro aggregation, **intent classifier** (verify domain tagging for 20+ question patterns), **context formatter** functions (verify compression output)
- **Integration tests (Vitest + Supertest + test database)**: test actual API routes against a real MySQL instance. Test workout creation (verify PR detection works end-to-end), test dashboard caching (verify Redis is used), test auth flow (register -> login -> access protected route -> refresh token), **test context pipeline end-to-end** (seed test data, ask question, verify correct domains were fetched and context was assembled)
- **Context pipeline tests**: verify intent classification accuracy (bench press question tags `exercise_history`), verify web search triggers only when flagged, verify context stays under token budget, verify graceful degradation when a domain fetcher fails
- **E2E test (Playwright)**: one complete user journey — register -> log a workout -> log food -> log weight -> log habits -> check dashboard shows data -> ask AI coach a question -> verify streaming response and status indicators appear

**Strategic coverage:** "I focused test coverage on business logic and the context engineering pipeline. PR detection has 100% coverage because a false PR notification erodes user trust. The intent classifier has 100% coverage because incorrect domain tagging produces irrelevant context and bad AI responses. Simple CRUD routes have integration tests but lower unit coverage because the risk is lower."

---

### Stage 9: Cloud + Terraform (Days 20-21)

**What you build:**
- Terraform modules for AWS infrastructure:
  - VPC with public + private subnets
  - EC2 instance (or ECS Fargate) running Docker Compose
  - RDS MySQL (free tier) in private subnet
  - ElastiCache Redis (or Redis on EC2 to save cost)
  - S3 bucket for Terraform state (remote backend)
  - Route53 for custom domain
  - Security groups with least-privilege rules
  - CloudWatch alarms: CPU > 80%, API error rate > 5%, response time p95 > 2s
- Separate staging and production using Terraform workspaces or variable files
- SSL certificate via ACM

**Key differentiators:**
- **Infrastructure-as-code**: entire cloud setup reproducible from a single `terraform apply`.
- **Network architecture**: VPC with public/private subnets. Database is in a private subnet — not exposed to the internet.
- **Monitoring with alarms**: CloudWatch alarms prove you think about operational readiness.
- **Real URL**: `vitalsync.yourdomain.com` on your resume with a live demo.

---

### Stage 10: Optimizations + Documentation (Days 22-25)

**Measured optimizations:**

| Optimization | Before | After |
|---|---|---|
| Database indexes | Dashboard query: 340ms (sequential scan) | 12ms (index scan) with EXPLAIN ANALYZE proof |
| Redis caching | Dashboard API: 800ms | 45ms (94% improvement) |
| Bundle splitting | Initial bundle: 420KB | 180KB with React.lazy() code splitting |
| AI context (pipeline) | Static dump: ~8000 tokens per query | Context engine: ~800 avg tokens (selective domain retrieval) |
| AI response latency | Static dump: ~4s (large prompt) | Context engine: ~1.8s (small targeted prompt, single LLM call) |
| API compression | Dashboard JSON: 24KB | 4.8KB with gzip (80% reduction) |

**Documentation:**
- Architecture diagram (Excalidraw) showing all containers, data flow, context engineering pipeline flow, and cloud infrastructure
- README with: project overview, screenshots (dark mode dashboard), tech stack with justifications, API documentation (REST endpoints + GraphQL schema/operations for dashboard and AI), "Technical Decisions" section (including why context engineering over agents, why hybrid GraphQL + REST), "Optimizations" section with real numbers, setup instructions (docker compose up), "Future Improvements" section
- Clean git history with conventional commits, meaningful PR descriptions for major features

---

## What You Say in the Interview

> "I built VitalSync, a full-stack health tracking platform with an AI personal trainer. The API is hybrid: GraphQL for the dashboard and AI coach, REST for auth, Strava OAuth, and CRUD.
>
> The AI coach is built around a context engineering pipeline rather than an agent. Instead of letting the LLM make multiple round trips to decide what data to fetch, I built a deterministic pipeline: an intent classifier tags each question with relevant health domains, a context retriever fetches compressed summaries from only those domains in parallel, an optional web search enricher adds external knowledge for questions the database can't answer, and a prompt assembler constructs a token-optimized prompt. Single Gemini API call, streamed response.
>
> For 'why is my bench stalling,' the classifier tags exercise_history, workouts, habits, and nutrition. The retriever fetches four domain summaries in parallel (~50ms), and the assembler builds an 800-token context. The LLM gets exactly the right data and responds in under 2 seconds. A static dump would be 8000 tokens with mostly irrelevant data. An agent would need 3-5 LLM round trips.
>
> Every conversation stores the full pipeline trace: context plan, domain snapshots, web search results, token counts, and execution time. The intent classifier is pure functions with 100% test coverage because incorrect domain tagging directly degrades response quality.
>
> The backend uses a service-layer architecture with Zod validation and centralized error handling. I containerized everything with Docker, with multi-stage builds bringing the production image from 1.2GB to 200MB. CI/CD runs through GitHub Actions with automated lint, type checks, unit tests, integration tests against a real MySQL instance, and deployment.
>
> Infrastructure is provisioned with Terraform on AWS: VPC, EC2, RDS, ElastiCache, CloudWatch alarms. I ran EXPLAIN ANALYZE on my dashboard queries and added composite indexes that dropped query time from 340ms to 12ms. Redis caching brought the full dashboard response from 800ms to 45ms."

Every sentence maps to a real, demonstrable piece of your codebase. The context engineering section demonstrates you understand that **the real skill in AI applications is what you feed the model, not how many times you call it.**

---

## Junior Developer vs You — Summary

| Dimension | Junior Developer | You |
|---|---|---|
| **Auth** | localStorage, no refresh, no expiry handling | JWT + refresh token rotation in Redis, auto-refresh interceptor, secure httpOnly cookies |
| **Data modeling** | Flat tables, no relations, everything nullable | Normalized schema, foreign keys, constraints, strategic JSON, composite indexes |
| **Business logic** | CRUD only — save and retrieve | PR detection algorithm, moving averages, streak calculation, volume aggregation, trend analysis |
| **API design** | Random endpoint names, inconsistent responses | Hybrid GraphQL + REST: GraphQL for dashboard (exact fields, no over-fetch) and AI streaming; REST for auth, Strava, CRUD. Zod on REST; schema + resolvers for GraphQL. |
| **Database queries** | `SELECT *` everywhere, N+1 problems, no indexes | Aggregation queries in SQL, EXPLAIN ANALYZE optimizations, indexed hot paths, connection pooling |
| **Frontend** | Basic forms and lists, no loading states | Skeleton loaders, optimistic updates, code-split routes, streaming SSE rendering, responsive charts |
| **AI integration** | Raw data dump + single LLM call, no streaming | Context engineering pipeline: intent classification, selective domain retrieval, web search enrichment, token-optimized prompt assembly, streaming response, full pipeline observability |
| **Caching** | None | Redis-cached dashboard with intelligent invalidation, measured performance improvement |
| **Docker** | Single Dockerfile, `npm start` | Multi-stage builds, 5-container Compose, health checks, resource limits, Nginx reverse proxy |
| **CI/CD** | Push to main, manual deploy | Automated pipeline: lint -> typecheck -> tests -> build -> push -> deploy. PRs gated by CI. |
| **Testing** | "Will add later" | Unit tests on algorithms + intent classifier (100% coverage), integration tests on real DB, E2E test on critical flow. Strategic coverage. |
| **Cloud** | Heroku free tier | Terraform IaC, VPC with subnets, RDS, ElastiCache, CloudWatch alarms, custom domain with SSL |
| **Optimizations** | None measured | Indexed queries (340ms->12ms), Redis caching (800ms->45ms), bundle splitting (420KB->180KB), AI context (8000->800 avg tokens), response latency (~4s->~1.8s) |

---

## Tech Stack (Final)

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Industry standard, fast dev build |
| Styling | Tailwind CSS + shadcn/ui | Rapid UI development, consistent design |
| Charts | Recharts | React-native charting, good composability |
| Backend | Express + TypeScript | Explicit backend, clear separation |
| API (read/aggregate) | GraphQL (Apollo Server / graphql-yoga) | Dashboard query, AI chat streaming, client-defined response shape |
| API (auth, integrations, CRUD) | REST | Auth, Strava OAuth/webhook, simple writes; fixed HTTP contract |
| ORM | Prisma | Type-safe queries, schema-driven migrations |
| Validation | Zod | Runtime type validation, shared schemas |
| Database | MySQL | Relational + JSON flexibility |
| Cache | Redis 7 | Session store, dashboard cache, rate limiting |
| AI Model | Google Gemini | Strong analytical reasoning, streaming support |
| AI Pipeline | Custom context engine (TypeScript) | Intent classification, selective retrieval, prompt assembly |
| Web Search | Tavily Search API | External knowledge enrichment for the AI coach |
| Auth | JWT + refresh tokens | Stateless auth with secure rotation |
| Containerization | Docker + Docker Compose | 5-container production setup |
| Reverse Proxy | Nginx | Routing, compression, rate limiting |
| CI/CD | GitHub Actions | Automated test + build + deploy pipeline |
| IaC | Terraform | Reproducible AWS infrastructure |
| Cloud | AWS (EC2, RDS, ElastiCache, S3, Route53, CloudWatch) | Production-grade hosting |
| Unit Testing | Vitest | Fast, TypeScript-native |
| Integration Testing | Vitest + Supertest | API route testing against real database |
| E2E Testing | Playwright | Browser-based user flow testing |