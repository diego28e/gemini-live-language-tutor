import { GoogleGenAI, Type } from '@google/genai';
import { pool } from './db.js';

interface LessonContext {
    language: string;
    grammar_focus: string;
    vocab_focus: string | null;
    cefr_level: string;
}

/**
 * Fire-and-forget evaluator — called after a session ends.
 * Reads the transcript, calls Gemini 2.5 Flash Lite, and writes
 * the result to Session_Evaluations. Never throws to the caller.
 */
export async function runEvaluation(
    sessionId: string,
    transcript: string,
    lesson: LessonContext,
): Promise<void> {
    console.log('[evaluator] ── runEvaluation called ────────────────────────');
    console.log(`[evaluator] Session ID: ${sessionId}`);
    console.log(`[evaluator] Lesson: ${lesson.language} / ${lesson.cefr_level} / grammar: ${lesson.grammar_focus}`);
    console.log(`[evaluator] Transcript length: ${transcript?.length ?? 0} chars, lines: ${transcript?.split('\n').length ?? 0}`);
    if (transcript?.length > 0) {
        console.log(`[evaluator] Transcript preview:\n${transcript.substring(0, 300)}...`);
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[evaluator] ✗ GEMINI_API_KEY not set — cannot evaluate');
            return;
        }
        console.log('[evaluator] ✓ GEMINI_API_KEY found');

        if (!transcript || transcript.trim().length < 30) {
            console.warn(`[evaluator] ✗ Transcript too short (${transcript?.trim().length ?? 0} chars) — skipping`);
            return;
        }
        console.log('[evaluator] ✓ Transcript length OK');

        const evaluatorSystemPrompt = `You are an expert ${lesson.language} linguistic evaluator assessing a student's performance in a conversational, voice-only language lesson.

LESSON CONTEXT:
- Target Grammar: ${lesson.grammar_focus}
- Vocabulary Focus: ${lesson.vocab_focus || 'General vocabulary'}
- CEFR Target Level: ${lesson.cefr_level}

YOUR TASK:
Analyze the provided speech-to-text transcript and generate a highly specific, constructive "Report Card" for the student. 

EVALUATION RULES:
1. Identify the Student: Distinguish between the AI Tutor and the Student. ONLY analyze and correct the Student's speech.
2. Ignore Transcription Artifacts (CRITICAL): The student interacted entirely via voice. Any spelling, capitalization, or punctuation anomalies in the transcript are errors from the speech-to-text system, NOT the student. DO NOT penalize, mention, or provide feedback on spelling, capitalization, or punctuation.
3. Grading Rubric: Focus the "overall_score" (0-100) strictly on spoken mastery of the Target Grammar, vocabulary usage, and conversational fluency appropriate for their CEFR Level.
4. Hidden Errors: Catch structural or grammatical spoken mistakes that the real-time tutor may have let slide to maintain conversational flow. 
5. Empty States: If the student made no spoken grammar or vocabulary errors, leave those arrays completely empty ([]). Do not invent errors to fill the JSON.

EXPECTED JSON OUTPUT FORMAT:
{
  "overall_score": <Integer 0-100>,
  "grammar_corrections": [
    {
      "original": "<Quote the exact incorrect spoken sentence>",
      "corrected": "<Provide the grammatically correct spoken version>",
      "explanation": "<Brief 1-sentence explanation of the grammar rule>"
    }
  ],
  "vocabulary_notes": [
    {
      "word": "<A word the student used incorrectly in spoken context, or a word they should have used instead>",
      "context": "<How it was used in the conversation>",
      "suggestion": "<Better spoken alternative or correction>"
    }
  ],
  "strengths_summary": "<2 sentences praising specific, actual things they did well in the conversation>",
  "next_steps_recommendation": "<1 sentence of highly actionable advice on what to practice next in their speaking>"
}

OUTPUT CONSTRAINTS:
Return ONLY raw JSON. Do not wrap the output in markdown fences (like \`\`\`json) and do not include any conversational filler.`;

        // gemini-2.5-flash is the confirmed stable GA lite model (July 2025).
        const EVALUATOR_MODEL = 'gemini-2.5-flash';

        const ai = new GoogleGenAI({ apiKey });
        console.log(`[evaluator] Calling ${EVALUATOR_MODEL} for session ${sessionId}, transcript length: ${transcript.length}`);

        console.log(`[evaluator] → Sending request to ${EVALUATOR_MODEL}...`);
        const response = await ai.models.generateContent({
            model: EVALUATOR_MODEL,
            contents: [
                {
                    role: 'user',
                    parts: [{ text: `Here is the lesson transcript:\n\n${transcript}\n\nAnalyze it and return the JSON report card.` }],
                },
            ],
            config: {
        systemInstruction: evaluatorSystemPrompt,
        temperature: 0.2, // Lowered slightly from 0.3 to make grading more deterministic
        responseMimeType: 'application/json',
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                overall_score: { type: Type.INTEGER },
                grammar_corrections: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            original: { type: Type.STRING },
                            corrected: { type: Type.STRING },
                            explanation: { type: Type.STRING }
                        },
                        required: ["original", "corrected", "explanation"]
                    }
                },
                vocabulary_notes: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            word: { type: Type.STRING },
                            context: { type: Type.STRING },
                            suggestion: { type: Type.STRING }
                        },
                        required: ["word", "context", "suggestion"]
                    }
                },
                strengths_summary: { type: Type.STRING },
                next_steps_recommendation: { type: Type.STRING }
            },
            required: [
                "overall_score", 
                "grammar_corrections", 
                "vocabulary_notes", 
                "strengths_summary", 
                "next_steps_recommendation"
            ]
        }
    },
});
        console.log('[evaluator] ✓ Gemini responded');

        let rawText = response.text ?? '';
        console.log(`[evaluator] Raw response length: ${rawText.length} chars`);
        console.log(`[evaluator] Raw response preview: ${rawText.substring(0, 200)}`);
        // Strip markdown code fences (```json ... ```) if Gemini wraps the output
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        let evaluation: {
            overall_score: number;
            grammar_corrections: object[];
            vocabulary_notes: object[];
            strengths_summary: string;
            next_steps_recommendation: string;
        };

        try {
            evaluation = JSON.parse(rawText);
            console.log(`[evaluator] ✓ JSON parsed — score: ${evaluation.overall_score}, grammar fixes: ${evaluation.grammar_corrections?.length ?? 0}`);
        } catch {
            console.error('[evaluator] ✗ Failed to parse Gemini response as JSON. Raw:');
            console.error(rawText.substring(0, 500));
            return;
        }

        console.log('[evaluator] → Inserting into Session_Evaluations...');
        await pool.query(
            `INSERT INTO Session_Evaluations
             (session_id, overall_score, grammar_corrections, vocabulary_notes, strengths_summary, next_steps_recommendation)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                sessionId,
                evaluation.overall_score ?? 0,
                JSON.stringify(evaluation.grammar_corrections ?? []),
                JSON.stringify(evaluation.vocabulary_notes ?? []),
                evaluation.strengths_summary ?? '',
                evaluation.next_steps_recommendation ?? '',
            ],
        );

        console.log(`[evaluator] ✓ Evaluation saved for session ${sessionId} — score: ${evaluation.overall_score}`);
        console.log('[evaluator] ──────────────────────────────────────────────');
    } catch (e) {
        // Never throw — this runs fire-and-forget after session close
        console.error('[evaluator] ✗ Unexpected error:', e);
        console.error('[evaluator] ──────────────────────────────────────────────');
    }
}
