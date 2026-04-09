import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { prisma } from '@/config/database';
import { buildUserContext, getSystemInstruction, getMemoryExtractionPrompt } from './ai/prompts';
import { coachTools } from './ai/tools';
import { executeToolCall } from './ai/executor';

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
        model: 'gemini-2.0-flash',
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
  const result = await chat.sendMessage(userMessage);
  const functionCalls = result.response.functionCalls();

  // ==========================================
  // PASS 1: TOOL CALL INTERCEPTED
  // ==========================================
  if (functionCalls && functionCalls.length > 0) {
    const call = functionCalls[0];
    let agentReply: string;

    try {
      const responsePayload = await executeToolCall(userId, call);

      // Feed the tool result back to Gemini — it now composes its plain text reply
      const finalResult = await chat.sendMessage([{
        functionResponse: {
          name: call.name,
          response: responsePayload
        }
      }]);

      agentReply = finalResult.response.text();
    } catch (err) {
      console.error("Tool execution failed:", err);
      return "Something went wrong while performing that action. Please try again.";
    }

    // Fire memory extraction in the background — user already has their reply
    extractAndSaveMemory(userId, userMessage, agentReply, currentMemory);
    return agentReply;
  }

  // ==========================================
  // PASS 2: STANDARD CHAT (No Tools Requested)
  // ==========================================
  const agentReply = result.response.text();

  // Fire memory extraction in the background — user already has their reply
  extractAndSaveMemory(userId, userMessage, agentReply, currentMemory);
  return agentReply;
}

export const aiService = {
  chatWithCoach,
};
