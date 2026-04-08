import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const SYSTEM_PROMPT = `You are VIVA, a premium AI health and wellness coach. You guide the whole person: energy, recovery, stress, sleep, nutrition, hydration, movement, and daily habits. You are calm, confident, warm, and grounded.

You are NOT a chatbot, search engine, therapist, generic wellness influencer, or productivity bot. You are a smart performance and recovery coach who combines biometric data, user inputs, behavioral trends, and practical coaching judgment.

SCOPE: You ONLY answer questions about fitness, exercise, movement, sleep, rest, recovery, nutrition, meal planning, hydration, stress management, mental wellness, daily habits, energy, motivation, body composition, and weight management.

If the user asks about anything outside these topics, respond with:
"I'm here to help with your health and wellness. I can help with fitness, sleep, nutrition, hydration, stress, recovery, and daily habits. What would you like to work on?"

PERSONALITY:
- Encouraging, warm, professional, energetic, grounded, concise
- Sound like a high-quality human performance coach, not a search engine
- Science-oriented and practical, never robotic or clinical
- Conversational and natural. Feel like a real back-and-forth with a smart coach
- Empathetic and supportive when the user is tired, stressed, frustrated, or discouraged
- Confident and directive, not overly soft or vague
- Never preachy, cheesy, generic, or overly motivational
- Never sound like ChatGPT, customer support, or a search result summary

RESPONSE STRUCTURE (use this pattern):
1. Brief acknowledgment of the user's situation
2. Concise science-based explanation
3. Clear coaching recommendation or next step

RESPONSE FORMAT:
- Keep responses to 3-5 short paragraphs max
- No long paragraphs. Short, clear sentences only
- Be specific: say "try 10 minutes of box breathing before bed" not "consider some stress management"
- Never use abbreviations or technical jargon
- Never use asterisks for bullets. Use the bullet character or numbered lists
- Never use em dashes
- Keep hydration recommendations in cups, not liters

WHEN DATA IS PROVIDED:
- Reference the user's actual numbers (sleep hours, HRV, steps, recovery score, resting HR)
- Explain WHY you are recommending something based on their data
- If user-reported state conflicts with wearable data, reconcile the two intelligently and explain the tradeoff
- Create "aha" moments by surfacing non-obvious patterns ("Your recovery drops after late nights", "Your best sleep happens when hydration is higher")
- Be data-aware and specific. Reference actual patterns, not generic advice
- Consider stress, sleep, and energy before recommending exercise intensity
- Weight wearable data (60%) more heavily than self-reported inputs (40%) when they conflict

WHAT THE USER SHOULD FEEL:
- Understood
- Guided
- Reassured
- Motivated
- Like the advice is based on both data and judgment

BEFORE EVERY RESPONSE, CHECK:
- Does this sound like the VIVA coach?
- Is it warm, concise, and science-oriented?
- Does it feel personalized to the user's data and context?
- Does it avoid sounding like a generic chatbot?
If not, rewrite it until it does.`;


interface ChatRequestBody {
  message: string;
  healthContext?: {
    todayMetrics?: {
      hrv: number;
      restingHeartRate: number;
      sleepDuration: number;
      sleepQuality: number;
      steps: number;
      recoveryScore: number;
      weight: number;
      strain: number;
      caloriesBurned: number;
      activeCalories: number;
    };
    profile?: {
      age: number;
      sex: string;
      weight: number;
      goalWeight: number;
      goals: string[];
      workoutPreference: string;
      dietaryPreference: string;
      fastingEnabled: boolean;
      injuries: string;
      availableWorkoutTime: number;
      daysAvailableToTrain: number;
    };
    recentTrends?: {
      weightTrend: string;
      hrvTrend: string;
      sleepTrend: string;
      stepsTrend: string;
    };
    readinessScore?: number;
    readinessLabel?: string;
    dailyState?: string;
    userFeeling?: string;
    userEnergy?: string;
    userStress?: string;
    userHydration?: string;
    userTrainingIntent?: string;
    sleepInsight?: string;
    hrvBaseline?: number;
    hrvDeviation?: number;
    sleepDebt?: number;
    recoveryTrend?: string;
    weeklyCompletionRate?: number;
    streakDays?: number;
    weeklyConsistency?: number;
  };
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
}

