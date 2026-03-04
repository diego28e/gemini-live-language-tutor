import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn, auth } from '../firebase';
import { BookOpen, Globe2, Loader2, Play, Sparkles } from 'lucide-react';

interface Lesson {
    id: string;
    title: string;
    cefr_level: string;
    language: string;
}

export default function Dashboard() {
    const [lessons, setLessons] = useState<Lesson[]>([]);
    const [loading, setLoading] = useState(true);
    const [startingLesson, setStartingLesson] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        // Fetch lessons
        const fetchLessons = async () => {
            try {
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
                const res = await fetch(`${apiUrl}/api/lessons`);
                if (res.ok) {
                    const data = await res.json();
                    setLessons(data);
                }
            } catch (err) {
                console.error("Failed to fetch lessons:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchLessons();
    }, []);

    const handleStartLesson = async (lessonId: string) => {
        setStartingLesson(lessonId);
        try {
            if (!auth.currentUser) {
                await signIn();
            }
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

                                    <div className="mt-auto pt-8">
                                        <button
                                            onClick={() => handleStartLesson(lesson.id)}
                                            disabled={startingLesson === lesson.id}
                                            className="w-full relative flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium bg-white text-slate-900 hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed group/btn"
                                        >
                                            {startingLesson === lesson.id ? (
                                                <>
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                    <span className="relative z-10">Preparing...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Play className="w-4 h-4 fill-slate-900" />
                                                    <span className="relative z-10">Start Practice</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
