import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signIn, auth } from '../firebase';
import { BookOpen, Globe2, Loader2, Play, Sparkles, X, ChevronDown, ChevronUp } from 'lucide-react';

interface Lesson {
    id: string;
    title: string;
    cefr_level: string;
    language: string;
}

// ---------------------------------------------------------------------------
// Evaluation types
// ---------------------------------------------------------------------------
interface GrammarCorrection {
    original: string;
    corrected: string;
    explanation: string;
}
interface VocabNote {
    word: string;
    context: string;
    suggestion: string;
}
interface Evaluation {
    overall_score: number;
    grammar_corrections: GrammarCorrection[];
    vocabulary_notes: VocabNote[];
    strengths_summary: string;
    next_steps_recommendation: string;
}
type EvalStatus =
    | { status: 'none' }
    | { status: 'pending' }
    | { status: 'completed'; evaluation: Evaluation };

// ---------------------------------------------------------------------------
// EvaluationReport modal
// ---------------------------------------------------------------------------
function ScoreGauge({ score }: { score: number }) {
    const color = score >= 75 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-rose-400';
    const ring = score >= 75 ? 'stroke-emerald-400' : score >= 50 ? 'stroke-amber-400' : 'stroke-rose-400';
    const circumference = 2 * Math.PI * 40;
    const dash = (score / 100) * circumference;
    return (
        <div className="flex flex-col items-center gap-1">
            <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" strokeWidth="10" />
                <circle cx="50" cy="50" r="40" fill="none" className={ring} strokeWidth="10"
                    strokeDasharray={`${dash} ${circumference}`}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)" />
                <text x="50" y="56" textAnchor="middle" className={`text-2xl font-bold fill-current ${color}`} fontSize="22">{score}</text>
            </svg>
            <span className="text-xs text-slate-400 font-medium">Overall Score</span>
        </div>
    );
}

