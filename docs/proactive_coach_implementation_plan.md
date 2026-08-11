# Proactive Coach — Google Health Integration

## What Are We Building? (The 30-Second Version)

Right now, VitalSync's AI coach only talks when you talk to it. You type "how's my week?" and it answers.

We're adding a new superpower: **when you finish a walk, run, or workout on your Fitbit/Pixel Watch, VitalSync automatically notices, pulls the data, combines it with everything it already knows about you (nutrition, sleep, habits, goals), and posts a smart insight on your dashboard — before you even ask.**

```
TODAY:
  You → "How was my walk?" → Coach answers

AFTER WE BUILD THIS:
  You finish a walk → VitalSync sees it automatically → 
  Coach posts: "Nice walk! But you only ate 1800 kcal 
  and burned 280 on this walk. You're running a bigger 
  deficit than planned. Consider a protein-rich dinner."
```

That's it. Everything below is just *how* we make that happen.

---

## The Four Pieces We Need to Build

Think of it like a relay race with 4 runners:

```
 🏃 Runner 1        🏃 Runner 2         🏃 Runner 3        🏃 Runner 4
 "Let me in"       "Something          "What              "Here's what
                    happened!"          happened?"          I think"

 Google OAuth  →   Webhook     →   Data Fetch &    →   LLM Insight
 (connect the      (Google          Store               (AI analyzes
  account)          notifies us)     (we pull the        and posts to
                                     actual data)        dashboard)
```

Let me explain each one.

---

## Runner 1: Google OAuth ("Let Me In")

### What is OAuth? (Explain Like I'm 5)

Imagine you want a dog-walking service to pick up your dog from your house. You don't give them your house keys. Instead, you tell your smart lock: "Let the dog walker in, but ONLY between 2-3pm, and ONLY to the backyard." 

**That's OAuth.** The user never gives VitalSync their Google password. Instead, Google shows them a screen that says:

```
┌─────────────────────────────────────────┐
│         Sign in with Google             │
│                                         │
│  VitalSync wants to:                    │
│  ☑ View your heart rate data            │
│  ☑ View your activity data              │
│  ☑ View your sleep data                 │
│                                         │
│  [Allow]          [Deny]                │
└─────────────────────────────────────────┘
```

If they click Allow, Google gives VitalSync a **token** (like a temporary key). VitalSync uses that token to read their health data. The user can revoke it anytime.

### How It Works (Step by Step)

```
Step 1: User clicks "Connect Google Health" in VitalSync
        
Step 2: VitalSync redirects them to Google's consent page
        URL: https://accounts.google.com/o/oauth2/auth?
             client_id=OUR_APP_ID&
             scope=health.activity+health.heart_rate+health.sleep&
             redirect_uri=https://vitalsync.../callback

Step 3: User clicks "Allow" on Google's page

Step 4: Google redirects back to VitalSync with a one-time CODE
        https://vitalsync.../api/google-health/callback?code=abc123

Step 5: VitalSync exchanges that code for an ACCESS TOKEN + REFRESH TOKEN
        POST https://oauth2.googleapis.com/token
        { code: "abc123", client_id: "...", client_secret: "..." }

Step 6: VitalSync saves both tokens in the database
        access_token  → short-lived (1 hour), used to call the API
        refresh_token → long-lived, used to get new access tokens
```

**You've already built this exact flow for Strava.** The Google version is the same pattern — different URL, same dance.

### What We Store

```sql
google_health_accounts
├── user_id          → which VitalSync user this belongs to
├── google_account_id → Google's unique ID for the account
├── access_token     → the "key" to read their data (expires in 1 hour)
├── refresh_token    → used to get a new access_token when it expires
├── token_expires_at → when the access_token stops working
└── last_sync_at     → when we last pulled data
```

---

## Runner 2: Webhook ("Something Happened!")

### What is a Webhook? (Explain Like I'm 5)

**Polling** is like checking your mailbox every 5 minutes to see if a package arrived. Wasteful — 99% of the time the mailbox is empty.

**Webhook** is like the mailman ringing your doorbell. You don't check — you get notified.

```
POLLING (wasteful):
  VitalSync: "Any new data?"  →  Google: "No"
  VitalSync: "Any new data?"  →  Google: "No"
  VitalSync: "Any new data?"  →  Google: "No"
  VitalSync: "Any new data?"  →  Google: "Yes! A walk."
  
WEBHOOK (efficient):
  ...silence...
  Google: *rings doorbell* → "Hey VitalSync, new walk data!"
  VitalSync: "Got it, pulling the details now."
```

