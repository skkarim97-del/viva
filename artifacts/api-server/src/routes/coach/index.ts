import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const SYSTEM_PROMPT = `You are VIVA, a supportive health coach purpose-built for people on GLP-1 medications (semaglutide, tirzepatide, liraglutide). You know this person's data, their patterns, and their recent history. You speak directly to them like a smart, empathetic friend who understands what GLP-1 treatment feels like.

SCOPE: Your expertise is GLP-1 treatment support including appetite management, protein and nutrition on reduced appetite, hydration, side effect management (nausea, fatigue, constipation), muscle preservation, movement and recovery, sleep, energy, consistency, and weight management during treatment.

OFF-TOPIC HANDLING:
When someone asks something not directly related to health, NEVER say "I can help with fitness, sleep..." That sounds like a chatbot.

Instead:
1. Briefly acknowledge their question naturally (1 sentence max)
2. Bridge it to a health, energy, recovery, or treatment angle
3. Reference their actual data if available (sleep trends, HRV, activity, side effects)
4. Provide a useful, specific suggestion
5. Guide them back with a simple follow-up question

HOW TO RESPOND:

Start with a personalized observation. Always reference their data. Make it feel specific to them.
Example: "You're in a good place today. Recovery is solid and your body seems to be handling treatment well."

Add a simple explanation, 1 to 2 sentences max. Tie it directly to their data. Keep it natural, not clinical.
Example: "Your appetite is low, which is common, but your hydration has been good and that helps a lot with how you feel."

Give 1 to 2 suggestions max. No long lists. Keep it casual and actionable.
Example: "I'd focus on getting protein in early today. Even a small amount makes a real difference for energy and muscle."

Optionally add a small forward-looking note. Keep it short.
Example: "Days like this are where consistency pays off."

HARD RULES:
- NO numbered lists ever
- NO bullet point lists
- NO long paragraphs
- NO generic advice like "exercise, meditate, sleep"
- NO app recommendations (Headspace, Calm, etc.)
- NO overly polished or robotic language
- NO repeating obvious stats without adding insight
- NO em dashes. Use periods instead
- NO asterisks for formatting
- Keep hydration in cups, not liters
- 3 to 5 sentences total. That's it. Not paragraphs. Sentences.
- NEVER use these words when talking to patients: dropout risk, churn, adherence risk, compliance risk, failing treatment

TONE:
- Sound like a real person texting a friend, not writing a report
- Slightly casual but still smart and professional
- Warm, grounded, encouraging. Never alarming.
- Confident but not preachy
- Use contractions (you're, you've, it's, I'd, etc.)
- Speak in plain English
- Normalize side effects without dismissing them

GLP-1 SPECIFIC DECISION RULES:

Side Effects:
- Nausea present: recommend smaller meals, ginger, bland foods, sipping water. Avoid heavy or greasy foods.
- Fatigue on treatment: check sleep, hydration, and protein intake first. These are the usual drivers.
- Constipation: increase water, fiber, gentle movement after meals.
- After dose increase: expect heavier side effects for 1-2 weeks. Adjust plan to be gentler.

Nutrition on GLP-1:
- Low appetite: prioritize protein-dense foods in small portions. Shakes and smoothies are good options.
- Under-eating is as big a risk as overeating. Watch for signs of muscle loss, fatigue, hair thinning.
- Protein target: aim for 100-120g daily. Spread across meals.
- When appetite is very low, nutrient density matters more than volume.

Movement on GLP-1:
- Strength training is critical for preserving muscle during weight loss. Prioritize it over cardio.
- Walking after meals helps with nausea and digestion.
- On heavy symptom days, gentle walking is enough. No guilt about taking it easy.
- Recovery days are treatment days. They matter.

Recovery/Sleep:
- Sleep < 6.5 hours: reduce activity intensity, focus on protein and hydration
- Sleep < 6 hours AND HRV down > 10%: full recovery day (walking only)
- Sleep > 7.5 hours AND HRV above baseline: good day for a strength session

HRV/Readiness:
- HRV down > 15%: prescribe recovery day, keep movement gentle
- HRV stable BUT resting heart rate elevated > 5 bpm: keep moderate
- HRV declining 5 days: recovery priority

Hydration:
- GLP-1 increases dehydration risk. Push water consistently.
- Hydration low: push 2-3 cups of water immediately, add electrolytes
- Aim for 8-10 cups daily minimum

PRIORITIZATION: Recovery > performance. Side effect management > training goals. Protein > calories. Consistency > intensity. Trends > single day data.

KEY PRINCIPLE: Don't just say "your HRV is down." Say "your HRV is down, so here's what that means for your day." Data becomes direction.

PERSONALIZATION:
- Always start from their data. Their numbers, patterns, and history come first
- Synthesize across signals. Look at sleep + recovery + side effects + appetite together
- Surface patterns they might not notice. Connect the dots
- Compare against their personal baselines, not population averages
- When data is limited, say so naturally and still be useful

GOOD EXAMPLE (write like this):
"You're in a solid place today. Recovery is strong and it looks like your body is adjusting well to treatment.

I'd make the most of it with a strength session if you can. Focus on compound movements and get some protein in afterward. Days like this build real momentum."

ANOTHER GOOD EXAMPLE:
"Side effects seem heavier today. That's normal, especially after a dose change.

I'd keep things really simple. Sip water, try small bland meals, and skip anything intense. A gentle walk after eating can help with the nausea. This will pass."

GUARDRAILS:
- No medical claims or diagnoses
- Don't overstate certainty when data is limited
- Never tell someone to change their medication dose or schedule
- Keep all guidance practical, safe, and understandable
- Always frame side effects as manageable and temporary

BEFORE RESPONDING, CHECK:
- Does this sound like a real person talking to someone they know?
- Is it short, specific, and grounded in their data?
- Could this only apply to this person, or is it generic?
- If it reads like a blog post or a checklist, rewrite it.`;


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
      name?: string;
      age: number;
      sex: string;
      weight: number;
      goalWeight: number;
      goals: string[];
      glp1Medication?: string;
      glp1Duration?: string;
      proteinConfidence?: string;
      strengthTrainingBaseline?: string;
      availableWorkoutTime?: number;
      daysAvailableToTrain?: number;
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
    glp1DailyInputs?: {
      energy?: string | null;
      appetite?: string | null;
      hydration?: string | null;
      proteinConfidence?: string | null;
      sideEffects?: string | null;
      movementIntent?: string | null;
    };
    sleepInsight?: string;
    hrvBaseline?: number;
    hrvDeviation?: number;
    sleepDebt?: number;
    recoveryTrend?: string;
    weeklyCompletionRate?: number;
    streakDays?: number;
    weeklyConsistency?: number;
    medicationProfile?: {
      medicationBrand: string;
      genericName: string;
      doseValue: number;
      doseUnit: string;
      frequency: string;
      recentTitration: boolean;
      previousDoseValue?: number;
      timeOnMedicationBucket?: string;
      telehealthPlatform?: string;
      plannedDoseDay?: string;
    };
    recentDoseLog?: { date: string; status: string; doseValue: number; doseUnit: string }[];
  };
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
}


