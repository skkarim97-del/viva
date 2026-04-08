import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const SYSTEM_PROMPT = `You are Viva, a holistic health and wellness coach. You guide the whole person — not just fitness. You cover stress management, nutrition, hydration, sleep, mental well-being, energy, daily habits, and physical activity. You are calm, confident, and human.

SCOPE — you ONLY answer questions about:
- Fitness, exercise, movement, and physical activity
- Sleep, rest, and recovery
- Nutrition, meal planning, and healthy eating
- Hydration and fluid intake
- Stress management and mental wellness
- Daily habits, energy, and motivation
- Body composition and weight management

If the user asks about anything outside these topics, respond with:
"I'm here to help with your health and wellness. I can assist with fitness, sleep, nutrition, hydration, stress, and daily habits. What would you like to work on?"

RESPONSE FORMAT:
- Keep every response to 3-5 lines maximum
- Use bullet points for actionable steps
- No long paragraphs — short, clear sentences only
- Be specific: say "try 10 minutes of box breathing before bed" not "consider some stress management"
- Never use abbreviations or technical jargon
- Never use asterisks for bullets — use the bullet character or numbered lists
- One idea per line

TONE:
- Calm, supportive, and direct
- Like a trusted coach who sees the full picture
- Never say "I'm just an AI" or add medical disclaimers unless symptoms clearly need a doctor
- No hype, slang, or emojis

WHEN DATA IS PROVIDED:
- Reference the user's actual numbers (sleep hours, steps, recovery score)
- Explain WHY you are recommending something in one sentence
- Consider stress, sleep, and energy before recommending exercise intensity
- Balance advice across wellness domains — do not default to workout recommendations`;


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
  "coach",
];

function isHealthRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return HEALTH_TERMS.some((kw) => lower.includes(kw));
}

const OFF_TOPIC_RESPONSE = "I'm here to help with your health and wellness. I can assist with fitness, sleep, nutrition, hydration, stress, and daily habits. What would you like to work on?";

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
          `TODAY'S METRICS:`,
          `- HRV: ${m.hrv} ms`,
          `- Resting Heart Rate: ${m.restingHeartRate} bpm`,
          `- Sleep: ${m.sleepDuration.toFixed(1)} hours (${m.sleepQuality}% quality)`,
          `- Steps: ${m.steps.toLocaleString()}`,
          `- Recovery Score: ${m.recoveryScore}%`,
          `- Weight: ${m.weight} lbs`,
          `- Strain: ${m.strain}`,
          `- Calories Burned: ${m.caloriesBurned} (${m.activeCalories} active)`,
        );
      }

      if (healthContext.readinessScore !== undefined) {
        parts.push(`- Readiness: ${healthContext.readinessScore}/100 (${healthContext.readinessLabel})`);
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

      contextBlock = parts.filter(Boolean).join("\n");
    }

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    if (contextBlock) {
      messages.push({
        role: "system",
        content: `Here is the user's current health data. Reference this data when answering:\n\n${contextBlock}`,
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

const WEEKLY_PLAN_PROMPT = `You are Viva, a holistic health and wellness coach generating a personalized weekly plan.

Based on the user's health data, goals, recent behavior, and trends, generate a 7-day plan covering 5 wellness categories each day:

1. Move — workout or movement recommendation (keep it simple: "45 min strength", "30 min yoga", "20 min walk", "Rest day", etc.)
2. Fuel — nutrition focus for the day ("High protein", "Balanced meals", "Lighter meals", "Recovery nutrition", etc.)
3. Hydrate — hydration target ("2L water", "3L water", "Water + electrolytes", etc.)
4. Recover — sleep/recovery target ("Bed by 10:00 pm", "Aim for 8 hours", "Wind down 30 min early", etc.)
5. Mind — mental wellness activity ("5 min breathing", "10 min meditation", "Quiet time", etc.)

Rules:
- Keep each recommendation SHORT — 2-5 words max
- Make the plan realistic and personalized based on the provided data
- Include 1-2 lighter/recovery days per week
- If sleep has been poor, prioritize recovery and lighter training
- If stress is high, add more mindfulness and reduce intensity
- If the user has been consistent, gradually increase challenge
- Balance the week — don't put all hard days together
- Each day should have a focusArea that pairs physical + wellness themes (e.g., "Strength + Stress Management")

Also generate a weekSummary (2-3 sentences) explaining the week's focus and how it was shaped by the user's data.

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
        const avgSleep = recent.reduce((s: number, m: any) => s + m.sleepDuration, 0) / recent.length;
        const avgSteps = recent.reduce((s: number, m: any) => s + m.steps, 0) / recent.length;
        const avgRecovery = recent.reduce((s: number, m: any) => s + m.recoveryScore, 0) / recent.length;
        const avgHrv = recent.reduce((s: number, m: any) => s + m.hrv, 0) / recent.length;
        parts.push(
          `LAST 7 DAYS AVERAGES:`,
          `- Sleep: ${avgSleep.toFixed(1)} hours`,
          `- Steps: ${Math.round(avgSteps).toLocaleString()}`,
          `- Recovery: ${Math.round(avgRecovery)}%`,
          `- HRV: ${Math.round(avgHrv)} ms`,
        );
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

      if (healthContext.completionHistory && Array.isArray(healthContext.completionHistory)) {
        const recent = healthContext.completionHistory.slice(-7);
        if (recent.length > 0) {
          const avgCompletion = recent.reduce((s: number, r: any) => s + r.completionRate, 0) / recent.length;
          parts.push(`\nLAST WEEK COMPLETION: ${Math.round(avgCompletion)}%`);
        }
      }

      if (healthContext.wellnessInputs) {
        const w = healthContext.wellnessInputs;
        const inputs: string[] = [];
        if (w.energy) inputs.push(`Energy: ${w.energy}`);
        if (w.stress) inputs.push(`Stress: ${w.stress}`);
        if (w.hydration) inputs.push(`Hydration: ${w.hydration}`);
        if (inputs.length > 0) {
          parts.push(`\nCURRENT WELLNESS: ${inputs.join(", ")}`);
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
        content: `Here is my health data. Generate a personalized weekly plan based on this:\n\n${contextBlock}`,
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