### How Google Health Webhooks Work

When we connect a user, we also **register a subscriber** with Google:

```
POST https://health.googleapis.com/v4/projects/OUR_PROJECT/subscribers
{
  "endpointUri": "https://vitalsync.ravibollepalli.me/api/google-health/webhook",
  "subscriberConfigs": [
    { "dataType": "steps" },
    { "dataType": "heart-rate" },
    { "dataType": "sleep" },
    { "dataType": "exercise" }
  ]
}
```

This tells Google: "Whenever ANY user who connected through our app has new data, POST a notification to our webhook URL."

### The Verification Handshake

Before Google trusts our webhook, it tests it:

```
Google sends POST to our endpoint WITH a secret header
  → Our server responds 200 OK ✅

Google sends POST to our endpoint WITHOUT the secret header  
  → Our server responds 401 Unauthorized ✅

Both passed → Google activates our webhook
```

This is a security measure — Google wants to confirm we actually own that endpoint and that we check authorization.

### What the Webhook Notification Looks Like

When a user finishes a walk, Google POSTs something like:

```json
{
  "userId": "google-user-id-12345",
  "dataType": "exercise",
  "updatedAt": "2026-06-02T21:00:00Z"
}
```

> [!NOTE]
> The webhook only tells us *"something changed"* — it does NOT include the actual data. We have to make a separate API call (Runner 3) to fetch the details. This is the same pattern as Strava's webhooks.

---

## Runner 3: Data Fetch & Store ("What Happened?")

When the webhook fires, we call the Google Health API to get the actual data:

```
GET https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints
    ?startTime=2026-06-02T20:00:00Z
    &endTime=2026-06-02T21:30:00Z
    
Headers: Authorization: Bearer <user's access token>
```

Google responds with something like:

```json
{
  "dataPoints": [
    {
      "dataType": "exercise",
      "startTime": "2026-06-02T20:15:00Z",
      "endTime": "2026-06-02T21:00:00Z",
      "values": {
        "activityType": "WALKING",
        "durationMinutes": 45,
        "steps": 5200,
        "activeCaloriesBurned": 280,
        "averageHeartRateBpm": 112,
        "distanceMeters": 3800
      }
    }
  ]
}
```

We save this to a new table:

```sql
health_data_points
├── user_id       → which VitalSync user
├── data_type     → "exercise", "heart-rate", "sleep", etc.
├── value         → { activityType: "WALKING", steps: 5200, ... } (JSON)
├── recorded_at   → when the activity happened
├── source        → "google_health"
└── created_at    → when we stored it
```

**Why store it?** Two reasons:
1. The AI coach can reference it later ("show me my walks this week")
2. We have historical data if we want to add ML/trends later

---

## Runner 4: LLM Insight ("Here's What I Think")

This is the fun part — and it's the easiest because we already have all the building blocks.

Once we have the activity data, we:

1. **Grab the user's VitalSync context** (reuse `buildUserContext()` we already have)
2. **Combine it with the new activity data** into a prompt
3. **Call Claude** (same as the existing coach, but with a different system prompt)
4. **Save the response** as a "proactive insight"
5. **Show it on the dashboard**

### The Prompt We Send

```
SYSTEM: You are a proactive fitness coach. A user just completed 
an activity. Analyze the activity data alongside their current 
health context and generate a brief, helpful insight (2-3 sentences). 
Be specific with numbers. Connect dots across their activity, 
nutrition, sleep, and goals. Be encouraging but honest.

USER:
ACTIVITY JUST COMPLETED:
  Type: Walking
  Duration: 45 minutes
  Steps: 5,200
  Avg Heart Rate: 112 bpm
  Calories Burned: 280 kcal

USER CONTEXT:
  Today's nutrition: 1,800 kcal eaten (target: 2,500)
  Protein: 95g (target: 150g)
  Last night's sleep: 5.2 hours (target: 8)
  Current weight: 82.4 kg (trend: losing 0.3 kg/week)
  Goal: reach 80 kg
  Memory: [injury] recovering from mild knee strain
  Last workout: 2 days ago (Push Day)
  Alcohol-free streak: 4 days
```

### The Response We Get

> "Nice 45-minute walk — smart choice for active recovery with your knee. Your HR averaged 112 bpm, which is a solid moderate zone. Heads up though: you've only eaten 1,800 kcal today and just burned another 280, putting you at a 980 kcal deficit with dinner still to go. With only 5.2 hours of sleep last night, your body needs fuel to recover. Try to hit your protein target tonight."