const HEALTH_TERMS = [
  "sleep", "rest", "tired", "fatigue", "nap", "insomnia", "bedtime", "wake",
  "stress", "anxious", "anxiety", "calm", "relax", "overwhelm", "burnout", "mental", "mood",
  "workout", "exercise", "training", "cardio", "strength", "yoga", "stretch", "gym", "active", "movement", "steps", "fitness",
  "eat", "food", "meal", "diet", "nutrition", "protein", "carb", "fat", "calorie", "vegetable", "fruit", "recipe", "hunger", "appetite",
  "water", "hydrat", "drink", "thirst", "caffeine", "coffee", "tea", "electrolyte",
  "recovery", "recover", "sore", "pain", "injury", "ache", "muscle",
  "weight", "body", "bmi",
  "energy", "focus", "motivation", "habit", "routine",
  "heart", "hrv", "heart rate", "resting",
  "meditat", "breath", "mindful", "journal", "gratitude",
  "health", "wellness", "well-being", "wellbeing",
  "coach", "plan", "today", "week", "how", "what", "should", "can", "help",
];

function isHealthRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return HEALTH_TERMS.some((kw) => lower.includes(kw));
}

const OFF_TOPIC_RESPONSE = "I'm here to help with your health and wellness. I can help with fitness, sleep, nutrition, hydration, stress, recovery, and daily habits. What would you like to work on?";

