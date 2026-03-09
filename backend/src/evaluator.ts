import { GoogleGenAI } from '@google/genai';
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

        const evaluatorSystemPrompt = `You are an expert ${lesson.language} linguistic evaluator. Your job is to analyze the transcript of a 5-minute language lesson and generate a highly specific, constructive "Report Card" for the student.

LESSON CONTEXT:
- Target Grammar: ${lesson.grammar_focus}
- Vocabulary Focus: ${lesson.vocab_focus || 'General vocabulary'}
- CEFR Level: ${lesson.cefr_level}

RULES:
1. You must analyze the transcript specifically looking for the student's errors that the real-time tutor may have let slide to maintain conversational flow.
2. Provide specific quotes of the student's mistakes and the exact corrections.
3. Your output MUST be a raw JSON object matching the exact structure below. Do not include markdown formatting or conversational text outside the JSON.

EXPECTED JSON OUTPUT FORMAT:
{
  "overall_score": <Integer 0-100 based on mastery of Target Grammar and general fluency>,
  "grammar_corrections": [
    {
      "original": "<Quote the exact incorrect sentence the student said>",
      "corrected": "<Provide the correct version>",
      "explanation": "<Brief 1-sentence explanation of the grammar rule>"
    }
  ],
  "vocabulary_notes": [
    {
      "word": "<A word the student used incorrectly or a word they should have used>",
      "context": "<How it was used>",
      "suggestion": "<Better alternative or correction>"
    }
  ],
  "strengths_summary": "<2 sentences praising specific things they did well in the transcript>",
  "next_steps_recommendation": "<1 sentence of actionable advice on what to practice next>"
}`;

        // gemini-2.5-flash-lite is the confirmed stable GA lite model (July 2025).
        const EVALUATOR_MODEL = 'gemini-2.5-flash-lite';

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
                temperature: 0.3,
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