### Where We Store It

```sql
proactive_insights
├── user_id       → which user
├── type          → "post_activity" (we might add more types later)
├── severity      → "info", "warning", "alert"
├── title         → "Post-Walk Insight"
├── message       → the AI-generated text above
├── data_snapshot → the activity data + context that triggered it
├── is_read       → false (until user sees it)
├── is_dismissed  → false (until user dismisses it)
├── created_at    → when it was generated
```

### How It Shows on the Dashboard

A new section at the top of the dashboard — above the existing cards:

```
┌──────────────────────────────────────────┐
│  🟢 Post-Walk Insight           2m ago  │
│                                          │
│  Nice 45-minute walk — smart choice for  │
│  active recovery with your knee. Your    │
│  HR averaged 112 bpm, solid moderate...  │
│                                          │
│  💬 Ask Coach About This    ✕ Dismiss    │
└──────────────────────────────────────────┘
```

If they click "Ask Coach About This," it opens the existing Coach page with the insight pre-loaded as context — so they can have a follow-up conversation about it.

---

## The Complete Data Flow (Everything Together)

```
 ┌─────────────┐
 │ Fitbit /    │   User finishes a 45-min walk
 │ Pixel Watch │
 └──────┬──────┘
        │ syncs automatically
        ▼
 ┌─────────────┐
 │ Google      │   Stores the activity data
 │ Health API  │
 └──────┬──────┘
        │ POST webhook notification
        ▼
 ┌─────────────────────────────────────────────────────┐
 │ VitalSync Server                                     │
 │                                                      │
 │  1. Webhook receives: "user X has new exercise data" │
 │                           │                          │
 │  2. Fetch data from       │                          │
 │     Google Health API  ◄──┘                          │
 │     (45 min walk, 5200 steps, 112 bpm)               │
 │                           │                          │
 │  3. Save to               │                          │
 │     health_data_points ◄──┘                          │
 │                           │                          │
 │  4. Build user context    │  (reuse existing code)   │
 │     nutrition + sleep +   │                          │
 │     goals + memory     ◄──┘                          │
 │                           │                          │
 │  5. Call Claude with      │                          │
 │     activity + context ◄──┘                          │
 │                           │                          │
 │  6. Save insight to       │                          │
 │     proactive_insights ◄──┘                          │
 │                                                      │
 └──────────────────────┬──────────────────────────────┘
                        │
                        ▼
 ┌─────────────────────────────────────────┐
 │ Dashboard                               │
 │                                         │
 │  🟢 Post-Walk Insight                   │
 │  "Nice 45-min walk! But you've only     │
 │   eaten 1800 kcal and just burned 280.  │
 │   Consider a protein-rich dinner."      │
 │                                         │
 │  💬 Ask Coach    ✕ Dismiss     2m ago   │
 │                                         │
 │  ── Hey, Ravi 👋 ────────────────────   │
 │  ... existing dashboard ...             │
 └─────────────────────────────────────────┘
```

---

## What We Need to Build (File by File)

### Step 1: Database + Config

#### [MODIFY] [schema.prisma](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/server/prisma/schema.prisma)
Add 3 new models: `GoogleHealthAccount`, `HealthDataPoint`, `ProactiveInsight`
Add relations to the `User` model

