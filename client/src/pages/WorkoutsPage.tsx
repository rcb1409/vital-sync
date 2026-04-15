// client/src/pages/WorkoutsPage.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Dumbbell, History, ChevronRight, Sparkles } from 'lucide-react';
import { getWorkoutTemplates } from '../services/workout';

interface WorkoutTemplate {
    id: string;
    name: string;
    exercises: {
        exercise_id: number;
        sets: number;
        reps: number;
        rest_seconds: number;
    }[];
}

export function WorkoutsPage() {
    const navigate = useNavigate();
    const [starting, setStarting] = useState(false);
    const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
    const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);

    useEffect(() => {
        getWorkoutTemplates()
            .then(setTemplates)
            .catch(console.error)
            .finally(() => setIsLoadingTemplates(false));
    }, []);

    const handleStartWorkout = () => {
        setStarting(true);
        navigate('/workouts/active/new');
    };

    return (
        <div className="flex flex-col h-full -mx-4 sm:mx-0 pb-20">
            {/* HEADER & QUICK START */}
            <div className="px-4 mb-6 pt-2">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold">Workouts</h1>
                    <button
                        onClick={() => navigate('/workouts/history')}
                        className="text-accent text-sm font-semibold flex items-center gap-1.5 hover:bg-accent/10 px-3 py-1.5 rounded-lg transition-smooth border border-accent/20 bg-accent/5"
                    >
                        <History className="w-4 h-4" />
                        History
                    </button>
                </div>

                <button
                    onClick={handleStartWorkout}
                    disabled={starting}
                    className="w-full bg-accent text-white font-bold text-lg py-4 rounded-xl shadow-lg hover:shadow-accent/25 transition-smooth flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {starting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
                    Start Empty Workout
                </button>
            </div>

            {/* MY TEMPLATES */}
            <div className="px-4 mb-8">
                <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-lg font-semibold">My Templates</h2>
                    <span className="flex items-center gap-1 text-xs font-semibold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full">
                        <Sparkles className="w-3 h-3" />
                        AI Created
                    </span>
                </div>

                {isLoadingTemplates ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-6 h-6 animate-spin text-accent" />
                    </div>
                ) : templates.length === 0 ? (
                    <div className="glass p-6 rounded-xl border border-border flex flex-col items-center justify-center text-center gap-3">
                        <Dumbbell className="w-8 h-8 text-text-muted" />
                        <p className="text-text-secondary text-sm">No templates yet.</p>
                        <p className="text-text-muted text-xs max-w-[220px]">
                            Ask your AI Coach to create a custom workout template for you!
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {templates.map((template) => {
                            const exerciseCount = template.exercises?.length ?? 0;
                            const totalSets = template.exercises?.reduce((acc, ex) => acc + ex.sets, 0) ?? 0;

                            return (
                                <button
                                    key={template.id}
                                    onClick={() => navigate(`/workouts/templates/${template.id}`)}
                                    className="w-full glass rounded-xl border border-border hover:border-accent/50 transition-all duration-200 p-4 flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="bg-accent/10 p-2.5 rounded-xl">
                                            <Dumbbell className="w-5 h-5 text-accent" />
                                        </div>
                                        <div className="text-left">
                                            <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors">
                                                {template.name}
                                            </h3>
                                            <p className="text-xs text-text-muted mt-0.5">
                                                {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''} · {totalSets} sets
                                            </p>
                                        </div>
                                    </div>
                                    <ChevronRight className="w-5 h-5 text-text-muted group-hover:text-accent transition-colors flex-shrink-0" />
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