router.post("/chat", async (req: Request, res: Response) => {
  try {
    const body = req.body as ChatRequestBody;
    const { message, healthContext, conversationHistory } = body;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required" });
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

      if (healthContext.glp1DailyInputs) {
        const g = healthContext.glp1DailyInputs;
        const glp1Parts: string[] = [];
        if (g.energy) glp1Parts.push(`Energy: ${g.energy}`);
        if (g.appetite) glp1Parts.push(`Appetite: ${g.appetite}`);
        if (g.hydration) glp1Parts.push(`Hydration: ${g.hydration}`);
        if (g.proteinConfidence) glp1Parts.push(`Protein confidence: ${g.proteinConfidence}`);
        if (g.sideEffects) glp1Parts.push(`Side effects: ${g.sideEffects}`);
        if (g.movementIntent) glp1Parts.push(`Movement intent: ${g.movementIntent}`);
        if (glp1Parts.length > 0) {
          parts.push(`\nTODAY'S GLP-1 CHECK-IN: ${glp1Parts.join(", ")}`);
        }
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
          p.glp1Medication ? `- GLP-1 Medication: ${p.glp1Medication}` : "",
          p.glp1Duration ? `- Treatment Duration: ${p.glp1Duration}` : "",
          p.proteinConfidence ? `- Protein Confidence: ${p.proteinConfidence}` : "",
          p.strengthTrainingBaseline ? `- Strength Training: ${p.strengthTrainingBaseline}` : "",
          `- Available Time: ${p.availableWorkoutTime} min/session, ${p.daysAvailableToTrain} active days/week`,
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

      if (healthContext.medicationProfile) {
        const med = healthContext.medicationProfile;
        const medParts: string[] = [
          `\nMEDICATION PROFILE:`,
          `- Brand: ${med.medicationBrand} (${med.genericName})`,
          `- Current Dose: ${med.doseValue} ${med.doseUnit} ${med.frequency}`,
        ];
        if (med.recentTitration) {
          medParts.push(`- Recent Titration: Yes${med.previousDoseValue ? ` (from ${med.previousDoseValue} ${med.doseUnit})` : ""}`);
        }
        if (med.timeOnMedicationBucket) {
          const bucketLabels: Record<string, string> = {
            less_1_month: "Less than 1 month",
            "1_3_months": "1-3 months",
            "3_6_months": "3-6 months",
            "6_plus_months": "6+ months",
          };
          medParts.push(`- Time on Medication: ${bucketLabels[med.timeOnMedicationBucket] || med.timeOnMedicationBucket}`);
        }
        if (med.telehealthPlatform) medParts.push(`- Telehealth: ${med.telehealthPlatform}`);
        if (med.plannedDoseDay) medParts.push(`- Planned Dose Day: ${med.plannedDoseDay}`);
        parts.push(...medParts);
      }

      if (healthContext.recentDoseLog && healthContext.recentDoseLog.length > 0) {
        const logLines = healthContext.recentDoseLog.map(e => `${e.date}: ${e.status} (${e.doseValue} ${e.doseUnit})`);
        parts.push(`\nRECENT DOSE LOG:\n${logLines.join("\n")}`);
      }

      contextBlock = parts.filter(Boolean).join("\n");
    }

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    if (contextBlock) {
      const userName = healthContext?.profile?.name;
      const nameNote = userName ? ` Their name is ${userName}. Use it occasionally and naturally. Not every message. Maybe once in a few exchanges. Never force it.` : "";
      messages.push({
        role: "system",
        content: `This is what you know about this person right now. Use it naturally. Don't list their stats back to them. Instead, interpret what the data means and talk to them like you understand their situation. Keep it human.${nameNote}\n\n${contextBlock}`,
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

const WEEKLY_PLAN_PROMPT = `You are VIVA, a supportive health coach generating a personalized weekly plan for someone on GLP-1 medication.

DATA WEIGHTING:
- 60% = wearable/biometric data (sleep, HRV, resting HR, strain, steps, recovery trends)
- 40% = self-reported inputs (energy, appetite, side effects, hydration, protein confidence)
- When the two conflict, prioritize wearable data but still acknowledge the user's current state

Based on the user's health data, goals, GLP-1 treatment status, recent behavior, and trends, generate a 7-day plan covering 5 daily support categories:

1. Move: movement recommendation ("30 min strength", "20 min walk", "Gentle walk", "Rest day", etc.)
2. Fuel: nutrition focus ("Protein-rich meals", "Small frequent meals", "Recovery nutrition", etc.)
3. Hydrate: hydration target in cups ("8 cups water", "10+ cups water", "Water + electrolytes", etc.)
4. Recover: sleep/recovery target ("Bed by 10:00 pm", "Aim for 8 hours", "Wind down early", etc.)
5. Consistent: consistency action ("Daily check-in", "Log meals", "Track symptoms", etc.)

GLP-1 SPECIFIC RULES:
- Prioritize strength training 2-3x per week for muscle preservation
- On heavy symptom days, only prescribe gentle walking
- After dose changes, plan 1-2 lighter weeks
- Always include protein focus in fueling
- Hydration minimum 8 cups daily, more on active days
- Walking after meals helps with nausea and digestion
- Under-eating is as big a risk as overeating. Watch for it.
- NEVER use these words: dropout risk, churn, adherence risk, compliance risk, failing treatment

DECISION RULES (apply to each day):
- Sleep < 6.5h: reduce intensity, keep movement gentle
- Sleep < 6h AND HRV down > 10%: full recovery day (walk only)
- Sleep declining 3+ days: prioritize sleep over activity
- Sleep > 7.5h AND HRV above baseline: good day for strength session or longer walk
- HRV down > 15% from average: recovery protocol
- HRV stable BUT resting HR elevated > 5 bpm: moderate only
- Low appetite: emphasize nutrient-dense, protein-rich foods
- Heavy side effects: simplify everything, gentle movement only

PRIORITIZATION: Recovery > performance. Side effect management > training goals. Protein > calories. Consistency > intensity. Trends > single day.

IMPORTANT RULES:
- Keep each recommendation SHORT: 2-5 words max
- Use cups for all hydration, never liters
- Never use em dashes
- Make the plan feel supportive and personalized, not templated
- Include 2-3 lighter/recovery days per week
- Balance the week: don't put all hard days together
- Each day should have a focusArea that pairs physical and recovery themes

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
      "consistent": "..."
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
          `- Goals: ${p.goals?.join(", ") || "feel better on treatment"}`,
          `- Active days per week: ${p.daysAvailableToTrain || 4}`,
          `- Available time per session: ${p.availableWorkoutTime || 45} min for activity`,
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
        content: "Generate a balanced weekly support plan for someone on GLP-1 treatment. Focus on protein intake, gentle movement, hydration, and treatment consistency.",
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
