import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    StartAudio,
    TrackToggle,
    BarVisualizer,
    useVoiceAssistant,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { auth } from '../firebase';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function Classroom() {
    const { lessonId } = useParams();
    const navigate = useNavigate();
    const [token, setToken] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!auth.currentUser) {
            navigate('/');
            return;
        }

        const initRoom = async () => {
            try {
                const idToken = await auth.currentUser!.getIdToken();
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

                const res = await fetch(`${apiUrl}/api/token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({ lessonId })
                });

                if (!res.ok) throw new Error('Failed to get token');

                const data = await res.json();
                setToken(data.token);
                console.log('Joined room:', data.roomName);
            } catch (err: any) {
                setError(err.message);
            }
        };

        initRoom();
    }, [lessonId, navigate]);

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
            {/* Background glow */}
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-900/10 to-slate-950/90 pointer-events-none" />

            <header className="absolute top-0 w-full p-4 flex items-center justify-between z-10">
                <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-colors backdrop-blur-md text-sm font-medium"
                >
                    <ArrowLeft className="w-4 h-4" /> Exit Lesson
                </button>
            </header>

            <LiveKitRoom
                video={false} // Don't auto-publish video, we toggle it manually for the 1fps vision feed
                audio={true}  // Auto-prompt for mic immediately
                token={token}
                serverUrl={import.meta.env.VITE_LIVEKIT_URL || "wss://mock-server.livekit.cloud"}
                // Use the explicit connect=true to start immediately
                connect={true}
                className="flex-1 flex flex-col"
            >
                <ActiveClassroom />
                <RoomAudioRenderer />
                <StartAudio label="Click to allow audio playback" />
            </LiveKitRoom>
        </div>
    );
}

// Custom classroom container using LiveKit hooks
const SESSION_SECONDS = 15 * 60;

function ActiveClassroom() {
    const { state: agentState, audioTrack: agentAudio } = useVoiceAssistant();
    const [secondsLeft, setSecondsLeft] = useState(SESSION_SECONDS);

    useEffect(() => {
        const interval = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
        return () => clearInterval(interval);
    }, []);

    const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const seconds = String(secondsLeft % 60).padStart(2, '0');
    const timerUrgent = secondsLeft <= 120;

    const isAgentSpeaking = agentState === 'speaking';
    const isAgentListening = agentState === 'listening';

    return (
        <div className="flex-1 flex flex-col items-center justify-center px-4 relative z-0">

            {/* Countdown Timer */}
            <div className={`absolute top-16 right-6 px-4 py-2 rounded-full text-sm font-mono font-bold border backdrop-blur-md ${
                timerUrgent
                    ? 'bg-red-500/20 border-red-500/40 text-red-400'
                    : 'bg-white/5 border-white/10 text-slate-300'
            }`}>
                {minutes}:{seconds}
            </div>

            {/* Main Agent Visualization */}
            <div className="relative mb-8 flex flex-col items-center">
                <div className={`w-48 h-48 rounded-full border border-white/10 bg-gradient-to-br transition-colors duration-1000 flex items-center justify-center relative shadow-2xl ${
                    isAgentSpeaking ? 'from-indigo-500/40 to-purple-500/10 shadow-indigo-500/20' :
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

            {/* Control Bar */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-900/80 backdrop-blur-xl border border-white/10 p-3 rounded-full shadow-2xl">
                <TrackToggle source={Track.Source.Microphone} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 transition data-[state=off]:bg-red-500/80" />
                <TrackToggle source={Track.Source.Camera} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 transition data-[state=on]:bg-indigo-500" />
            </div>
        </div>
    );
}
