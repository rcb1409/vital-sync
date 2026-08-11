// -------------------------------------------------------
// Memory Extractor — Golden Dataset
// -------------------------------------------------------
// Tests the memory extractor LLM in isolation.
// Each case provides a conversation exchange + current memory,
// and asserts what the extractor SHOULD produce as output.
//
// The extractor's job:
//   1. ADD new permanent/temporary facts mentioned in the conversation
//   2. KEEP existing facts that are still valid
//   3. REMOVE facts the user explicitly says are no longer true
//   4. IGNORE irrelevant conversation (don't add noise facts)
//
// Assertions are deterministic (category exists, fact count, expiresAt shape).
// The judge scores semantic correctness of the extracted fact text.
// -------------------------------------------------------

import type { MemoryFact } from '../../src/services/ai/memory';

export interface MemoryEvalCase {
  id: string;
  category: 'add_permanent' | 'add_temporary' | 'remove' | 'no_change' | 'update';
  userMessage: string;
  aiResponse: string;
  currentMemory: MemoryFact[];
  expectedBehavior: string;
  assertions: {
    // Expected fact count in the output (exact match)
    expectedFactCount?: number;
    // A category that MUST appear in the output facts
    mustHaveCategory?: string;
    // A category that must NOT appear in the output (for removal tests)
    mustNotHaveCategory?: string;
    // Whether any new fact should have expiresAt set (true = yes, false = must be null)
    newFactHasExpiry?: boolean;
    // A substring that MUST appear in at least one output fact's `fact` field
    factMustContain?: string;
    // A substring that must NOT appear in any output fact's `fact` field
    factMustNotContain?: string;
  };
}

// ── Baseline memory (shared starting state for most cases) ──────────────────
const baselineMemory: MemoryFact[] = [
  { category: 'allergy', fact: 'Severe peanut allergy', expiresAt: null },
  { category: 'injury', fact: 'Right shoulder impingement — no overhead pressing for 1 month', expiresAt: '2026-07-25' },
  { category: 'preference', fact: 'Vegetarian — no meat or fish', expiresAt: null },
  { category: 'goal', fact: 'Training for a half marathon in September 2026', expiresAt: '2026-09-30' },
  { category: 'schedule', fact: 'Works 9-5 Mon-Fri, prefers morning workouts at 6 AM', expiresAt: null },
];

// =====================================================
// TEST CASES
// =====================================================

const addPermanentCases: MemoryEvalCase[] = [
  {
    id: 'mem-add-01',
    category: 'add_permanent',
    userMessage: "Oh by the way, I'm lactose intolerant.",
    aiResponse: "Good to know! I'll keep that in mind and avoid suggesting dairy-based foods.",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should ADD a new permanent fact about lactose intolerance (category: allergy or intolerance, expiresAt: null). All existing facts should be preserved unchanged.',
    assertions: {
      expectedFactCount: 6,
      mustHaveCategory: 'allergy',
      factMustContain: 'lactose',
      newFactHasExpiry: false,
    },
  },
  {
    id: 'mem-add-02',
    category: 'add_permanent',
    userMessage: "I've switched to a vegan diet now, not just vegetarian.",
    aiResponse: "Got it! I'll update my recommendations to exclude all animal products, not just meat/fish.",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should UPDATE the existing vegetarian preference to vegan. The old "Vegetarian" fact should be replaced or modified to say "Vegan".',
    assertions: {
      factMustContain: 'vegan',
      factMustNotContain: 'Vegetarian — no meat or fish',
    },
  },
  {
    id: 'mem-add-03',
    category: 'add_permanent',
    userMessage: 'I just got a gym membership at Planet Fitness.',
    aiResponse: "Nice! That gives you access to plenty of equipment. Let me know if you want workout suggestions based on what's available there.",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should ADD a new fact about having a gym membership at Planet Fitness. Category could be "fitness" or "preference". expiresAt: null (permanent).',
    assertions: {
      expectedFactCount: 6,
      factMustContain: 'planet fitness',
      newFactHasExpiry: false,
    },
  },
];

