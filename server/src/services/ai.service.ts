import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { prisma } from '@/config/database';
import { buildUserContext, getSystemInstruction, getMemoryExtractionPrompt } from './ai/prompts';
import { coachTools } from './ai/tools';
import { executeToolCall, classifyError } from './ai/executor';

// Initialize the Google SDK with your secure API key
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Helicone request options (reused for the main agent call)
const getHeliconeOptions = (userId: string) =>
  env.HELICONE_API_KEY
    ? {
        baseUrl: "https://gateway.helicone.ai",
        customHeaders: {
          "Helicone-Auth": `Bearer ${env.HELICONE_API_KEY}`,
          "Helicone-Target-Url": "https://generativelanguage.googleapis.com",
          "Helicone-User-Id": userId,
        },
      }
    : undefined;

/**
 * STEP 2 (Background): Memory Extractor
 * A separate, focused LLM call with NO tools registered.
 * Because there are no tools, we can use responseMimeType: 'application/json'
 * for guaranteed valid JSON output every single time.
 * Fires after the user already has their reply — non-blocking.
 */
async function extractAndSaveMemory(
  userId: string,
  userMessage: string,
  aiResponse: string,
  currentMemory: any[]
) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const extractionPrompt = getMemoryExtractionPrompt(userMessage, aiResponse, currentMemory, todayStr);

    // No tools here — so JSON mode works perfectly
    // Also route through Helicone for full observability on both LLM calls
    const heliconeOpts = getHeliconeOptions(userId);
    const memoryModel = genAI.getGenerativeModel(
      {
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
        }
      },
      heliconeOpts
        ? {
            ...heliconeOpts,
            customHeaders: {
              ...heliconeOpts.customHeaders,
              "Helicone-Session-Name": "memory-extractor",
            }
          }
        : undefined
    );

    const result = await memoryModel.generateContent(extractionPrompt);
    const rawJson = result.response.text().trim();
    const updatedMemory = JSON.parse(rawJson);

    if (Array.isArray(updatedMemory)) {
      await prisma.user.update({
        where: { id: userId },
        data: { aiMemory: updatedMemory }
      });
      console.log("✅ Memory Extracted & Saved:", updatedMemory);
    }
  } catch (err) {
    // Graceful degradation — user experience is unaffected.
    // The conversation reply was already sent before this ran.
    console.warn("⚠️ Memory extraction failed (non-critical):", (err as Error).message);
  }
}

/**
 * STEP 1 (Main): The Agent — talks to the user and calls tools.
 * Returns plain text directly. No JSON parsing required.
 */
async function chatWithCoach(userId: string, userMessage: string, history: any[] = []) {

  // Build live dashboard context (workouts, nutrition, streaks, profile in parallel)
  const contextString = await buildUserContext(userId);
  const systemInstruction = getSystemInstruction(contextString);

  // Extract current memory for the extractor to use later
  const profile = await prisma.user.findUnique({ where: { id: userId }, select: { aiMemory: true } });
  const currentMemory = (profile?.aiMemory as any[]) || [];

  // Initialize the Agent model — has tools, speaks plain text
  const agentModel = genAI.getGenerativeModel(
    {
      model: 'gemini-2.5-flash',
      systemInstruction: systemInstruction,
      tools: coachTools,
    },
    getHeliconeOptions(userId)
  );

  const chat = agentModel.startChat({ history });

  // ==========================================
  // REACT AGENT LOOP
  // The agent runs multiple turns autonomously:
  //   1. Send message / tool results to Gemini
  //   2. If Gemini requests tools → execute them ALL in parallel
  //   3. Feed every result (success OR failure) back to Gemini
  //   4. If Gemini replies with text → we're done
  // Capped at MAX_AGENT_TURNS to prevent infinite loops.
  // ==========================================
  const MAX_AGENT_TURNS = 5;
  let currentResult = await chat.sendMessage(userMessage);
  let agentReply: string = '';

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const functionCalls = currentResult.response.functionCalls();

    // No tool calls — Gemini has composed its final answer
    if (!functionCalls || functionCalls.length === 0) {
      agentReply = currentResult.response.text();
      break;
    }

    console.log(`🔁 Agent turn ${turn + 1}: executing ${functionCalls.length} tool(s)...`);

    // Execute ALL requested tools in parallel
    const toolResponses = await Promise.all(
      functionCalls.map(async (call) => {
        try {
          const response = await executeToolCall(userId, call);
          console.log(`  ✅ Tool "${call.name}" succeeded`);
          return {
            functionResponse: {
              name: call.name,
              response: response
            }
          };
        } catch (err) {
          // Classify: semantic (Gemini can retry) vs system (sanitize, Gemini cannot fix)
          const classified = classifyError(err);
          console.warn(`  ⚠️ Tool "${call.name}" failed (canRetry: ${classified.canRetry}):`, classified.error);
          return {
            functionResponse: {
              name: call.name,
              response: classified
            }
          };
        }
      })
    );

    // Send ALL tool results back to Gemini in one message for the next turn
    currentResult = await chat.sendMessage(toolResponses);
  }

  if (!agentReply) {
    console.error('❌ Agent loop hit MAX_AGENT_TURNS without a final answer.');
    agentReply = "I wasn't able to complete that request. Please try again.";
  }

  // Fire memory extraction in the background — user already has their reply
  extractAndSaveMemory(userId, userMessage, agentReply, currentMemory);
  return agentReply;
}

export const aiService = {
  chatWithCoach,
};
