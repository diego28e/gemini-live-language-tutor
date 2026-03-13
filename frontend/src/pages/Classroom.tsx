import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    StartAudio,
    TrackToggle,
    BarVisualizer,
    useVoiceAssistant,
    useTracks,
    VideoTrack,
    useTranscriptions,
    useConnectionState,
    useRoomContext,
} from '@livekit/components-react';
import { Track, ConnectionState, RoomEvent, type TranscriptionSegment } from 'livekit-client';
import { auth } from '../firebase';
import { ArrowLeft, Loader2, Languages, X } from 'lucide-react';
import Lottie from 'lottie-react';

// ---------------------------------------------------------------------------
// No-credits screen
// ---------------------------------------------------------------------------
function NoCreditsScreen() {
    const navigate = useNavigate();
    const [animData, setAnimData] = useState<object | null>(null);

    useEffect(() => {
        fetch('/animations/nothing.json')
            .then(r => r.json())
            .then(setAnimData)
            .catch(() => {/* animation optional */ });
    }, []);

    return (
        <div className="flex h-screen flex-col items-center justify-center bg-slate-950 text-white px-6">
            <div className="w-64 h-64">
                {animData && <Lottie animationData={animData} loop />}
            </div>
            <h2 className="text-2xl font-bold mt-2 mb-3">You're out of sessions</h2>
            <p className="text-slate-400 text-center max-w-sm mb-8">
                You've used all your practice sessions for this month.
                Your credits reset automatically on the <span className="text-white font-medium">1st of each month</span>.
            </p>
            <button
                onClick={() => navigate('/')}
                className="px-6 py-3 rounded-full bg-indigo-600 hover:bg-indigo-500 transition font-semibold text-sm"
            >
                ← Back to lessons
            </button>
        </div>
    );
}

const LANG_CODE: Record<string, string> = {
    English: 'en',
    Spanish: 'es',
    Portuguese: 'pt',
    French: 'fr',
    Italian: 'it',
    German: 'de',
    Mandarin: 'zh-Hans',
    Arabic: 'ar',
    Other: 'en', // fallback
};

// ---------------------------------------------------------------------------
// Translation tooltip component
// ---------------------------------------------------------------------------
interface TranslationTooltipProps {
    text: string;
    translation: string | null;
    loading: boolean;
    sameLanguage: boolean;
    position: { x: number; y: number };
    onClose: () => void;
}