const addTemporaryCases: MemoryEvalCase[] = [
  {
    id: 'mem-temp-01',
    category: 'add_temporary',
    userMessage: "I'm traveling for work next week, won't have gym access until Monday.",
    aiResponse: "No worries! I can suggest bodyweight exercises or rest days while you travel.",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should ADD a temporary fact about traveling/no gym access with an expiresAt date approximately 1 week from today. Existing facts preserved.',
    assertions: {
      expectedFactCount: 6,
      newFactHasExpiry: true,
      factMustContain: 'travel',
    },
  },
  {
    id: 'mem-temp-02',
    category: 'add_temporary',
    userMessage: "I have a cold, probably won't be able to train for 3-4 days.",
    aiResponse: "Rest up! Focus on hydration and sleep. We'll ease back in when you feel better.",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should ADD a temporary fact about being sick with an expiresAt 3-4 days from today. Existing facts preserved.',
    assertions: {
      expectedFactCount: 6,
      newFactHasExpiry: true,
    },
  },
];

const removeCases: MemoryEvalCase[] = [
  {
    id: 'mem-remove-01',
    category: 'remove',
    userMessage: 'Good news — my doctor cleared me for overhead pressing again! Shoulder is fully healed.',
    aiResponse: "That's great news! We can add overhead press back into your routine now.",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should REMOVE the shoulder injury fact since the user explicitly said it is healed. All other facts preserved.',
    assertions: {
      expectedFactCount: 4,
      mustNotHaveCategory: 'injury',
    },
  },
  {
    id: 'mem-remove-02',
    category: 'remove',
    userMessage: "I decided to drop the marathon goal. I just want to focus on strength training.",
    aiResponse: "That's totally fine! Let's refocus your programming on hypertrophy and strength.",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should REMOVE the half-marathon goal fact. May add a new "strength training focus" goal. Other facts preserved.',
    assertions: {
      factMustNotContain: 'half marathon',
    },
  },
];

const noChangeCases: MemoryEvalCase[] = [
  {
    id: 'mem-noop-01',
    category: 'no_change',
    userMessage: 'How many calories do I have left today?',
    aiResponse: 'You have about 1560 calories remaining to hit your 2500 target.',
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should return the EXACT same facts unchanged. A routine nutrition question contains no new long-term information. factCount must stay at 5.',
    assertions: {
      expectedFactCount: 5,
    },
  },
  {
    id: 'mem-noop-02',
    category: 'no_change',
    userMessage: "What's a good post-workout snack?",
    aiResponse: 'Try Greek yogurt with berries and granola — about 250 cal and 20g protein.',
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should return facts unchanged. Generic coaching advice does not constitute a new long-term fact. factCount = 5.',
    assertions: {
      expectedFactCount: 5,
    },
  },
  {
    id: 'mem-noop-03',
    category: 'no_change',
    userMessage: 'Log 2 eggs and toast for breakfast',
    aiResponse: "I'd estimate that as 280 cal, 14g protein, 20g carbs, 16g fat. Shall I log it?",
    currentMemory: baselineMemory,
    expectedBehavior:
      'Should return facts unchanged. Food logging is transient, not a long-term fact. factCount = 5.',
    assertions: {
      expectedFactCount: 5,
    },
  },
];

// =====================================================
// COMBINED DATASET
// =====================================================
export const memoryGoldenDataset: MemoryEvalCase[] = [
  ...addPermanentCases,
  ...addTemporaryCases,
  ...removeCases,
  ...noChangeCases,
];

export const memoryDatasetStats = {
  total: memoryGoldenDataset.length,
  byCategory: {
    add_permanent: addPermanentCases.length,
    add_temporary: addTemporaryCases.length,
    remove: removeCases.length,
    no_change: noChangeCases.length,
  },
};