function EvaluationReport({ lessonTitle, evaluation, onClose }: {
    lessonTitle: string;
    evaluation: Evaluation;
    onClose: () => void;
}) {
    const [openGrammar, setOpenGrammar] = useState<number | null>(0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0f1117] border border-white/10 rounded-3xl shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-[#0f1117] border-b border-white/10 px-6 py-4 flex items-center justify-between z-10 rounded-t-3xl">
                    <div>
                        <p className="text-xs text-slate-400 font-medium mb-0.5">Lesson Feedback</p>
                        <h2 className="text-lg font-bold text-white leading-tight">{lessonTitle}</h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 flex flex-col gap-6">
                    {/* Score */}
                    <div className="flex justify-center">
                        <ScoreGauge score={evaluation.overall_score} />
                    </div>

                    {/* Strengths */}
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                        <h3 className="text-sm font-semibold text-emerald-400 mb-2">✓ What you did well</h3>
                        <p className="text-slate-300 text-sm leading-relaxed">{evaluation.strengths_summary}</p>
                    </div>

                    {/* Grammar corrections */}
                    {evaluation.grammar_corrections?.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-slate-300 mb-3">Grammar Corrections</h3>
                            <div className="flex flex-col gap-2">
                                {evaluation.grammar_corrections.map((g, i) => (
                                    <div key={i} className="border border-white/10 rounded-xl overflow-hidden">
                                        <button
                                            className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 transition text-left"
                                            onClick={() => setOpenGrammar(openGrammar === i ? null : i)}
                                        >
                                            <span className="text-rose-400 text-sm font-mono truncate max-w-[80%]">❝ {g.original}</span>
                                            {openGrammar === i ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                                        </button>
                                        {openGrammar === i && (
                                            <div className="px-4 py-3 bg-[#0f1117] flex flex-col gap-2">
                                                <p className="text-sm"><span className="text-slate-500">Correction: </span><span className="text-emerald-400 font-medium">{g.corrected}</span></p>
                                                <p className="text-xs text-slate-400">{g.explanation}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Vocabulary notes */}
                    {evaluation.vocabulary_notes?.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-slate-300 mb-3">Vocabulary Notes</h3>
                            <div className="flex flex-col gap-2">
                                {evaluation.vocabulary_notes.map((v, i) => (
                                    <div key={i} className="border border-white/10 rounded-xl px-4 py-3 bg-white/5">
                                        <p className="text-indigo-400 font-semibold text-sm mb-1">{v.word}</p>
                                        <p className="text-xs text-slate-400 mb-1">{v.context}</p>
                                        <p className="text-xs text-slate-300">→ {v.suggestion}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Next steps */}
                    <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4">
                        <h3 className="text-sm font-semibold text-indigo-400 mb-2">→ Next steps</h3>
                        <p className="text-slate-300 text-sm leading-relaxed">{evaluation.next_steps_recommendation}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Languages shown in the onboarding dropdown.
// Key = display name stored in DB, value = BCP-47 code used for Azure translation.
const NATIVE_LANGUAGES: { label: string; value: string }[] = [
    { label: 'Spanish', value: 'Spanish' },
    { label: 'Portuguese', value: 'Portuguese' },
    { label: 'French', value: 'French' },
    { label: 'Italian', value: 'Italian' },
    { label: 'German', value: 'German' },
    { label: 'Mandarin Chinese', value: 'Mandarin' },
    { label: 'Arabic', value: 'Arabic' },
    { label: 'English', value: 'English' },
    { label: 'Other', value: 'Other' },
];

// ---------------------------------------------------------------------------
// Onboarding modal
// ---------------------------------------------------------------------------
function OnboardingModal({ onComplete }: { onComplete: (lang: string) => void }) {
    const [selected, setSelected] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!selected) return;
        setSaving(true);
        try {
            const idToken = await auth.currentUser!.getIdToken();
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
            const res = await fetch(`${apiUrl}/api/onboard`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ nativeLanguage: selected }),
            });
            if (!res.ok) throw new Error('Onboarding failed');
            localStorage.setItem('nativeLanguage', selected);
            onComplete(selected);
        } catch (e) {
            console.error(e);
            alert('Could not save your language. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="relative w-full max-w-sm mx-4 rounded-3xl bg-[#13161c] border border-white/10 p-8 shadow-2xl">
                {/* Glow */}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-32 h-32 bg-indigo-600/30 blur-[60px] rounded-full pointer-events-none" />

                <div className="flex items-center gap-3 mb-6">
                    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20">
                        <Globe2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white">Quick Setup</h2>
                        <p className="text-xs text-slate-400">Takes 5 seconds</p>
                    </div>
                </div>

                <p className="text-sm text-slate-300 mb-5">
                    What is your native language? We'll use it to translate words you don't understand during lessons.
                </p>

                <select
                    value={selected}
                    onChange={e => setSelected(e.target.value)}
                    className="w-full mb-6 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                >
                    <option value="" disabled>Select your language…</option>
                    {NATIVE_LANGUAGES.map(l => (
                        <option key={l.value} value={l.value} className="bg-slate-900">
                            {l.label}
                        </option>
                    ))}
                </select>

                <button
                    onClick={handleSubmit}
                    disabled={!selected || saving}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white"
                >
                    {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <><span>Let's Start →</span></>
                    )}
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export default function Dashboard() {
    const [lessons, setLessons] = useState<Lesson[]>([]);
    const [loading, setLoading] = useState(true);
    const [startingLesson, setStartingLesson] = useState<string | null>(null);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [evaluations, setEvaluations] = useState<Map<string, EvalStatus>>(new Map());
    const [viewingEval, setViewingEval] = useState<{ lessonId: string; lessonTitle: string } | null>(null);
    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const navigate = useNavigate();

    // Fetch evaluation for one lesson and update state
    const fetchEval = async (lessonId: string) => {
        if (!auth.currentUser) return;
        try {
            const idToken = await auth.currentUser.getIdToken();
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
            const res = await fetch(`${apiUrl}/api/lessons/${lessonId}/evaluation`, {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            if (!res.ok) return;
            const data: EvalStatus = await res.json();
            setEvaluations(prev => new Map(prev).set(lessonId, data));
        } catch { /* silent */ }
    };

    const fetchAllEvals = async (lessonList: Lesson[]) => {
        if (!auth.currentUser) return;
        await Promise.all(lessonList.map(l => fetchEval(l.id)));
    };

    // Poll pending evaluations every 5s until they resolve
    useEffect(() => {
        const hasPending = [...evaluations.values()].some(e => e.status === 'pending');
        if (!hasPending) {
            if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
            return;
        }
        if (!pollTimer.current) {
            pollTimer.current = setInterval(() => {
                const pendingIds = [...evaluations.entries()]
                    .filter(([, v]) => v.status === 'pending')
                    .map(([id]) => id);
                pendingIds.forEach(id => fetchEval(id));
            }, 5000);
        }
        return () => {
            if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
        };
    }, [evaluations]);

    // Re-fetch evaluations when navigating back to this page (e.g., after completing a session).
    // location.key changes on every navigation so this works whether Dashboard remounts or not.
    const location = useLocation();
    useEffect(() => {
        if (lessons.length > 0 && auth.currentUser) {
            fetchAllEvals(lessons);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key]);

    useEffect(() => {
        // `cancelled` prevents state updates if StrictMode unmounts this mount
        // before the async init chain finishes (defence-in-depth alongside the
        // singleton promise fix in firebase.ts).
        let cancelled = false;

        const init = async () => {
            try {
                // 1. Sign in anonymously if needed (singleton-guarded — safe to call concurrently)
                await signIn();
                if (cancelled) return;

                // 2. Check if onboarding is complete (localStorage fast-path, then API)
                const cachedLang = localStorage.getItem('nativeLanguage');
                if (!cachedLang) {
                    try {
                        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
                        const idToken = await auth.currentUser!.getIdToken();
                        if (cancelled) return;
                        const res = await fetch(`${apiUrl}/api/user`, {
                            headers: { Authorization: `Bearer ${idToken}` },
                        });
                        if (cancelled) return;
                        if (!res.ok) {
                            // 404 = needs onboarding
                            setShowOnboarding(true);
                        }
                        // else: user exists and has native_language set → skip modal
                    } catch (_) {
                        if (!cancelled) setShowOnboarding(true);
                    }
                }

                // 3. Fetch lessons
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
                const res = await fetch(`${apiUrl}/api/lessons`);
                if (!cancelled && res.ok) {
                    const lessonList = await res.json();
                    setLessons(lessonList);
                    // Fetch evaluations for all lessons in parallel
                    fetchAllEvals(lessonList);
                }
            } catch (err) {
                console.error('Dashboard init error:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        init();
        return () => { cancelled = true; };
    }, []);


    const handleOnboardingComplete = async (lang: string) => {
        console.log(`[onboard] Native language set to: ${lang}`);
        setShowOnboarding(false);
        // Now that user exists in DB, fetch evaluations
        await fetchAllEvals(lessons);
    };

    const handleStartLesson = async (lessonId: string) => {
        if (showOnboarding) return; // guard: must finish onboarding first
        setStartingLesson(lessonId);
        try {
            navigate(`/classroom/${lessonId}`);
        } catch (e) {
            console.error(e);
            alert('Failed to start session. Please try again.');
        } finally {
            setStartingLesson(null);
        }
    };

    return (
        <div className="min-h-screen p-8 relative overflow-hidden bg-slate-950">
            {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}

            {/* Background Orbs */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-rose-600/20 blur-[120px] rounded-full pointer-events-none" />

            <div className="max-w-6xl mx-auto relative z-10">
                <header className="mb-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-3 rounded-2xl shadow-lg shadow-indigo-500/20">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                            AI Tutor<span className="font-light">.Live</span>
                        </h1>
                    </div>
                    <div className="px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md text-sm font-medium text-slate-300">
                        {auth.currentUser ? 'Signed in as Guest' : 'Not signed in'}
                    </div>
                </header>

                <section className="mb-12">
                    <h2 className="text-4xl font-semibold mb-4 tracking-tight">Select a Lesson</h2>
                    <p className="text-slate-400 text-lg max-w-2xl">
                        Practice real-time conversations with your AI tutor. Make mistakes, get feedback, and improve naturally.
                    </p>
                </section>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {lessons.map((lesson) => (
                            <div
                                key={lesson.id}
                                className="group relative rounded-3xl p-[1px] bg-gradient-to-b from-white/15 to-white/5 hover:from-indigo-500/50 hover:to-purple-500/50 transition-all duration-300 overflow-hidden"
                            >
                                <div className="h-full w-full bg-[#13161c] rounded-[23px] overflow-hidden flex flex-col p-6">

                                    {/* Language Pill */}
                                    <div className="flex justify-between items-start mb-6">
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-slate-300">
                                            <Globe2 className="w-3.5 h-3.5 opacity-70" />
                                            {lesson.language}
                                        </span>
                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                            {lesson.cefr_level}
                                        </span>
                                    </div>

                                    <BookOpen className="w-10 h-10 text-slate-700 mb-4 group-hover:text-indigo-400 transition-colors duration-300" />

                                    <h3 className="text-xl font-bold text-white mb-2 leading-tight">
                                        {lesson.title}
                                    </h3>

                                    <div className="mt-auto pt-6 flex flex-col gap-2">
                                        {/* Evaluation button — shown above Start Practice once a session exists */}
                                        {(() => {
                                            const evalState = evaluations.get(lesson.id);
                                            if (!evalState || evalState.status === 'none') return null;
                                            if (evalState.status === 'pending') {
                                                return (
                                                    <div className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-medium text-slate-400 border border-white/10 bg-white/5 cursor-default">
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        Generating feedback…
                                                    </div>
                                                );
                                            }
                                            // completed
                                            return (
                                                <button
                                                    onClick={() => setViewingEval({ lessonId: lesson.id, lessonTitle: lesson.title })}
                                                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-indigo-400 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 transition"
                                                >
                                                    📊 View last feedback
                                                </button>
                                            );
                                        })()}

                                        <button
                                            onClick={() => handleStartLesson(lesson.id)}
                                            disabled={startingLesson === lesson.id || showOnboarding}
                                            className="w-full relative flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium bg-white text-slate-900 hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {startingLesson === lesson.id ? (
                                                <><Loader2 className="w-5 h-5 animate-spin" /><span>Preparing...</span></>
                                            ) : (
                                                <><Play className="w-4 h-4 fill-slate-900" /><span>Start Practice</span></>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Evaluation modal — rendered inside the root div so backdrop is correct */}
            {viewingEval !== null && (() => {
                const evalState = evaluations.get(viewingEval!.lessonId);
                if (evalState?.status !== 'completed') return null;
                return (
                    <EvaluationReport
                        lessonTitle={viewingEval!.lessonTitle}
                        evaluation={(evalState as { status: 'completed'; evaluation: Evaluation }).evaluation}
                        onClose={() => setViewingEval(null)}
                    />
                );
            })()}
        </div>
    );
}