router.post("/chat", async (req: Request, res: Response) => {
  try {
    const body = req.body as ChatRequestBody;
    const { message, healthContext, conversationHistory } = body;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    if (!isHealthRelated(message)) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ content: OFF_TOPIC_RESPONSE })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    let contextBlock = "";
    if (healthContext) {
      const parts: string[] = [];

      if (healthContext.todayMetrics) {
        const m = healthContext.todayMetrics;
        parts.push(
          `TODAY'S BIOMETRIC DATA:`,
          `- HRV: ${m.hrv} ms${healthContext.hrvBaseline ? ` (14-day baseline: ${healthContext.hrvBaseline} ms, ${healthContext.hrvDeviation && healthContext.hrvDeviation > 0 ? "+" : ""}${healthContext.hrvDeviation || 0}ms deviation)` : ""}`,
          `- Resting Heart Rate: ${m.restingHeartRate} bpm`,
          `- Sleep: ${m.sleepDuration.toFixed(1)} hours (${m.sleepQuality}% quality)${healthContext.sleepDebt ? `, sleep debt: ${healthContext.sleepDebt} hours this week` : ""}`,
          `- Steps: ${m.steps.toLocaleString()}`,
          `- Recovery Score: ${m.recoveryScore}%${healthContext.recoveryTrend ? ` (trend: ${healthContext.recoveryTrend})` : ""}`,
          `- Weight: ${m.weight} lbs`,
          `- Strain: ${m.strain}`,
          `- Calories Burned: ${m.caloriesBurned} (${m.activeCalories} active)`,
        );
      }

      if (healthContext.readinessScore !== undefined) {
        parts.push(`- Overall Readiness: ${healthContext.readinessScore}/100 (${healthContext.readinessLabel || ""})`);
        if (healthContext.dailyState) {
          parts.push(`- Today's State: ${healthContext.dailyState}`);
        }
      }

      const selfReported: string[] = [];
      if (healthContext.userFeeling) selfReported.push(`Feeling: ${healthContext.userFeeling}`);
      if (healthContext.userEnergy) selfReported.push(`Energy: ${healthContext.userEnergy}`);
      if (healthContext.userStress) selfReported.push(`Stress: ${healthContext.userStress}`);
      if (healthContext.userHydration) selfReported.push(`Hydration: ${healthContext.userHydration}`);
      if (healthContext.userTrainingIntent) selfReported.push(`Training intent: ${healthContext.userTrainingIntent}`);
      if (selfReported.length > 0) {
        parts.push(`\nSELF-REPORTED STATE: ${selfReported.join(", ")}`);
      }

      if (healthContext.sleepInsight) {
        parts.push(`\nSLEEP INTELLIGENCE: ${healthContext.sleepInsight}`);
      }

      if (healthContext.profile) {
        const p = healthContext.profile;
        parts.push(
          `\nUSER PROFILE:`,
          `- Age: ${p.age}, Sex: ${p.sex}`,
          `- Current Weight: ${p.weight} lbs, Goal: ${p.goalWeight} lbs`,
          `- Goals: ${p.goals.join(", ")}`,
          `- Workout Preference: ${p.workoutPreference}`,
          `- Available Time: ${p.availableWorkoutTime} min/session, ${p.daysAvailableToTrain} days/week`,
          `- Dietary Preference: ${p.dietaryPreference}`,
          `- Fasting: ${p.fastingEnabled ? "enabled" : "disabled"}`,
          p.injuries ? `- Injuries/Limitations: ${p.injuries}` : "",
        );
      }

      if (healthContext.recentTrends) {
        const t = healthContext.recentTrends;
        parts.push(
          `\n30-DAY TRENDS:`,
          `- Weight: ${t.weightTrend}`,
          `- HRV: ${t.hrvTrend}`,
          `- Sleep: ${t.sleepTrend}`,
          `- Steps: ${t.stepsTrend}`,
        );
      }

      const behavioral: string[] = [];
      if (healthContext.weeklyCompletionRate !== undefined && healthContext.weeklyCompletionRate >= 0) {
        behavioral.push(`Weekly completion rate: ${healthContext.weeklyCompletionRate}%`);
      }
      if (healthContext.streakDays !== undefined && healthContext.streakDays > 0) {
        behavioral.push(`Current streak: ${healthContext.streakDays} days`);
      }
      if (healthContext.weeklyConsistency !== undefined && healthContext.weeklyConsistency >= 0) {
        behavioral.push(`Weekly consistency: ${healthContext.weeklyConsistency}%`);
      }
      if (behavioral.length > 0) {
        parts.push(`\nBEHAVIORAL PATTERNS: ${behavioral.join(", ")}`);
      }

      contextBlock = parts.filter(Boolean).join("\n");
    }

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    if (contextBlock) {
      messages.push({
        role: "system",
        content: `Here is the user's current health data. You MUST reference this data when answering. Be specific about numbers, trends, and patterns:\n\n${contextBlock}`,
      });
    }

    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-10);
      for (const msg of recent) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: message });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 8192,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Coach chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate response" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
      res.end();
    }
  }
});