function TranslationTooltip({ text, translation, loading, sameLanguage, position, onClose }: TranslationTooltipProps) {
    return (
        <div
            className="fixed z-50 max-w-xs bg-slate-900 border border-white/15 rounded-2xl shadow-2xl shadow-black/50 p-4 backdrop-blur-xl"
            style={{ left: position.x, top: position.y, transform: 'translateX(-50%) translateY(-110%)' }}
        >
            {/* small caret */}
            <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 border-r border-b border-white/15 rotate-45" />

            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 uppercase tracking-wide">
                    <Languages className="w-3.5 h-3.5" />
                    Translation
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            <p className="text-xs text-slate-400 mb-2 italic leading-snug">"{text}"</p>

            {loading && (
                <div className="flex items-center gap-2 text-slate-300 text-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Translating…</span>
                </div>
            )}
            {!loading && sameLanguage && (
                <p className="text-slate-300 text-sm leading-snug">
                    💡 The lesson is in your native language — no translation needed.
                </p>
            )}
            {!loading && !sameLanguage && translation && (
                <p className="text-white text-sm font-medium leading-snug">{translation}</p>
            )}
            {!loading && !sameLanguage && !translation && (
                <p className="text-red-400 text-sm">Could not translate. Check Azure credentials.</p>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Classroom page
// ---------------------------------------------------------------------------
export default function Classroom() {
    const { lessonId } = useParams();
    const navigate = useNavigate();
    const [token, setToken] = useState('');
    const [error, setError] = useState('');
    const [noCredits, setNoCredits] = useState(false);
    const [nativeLanguage, setNativeLanguage] = useState<string>('');
    const [lessonLanguage, setLessonLanguage] = useState<string>('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [lessonTitle, setLessonTitle] = useState<string>('');

    useEffect(() => {
        if (!auth.currentUser) {
            navigate('/');
            return;
        }

        // AbortController ensures that if React StrictMode (dev) or a fast navigation
        // causes this effect to run twice, the first in-flight fetch is cancelled on
        // unmount before it can create a duplicate session or deduct a credit.
        const controller = new AbortController();

        const initRoom = async () => {
            try {
                const idToken = await auth.currentUser!.getIdToken();
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

                const res = await fetch(`${apiUrl}/api/token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({ lessonId }),
                    signal: controller.signal,   // ← abort hook
                });

                if (res.status === 402) {
                    setNoCredits(true);
                    return;
                }

                if (!res.ok) throw new Error('Failed to connect to classroom. Please try again.');

                const data = await res.json();
                setToken(data.token);
                setNativeLanguage(data.nativeLanguage ?? '');
                setSessionId(data.sessionId ?? null);

                // Fetch lesson language for translation direction
                const lessonsRes = await fetch(`${apiUrl}/api/lessons`, {
                    signal: controller.signal,
                });
                if (lessonsRes.ok) {
                    const lessons = await lessonsRes.json();
                    const lesson = lessons.find((l: { id: string; language: string; title: string }) => l.id === lessonId);
                    if (lesson) {
                        setLessonLanguage(lesson.language ?? '');
                        setLessonTitle(lesson.title ?? '');
                    }
                }
            } catch (err: any) {
                // AbortError is expected on StrictMode unmount — not a real error
                if (err.name === 'AbortError') return;
                setError(err.message);
            }
        };

        initRoom();

        // Cleanup: abort any pending fetches when the component unmounts
        return () => controller.abort();
    }, [lessonId, navigate]);

    if (noCredits) return <NoCreditsScreen />;


    if (error) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-950 text-red-400">
                <p>Error: {error}</p>
                <button className="ml-4 underline" onClick={() => navigate('/')}>Go back</button>
            </div>
        );
    }

    if (!token) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-950 flex-col gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-slate-400">Connecting to Classroom...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-slate-950 text-white relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-900/10 to-slate-950/90 pointer-events-none" />



            {/* Exit button rendered inside the room so it has access to LiveKit hooks */}
            <LiveKitRoom
                video={false}
                audio={true}
                token={token}
                serverUrl={import.meta.env.VITE_LIVEKIT_URL || 'wss://mock-server.livekit.cloud'}
                connect={true}
                className="flex-1 flex flex-col"
            >
                <ActiveClassroom
                    sessionId={sessionId}
                    nativeLanguage={nativeLanguage}
                    lessonLanguage={lessonLanguage}
                    lessonTitle={lessonTitle}
                />
                <RoomAudioRenderer />
                <StartAudio label="Click to allow audio playback" />
            </LiveKitRoom>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Custom classroom container using LiveKit hooks
// ---------------------------------------------------------------------------
const SESSION_SECONDS = 5 * 60;

interface ActiveClassroomProps {
    sessionId: string | null;
    nativeLanguage: string;
    lessonLanguage: string;
    lessonTitle: string;
}

interface TooltipState {
    visible: boolean;
    selectedText: string;
    translation: string | null;
    loading: boolean;
    sameLanguage: boolean;
    position: { x: number; y: number };
}

function ActiveClassroom({ sessionId, nativeLanguage, lessonLanguage, lessonTitle }: ActiveClassroomProps) {
    const navigate = useNavigate();
    const room = useRoomContext();
    const { state: agentState, audioTrack: agentAudio } = useVoiceAssistant();
    const transcriptions = useTranscriptions();
    const connectionState = useConnectionState();
    const [secondsLeft, setSecondsLeft] = useState(SESSION_SECONDS);
    const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
    const localCameraTrack = cameraTracks.find(t => t.participant.isLocal && !t.publication.isMuted);
    const captionRef = useRef<HTMLDivElement>(null);
    const wasConnectedRef = useRef(false);

    // ── Transcript accumulator (professional approach) ───────────────────────
    // Subscribe to the raw room event — the exact same source that powers captions.
    // Unlike useTranscriptions() (display hook with TTL eviction), this keeps ALL
    // committed final segments for the entire session lifetime.
    const transcriptLines = useRef<string[]>([]);
    useEffect(() => {
        const onTranscription = (segments: TranscriptionSegment[]) => {
            for (const seg of segments) {
                if (seg.final && (seg.text ?? '').trim()) {
                    transcriptLines.current.push((seg.text ?? '').trim());
                    console.log(`[classroom] 📝 turn ${transcriptLines.current.length}: "${seg.text?.substring(0, 70)}"`);
                }
            }
        };
        room.on(RoomEvent.TranscriptionReceived, onTranscription);
        return () => { room.off(RoomEvent.TranscriptionReceived, onTranscription); };
    }, [room]);
    // ─────────────────────────────────────────────────────────────────────────

    // Submit transcript to backend then navigate away
    const submitAndNavigate = async () => {
        const transcript = transcriptLines.current.join('\n');
        console.log(`[classroom] Submitting transcript — ${transcriptLines.current.length} turns, ${transcript.length} chars`);
        console.log(`[classroom] Preview: "${transcript.substring(0, 120)}"`);
        if (sessionId && transcript.length > 0) {
            try {
                const idToken = await auth.currentUser?.getIdToken();
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
                await fetch(`${apiUrl}/api/sessions/${sessionId}/transcript`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                    },
                    body: JSON.stringify({ transcript }),
                });
                console.log('[classroom] Transcript submitted successfully');
            } catch (e) {
                console.warn('[classroom] Transcript submission failed (non-blocking):', e);
            }
        }
        navigate('/');
    };

    // Primary exit path: agent sends a data message when the 5-min hard stop fires.
    // This is immediate (< 1s) and doesn't depend on participant disconnect timing.
    useEffect(() => {
        const handleData = (payload: Uint8Array) => {
            try {
                const msg = JSON.parse(new TextDecoder().decode(payload));
                if (msg.type === 'session_ended') {
                    console.log('[classroom] session_ended received — submitting transcript and navigating');
                    void submitAndNavigate();
                }
            } catch (_) { }
        };
        room.on(RoomEvent.DataReceived, handleData);
        return () => { room.off(RoomEvent.DataReceived, handleData); };
    }, [room, navigate]);

    // Fallback: if the room itself disconnects (network drop, server kick, etc.)
    useEffect(() => {
        if (connectionState === ConnectionState.Connected) {
            wasConnectedRef.current = true;
        }
        if (wasConnectedRef.current && connectionState === ConnectionState.Disconnected) {
            navigate('/');
        }
    }, [connectionState, navigate]);

    const [tooltip, setTooltip] = useState<TooltipState>({
        visible: false,
        selectedText: '',
        translation: null,
        loading: false,
        sameLanguage: false,
        position: { x: 0, y: 0 },
    });

    // Keep finalised (stable) caption turns separately for selection, and live (non-final) for display
    const allTranscriptions = transcriptions.filter(t => (t.text ?? '').trim());
    const captionLines = allTranscriptions.slice(-3);

    const hasAutoExited = useRef(false);

    useEffect(() => {
        const interval = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (secondsLeft === 0 && !hasAutoExited.current) {
            hasAutoExited.current = true;
            void submitAndNavigate();
        }
    }, [secondsLeft]);

    const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const seconds = String(secondsLeft % 60).padStart(2, '0');
    const timerUrgent = secondsLeft <= 120;
    const isAgentSpeaking = agentState === 'speaking';
    const isAgentListening = agentState === 'listening';

    // ------------------------------------------------------------------
    // Translation: triggered when the user releases a mouse drag selection
    // inside the caption area.
    // ------------------------------------------------------------------
    const handleCaptionMouseUp = useCallback(async () => {
        const selection = window.getSelection();
        const selectedText = selection?.toString().trim() ?? '';
        if (!selectedText || selectedText.length < 2) return;

        // Only act if selection is inside the caption container
        if (captionRef.current && selection?.rangeCount) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (!captionRef.current.contains(range.commonAncestorContainer)) return;

            const fromCode = LANG_CODE[lessonLanguage] ?? 'en';
            const toCode = LANG_CODE[nativeLanguage] ?? 'en';
            const isSame = fromCode === toCode;

            // Show tooltip immediately with loading state
            setTooltip({
                visible: true,
                selectedText,
                translation: null,
                loading: !isSame,
                sameLanguage: isSame,
                position: { x: rect.left + rect.width / 2, y: rect.top },
            });

            selection.removeAllRanges();

            if (isSame) return; // no API call needed

            try {
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
                const res = await fetch(`${apiUrl}/api/translate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: selectedText, fromLang: fromCode, toLang: toCode }),
                });
                const data = await res.json();
                setTooltip(prev => ({
                    ...prev,
                    loading: false,
                    translation: data.translation ?? null,
                    sameLanguage: !!data.same,
                }));
            } catch {
                setTooltip(prev => ({ ...prev, loading: false, translation: null }));
            }
        }
    }, [lessonLanguage, nativeLanguage]);

    const closeTooltip = () => setTooltip(prev => ({ ...prev, visible: false }));

    return (
        <div className="flex-1 flex flex-col items-center justify-center px-4 relative z-0">

            {/* Exit Lesson button — lives here so it can access useTranscriptions() */}
            <button
                onClick={() => void submitAndNavigate()}
                className="absolute top-4 left-4 z-20 flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-colors backdrop-blur-md text-sm font-medium"
            >
                <ArrowLeft className="w-4 h-4" /> Exit Lesson
            </button>

            {/* Translation tooltip */}
            {tooltip.visible && (
                <TranslationTooltip
                    text={tooltip.selectedText}
                    translation={tooltip.translation}
                    loading={tooltip.loading}
                    sameLanguage={tooltip.sameLanguage}
                    position={tooltip.position}
                    onClose={closeTooltip}
                />
            )}

            {/* Lesson title + Countdown Timer */}
            <div className="absolute top-4 right-6 flex flex-col items-end gap-1.5">
                {lessonTitle && (
                    <p className="text-xs font-medium text-slate-400 tracking-wide truncate max-w-[200px]">
                        {lessonTitle}
                    </p>
                )}
                <div className={`px-4 py-2 rounded-full text-sm font-mono font-bold border backdrop-blur-md ${timerUrgent
                    ? 'bg-red-500/20 border-red-500/40 text-red-400'
                    : 'bg-white/5 border-white/10 text-slate-300'
                    }`}>
                    {minutes}:{seconds}
                </div>
            </div>

            {/* Main Agent Visualization */}
            <div className="relative mb-8 flex flex-col items-center">
                <div className={`w-48 h-48 rounded-full border border-white/10 bg-gradient-to-br transition-colors duration-1000 flex items-center justify-center relative shadow-2xl ${isAgentSpeaking ? 'from-indigo-500/40 to-purple-500/10 shadow-indigo-500/20' :
                    isAgentListening ? 'from-emerald-500/40 to-teal-500/10 shadow-emerald-500/20' :
                        'from-slate-800 to-slate-900 shadow-none'
                    }`}>
                    {agentAudio && (
                        <BarVisualizer
                            trackRef={agentAudio}
                            barCount={5}
                            options={{ minHeight: 10 }}
                            className="w-24 h-24 text-white opacity-80"
                        />
                    )}
                    {isAgentSpeaking && (
                        <div className="absolute inset-0 rounded-full border-2 border-indigo-400 opacity-50 animate-ping" />
                    )}
                </div>
                <div className="mt-6 text-center">
                    <h2 className="text-2xl font-semibold mb-1">Tutor ({agentState})</h2>
                    <p className="text-slate-400 text-sm">Speak naturally. Interrupt whenever you want.</p>
                </div>
            </div>

            {/* Real-time Closed Captions — selectable for translation */}
            {captionLines.length > 0 && (
                <div
                    ref={captionRef}
                    onMouseUp={handleCaptionMouseUp}
                    className="w-full max-w-2xl mx-auto px-4 mb-4 flex flex-col items-center gap-1 select-text cursor-text"
                    title={nativeLanguage ? 'Select any word or phrase to translate' : ''}
                >
                    {captionLines.map((t, i) => (
                        <p key={i} className="text-sm text-center text-white bg-black/60 backdrop-blur-sm rounded px-3 py-1 leading-relaxed">
                            {t.text}
                        </p>
                    ))}
                    {nativeLanguage && (
                        <p className="text-[10px] text-slate-500 mt-0.5 select-none">
                            Select text to translate → {nativeLanguage}
                        </p>
                    )}
                </div>
            )}

            {/* Camera preview */}
            {localCameraTrack && (
                <div className="absolute bottom-24 right-6 w-36 h-24 rounded-xl overflow-hidden border border-white/20 shadow-xl">
                    <VideoTrack trackRef={localCameraTrack} className="w-full h-full object-cover scale-x-[-1]" />
                </div>
            )}

            {/* Control Bar */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-900/80 backdrop-blur-xl border border-white/10 p-3 rounded-full shadow-2xl">
                <TrackToggle source={Track.Source.Microphone} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 transition data-[state=off]:bg-red-500/80" />
                <TrackToggle source={Track.Source.Camera} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 transition data-[state=on]:bg-indigo-500" />
            </div>
        </div>
    );
}