#### [MODIFY] [env.ts](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/server/src/config/env.ts)
Add Google OAuth environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_HEALTH_WEBHOOK_SECRET`

#### [MODIFY] [.env.example](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/.env.example)
Document the new environment variables

---

### Step 2: Google Health Service (OAuth + Data Fetching)

#### [NEW] `server/src/services/googleHealth.service.ts`
All Google Health API interactions in one file:
- `getAuthUrl()` → build the Google OAuth consent URL
- `exchangeCodeForTokens(code)` → trade the one-time code for tokens
- `refreshAccessToken(userId)` → get a new access token when it expires
- `fetchActivityData(userId, startTime, endTime)` → pull exercise data
- `fetchHeartRateData(userId, startTime, endTime)` → pull HR data
- `fetchSleepData(userId, startTime, endTime)` → pull sleep data
- `registerWebhookSubscriber()` → register our webhook with Google
- `disconnectAccount(userId)` → revoke tokens and delete from DB

This follows the exact same pattern as [run.service.ts](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/server/src/services/run.service.ts) (Strava integration).

---

### Step 3: Routes (OAuth Flow + Webhook)

#### [NEW] `server/src/routes/googleHealth.routes.ts`
```
GET  /api/google-health/connect      → Returns Google OAuth URL (like Strava)
GET  /api/google-health/callback     → Handles redirect from Google
POST /api/google-health/webhook      → Receives webhook notifications
POST /api/google-health/sync         → Manual sync trigger
GET  /api/google-health/status       → Is this user connected?
DELETE /api/google-health/disconnect → Remove the connection
```

#### [NEW] `server/src/routes/insights.routes.ts`
```
GET   /api/insights                  → List unread insights
PATCH /api/insights/:id/read         → Mark as read
PATCH /api/insights/:id/dismiss      → Dismiss
GET   /api/insights/count            → Unread count (for badge)
```

#### [MODIFY] [index.ts](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/server/src/index.ts)
Mount both new route files

---

### Step 4: Proactive Coach (LLM Integration)

#### [NEW] `server/src/services/proactiveCoach.service.ts`
The orchestrator — called when the webhook fires:
1. Calls `googleHealth.service` to fetch the new activity data
2. Calls existing `buildUserContext()` to get the user's VitalSync context
3. Builds a prompt combining activity + context
4. Calls Claude via the existing Bedrock setup
5. Saves the result to `proactive_insights`

#### [MODIFY] [prompts.ts](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/server/src/services/ai/prompts.ts)
Add one new prompt function: `buildProactiveInsightPrompt(activityData, userContext)`

---

### Step 5: Frontend

#### [NEW] `client/src/components/InsightCard.tsx`
The notification card component (glassmorphism, severity colors, dismiss animation)

#### [MODIFY] [DashboardPage.tsx](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/client/src/pages/DashboardPage.tsx)
Add the insights section at the top (fetch from `/api/insights`)

#### [MODIFY] [ProfilePage.tsx](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/client/src/pages/ProfilePage.tsx)
Add "Connect Google Health" button (same pattern as Strava connect)

#### [MODIFY] [App.tsx](file:///Users/ravichandu/Documents/Job%20Hunt%20-%2026/Projects/vital-sync/client/src/App.tsx)
Add callback route + unread badge

---

## What About Testing Without a Fitbit?

If you don't have a wearable device, we build a **mock data script** that simulates what Google Health API would send. You run it, it creates fake activity data and triggers the same pipeline — so you can test the entire flow end-to-end.

```bash
npx ts-node scripts/simulate-activity.ts --type walk --duration 45 --steps 5200
# → Creates a health_data_point
# → Triggers proactive coach
# → Insight appears on dashboard
```

This means we can build and demo everything without a real device.

---

## Build Order

| Order | What | Depends On | Effort |
|:--|:--|:--|:--|
| **1** | Prisma schema + migration | Nothing | Small |
| **2** | Env config for Google OAuth | Nothing | Small |
| **3** | Google Health service (OAuth + data fetch) | Step 1, 2 | Medium |
| **4** | Google Health routes (OAuth flow + webhook) | Step 3 | Medium |
| **5** | Proactive coach service (LLM insight pipeline) | Step 3 | Small — reuses existing AI code |
| **6** | Insights routes (CRUD for dashboard) | Step 1 | Small |
| **7** | Frontend: Profile page (connect button) | Step 4 | Small |
| **8** | Frontend: InsightCard + Dashboard section | Step 6 | Medium |
| **9** | Mock data script (testing without a device) | Step 5 | Small |

---

## Verification Plan

### Automated
- Google Health service unit tests (mock API responses for OAuth, data fetch, token refresh)
- Proactive coach integration test: mock activity data → verify LLM called → verify insight stored
- Insights routes: verify CRUD operations + auth

### Manual
1. Run the mock data script → verify insight appears on dashboard
2. Connect a real Google account (if device available) → verify OAuth flow
3. Trigger a real activity → verify webhook → data → insight pipeline end-to-end

---

## Open Questions

> [!IMPORTANT]
> **Google Cloud Console setup**: Before we write code, you'll need to create a Google Cloud project, enable the Health API, and set up OAuth credentials. I can walk you through this step by step — it takes about 10 minutes. Want to do that first, or should we start building with mock data and plug in real credentials later?

> [!IMPORTANT]
> **Do you have a Fitbit or Pixel Watch?** Either way we can build everything — I just want to know whether to prioritize the mock data script (no device) or the real OAuth flow (has device).