const WEEKLY_PLAN_PROMPT = `You are VIVA, a premium AI health and wellness coach generating a personalized weekly plan.

DATA WEIGHTING:
- 60% = wearable/biometric data (sleep, HRV, resting HR, strain, steps, recovery trends)
- 40% = self-reported inputs (energy, stress, hydration, soreness, motivation, training preference)
- When the two conflict, prioritize wearable data but still acknowledge the user's current state

Based on the user's health data, goals, recent behavior, and trends, generate a 7-day plan covering 5 wellness categories each day:

1. Move: workout or movement recommendation ("45 min strength", "30 min yoga", "20 min walk", "Rest day", etc.)
2. Fuel: nutrition focus ("High protein", "Balanced meals", "Lighter meals", "Recovery nutrition", etc.)
3. Hydrate: hydration target in cups ("8 cups water", "10+ cups water", "Water + electrolytes", etc.)
4. Recover: sleep/recovery target ("Bed by 10:00 pm", "Aim for 8 hours", "Wind down 30 min early", etc.)
5. Mind: mental wellness activity ("5 min breathing", "10 min meditation", "Quiet time", etc.)

IMPORTANT RULES:
- Keep each recommendation SHORT: 2-5 words max
- Use cups for all hydration, never liters
- Never use em dashes
- Make the plan feel adaptive and personalized, not templated
- Reference actual patterns when possible:
  - low recovery trends
  - rising fatigue
  - poor sleep consistency
  - improved readiness
  - missed workouts or low completion rates
  - falling hydration consistency
  - low daily movement
- Include 1-2 lighter/recovery days per week
- If sleep has been poor, prioritize recovery and lighter training
- If stress is high, add more mindfulness and reduce intensity
- If the user has been consistent, gradually increase challenge
- Balance the week: don't put all hard days together
- Each day should have a focusArea that pairs physical + wellness themes

The weekSummary should be 2-3 sentences explaining the week's focus and how it was shaped by the user's actual data patterns. Be specific, not generic.

Respond ONLY with valid JSON in this exact format:
{
  "weekSummary": "...",
  "days": [
    {
      "dayOfWeek": "Monday",
      "focusArea": "...",
      "move": "...",
      "fuel": "...",
      "hydrate": "...",
      "recover": "...",
      "mind": "..."
    }
  ],
  "adjustmentNote": "..."
}`;

router.post("/weekly-plan", async (req: Request, res: Response) => {
  try {
    const { healthContext } = req.body;

    let contextBlock = "";
    if (healthContext) {
      const parts: string[] = [];

      if (healthContext.recentMetrics && Array.isArray(healthContext.recentMetrics)) {
        const recent = healthContext.recentMetrics.slice(-7);
        const older = healthContext.recentMetrics.slice(-14, -7);
        const avgSleep = recent.reduce((s: number, m: any) => s + m.sleepDuration, 0) / recent.length;
        const avgSteps = recent.reduce((s: number, m: any) => s + m.steps, 0) / recent.length;
        const avgRecovery = recent.reduce((s: number, m: any) => s + m.recoveryScore, 0) / recent.length;
        const avgHrv = recent.reduce((s: number, m: any) => s + m.hrv, 0) / recent.length;
        const avgStrain = recent.reduce((s: number, m: any) => s + m.strain, 0) / recent.length;
        const avgRhr = recent.reduce((s: number, m: any) => s + m.restingHeartRate, 0) / recent.length;
        const avgSleepQuality = recent.reduce((s: number, m: any) => s + m.sleepQuality, 0) / recent.length;

        parts.push(
          `LAST 7 DAYS (BIOMETRIC DATA, 60% weight):`,
          `- Avg Sleep: ${avgSleep.toFixed(1)} hours (${Math.round(avgSleepQuality)}% quality)`,
          `- Avg Steps: ${Math.round(avgSteps).toLocaleString()}/day`,
          `- Avg Recovery: ${Math.round(avgRecovery)}%`,
          `- Avg HRV: ${Math.round(avgHrv)} ms`,
          `- Avg Resting HR: ${Math.round(avgRhr)} bpm`,
          `- Avg Strain: ${avgStrain.toFixed(1)}`,
        );

        if (older.length >= 3) {
          const olderRecovery = older.reduce((s: number, m: any) => s + m.recoveryScore, 0) / older.length;
          const olderSleep = older.reduce((s: number, m: any) => s + m.sleepDuration, 0) / older.length;
          const olderHrv = older.reduce((s: number, m: any) => s + m.hrv, 0) / older.length;
          const recoveryChange = avgRecovery - olderRecovery;
          const sleepChange = avgSleep - olderSleep;
          const hrvChange = avgHrv - olderHrv;
          parts.push(
            `\nWEEK-OVER-WEEK CHANGES:`,
            `- Recovery: ${recoveryChange > 0 ? "+" : ""}${Math.round(recoveryChange)}%`,
            `- Sleep: ${sleepChange > 0 ? "+" : ""}${sleepChange.toFixed(1)} hours`,
            `- HRV: ${hrvChange > 0 ? "+" : ""}${Math.round(hrvChange)} ms`,
          );
        }

        const lowSleepDays = recent.filter((m: any) => m.sleepDuration < 6.5).length;
        const lowRecoveryDays = recent.filter((m: any) => m.recoveryScore < 50).length;
        const lowStepDays = recent.filter((m: any) => m.steps < 5000).length;
        const flags: string[] = [];
        if (lowSleepDays >= 3) flags.push(`${lowSleepDays} days of short sleep`);
        if (lowRecoveryDays >= 3) flags.push(`${lowRecoveryDays} days of low recovery`);
        if (lowStepDays >= 3) flags.push(`${lowStepDays} days of low movement`);
        if (flags.length > 0) {
          parts.push(`\nPATTERN FLAGS: ${flags.join(", ")}`);
        }
      }

      if (healthContext.profile) {
        const p = healthContext.profile;
        parts.push(
          `\nUSER PROFILE:`,
          `- Age: ${p.age}, Sex: ${p.sex}`,
          `- Goals: ${p.goals?.join(", ") || "general wellness"}`,
          `- Days available to train: ${p.daysAvailableToTrain || 4}`,
          `- Available time per session: ${p.availableWorkoutTime || 45} min`,
        );
      }

      if (healthContext.wellnessInputs) {
        const w = healthContext.wellnessInputs;
        const inputs: string[] = [];
        if (w.feeling) inputs.push(`Feeling: ${w.feeling}`);
        if (w.energy) inputs.push(`Energy: ${w.energy}`);
        if (w.stress) inputs.push(`Stress: ${w.stress}`);
        if (w.hydration) inputs.push(`Hydration: ${w.hydration}`);
        if (inputs.length > 0) {
          parts.push(`\nSELF-REPORTED STATE (40% weight): ${inputs.join(", ")}`);
        }
      }

      if (healthContext.completionHistory && Array.isArray(healthContext.completionHistory)) {
        const recent = healthContext.completionHistory.slice(-7);
        if (recent.length > 0) {
          const avgCompletion = recent.reduce((s: number, r: any) => s + r.completionRate, 0) / recent.length;
          const categoryStats: Record<string, { done: number; total: number }> = {};
          for (const r of recent) {
            if (r.actions) {
              for (const a of r.actions) {
                if (!categoryStats[a.category]) categoryStats[a.category] = { done: 0, total: 0 };
                categoryStats[a.category].total++;
                if (a.completed) categoryStats[a.category].done++;
              }
            }
          }
          const weakCategories = Object.entries(categoryStats)
            .filter(([, v]) => v.total >= 3 && v.done / v.total < 0.4)
            .map(([k]) => k);

          parts.push(`\nBEHAVIORAL DATA:`);
          parts.push(`- Last week completion: ${Math.round(avgCompletion)}%`);
          if (weakCategories.length > 0) {
            parts.push(`- Weak categories (under 40% completion): ${weakCategories.join(", ")}`);
            parts.push(`  Note: simplify recommendations for weak categories to build consistency`);
          }
        }
      }

      contextBlock = parts.filter(Boolean).join("\n");
    }

    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: WEEKLY_PLAN_PROMPT },
    ];

    if (contextBlock) {
      messages.push({
        role: "user",
        content: `Here is my health data. Generate a personalized weekly plan based on this. Remember: 60% weight on biometric data, 40% on self-reported state:\n\n${contextBlock}`,
      });
    } else {
      messages.push({
        role: "user",
        content: "Generate a balanced weekly wellness plan for someone looking to maintain general health and fitness.",
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 2048,
      messages,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    const plan = JSON.parse(content);
    res.json(plan);
  } catch (error: any) {
    console.error("Weekly plan generation error:", error);
    res.status(500).json({ error: "Failed to generate weekly plan" });
  }
});

export default router;
