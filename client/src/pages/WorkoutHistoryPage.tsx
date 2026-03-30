// client/src/pages/WorkoutHistoryPage.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Clock } from 'lucide-react';
import { getWorkoutsHistory } from '../services/workout';

export function WorkoutHistoryPage() {
    const navigate = useNavigate();
    const [workouts, setWorkouts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchHistory() {
            try {
                const data = await getWorkoutsHistory();
                setWorkouts(data);
            } catch (error) {
                console.error("Failed to fetch workout history", error);
            } finally {
                setLoading(false);
            }
        }
        fetchHistory();
    }, []);

    return (
        <div className="min-h-screen bg-bg-primary flex flex-col pb-24 h-full -mx-4 sm:mx-0">
            {/* Header */}
            <header className="h-14 px-4 flex items-center gap-3 glass border-b border-border sticky top-0 z-40">
                <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-full hover:bg-bg-card-hover flex items-center justify-center">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="font-bold text-lg">Workout History</h1>
            </header>

            <div className="p-4 flex-1">
                <div className="space-y-4">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-accent" />
                        </div>
                    ) : workouts.length === 0 ? (
                        <div className="text-center py-8 text-text-muted glass rounded-xl border border-border">
                            <p>No workouts recorded yet.</p>
                        </div>
                    ) : (
                        workouts.map((workout) => {
                            const date = new Date(workout.startedAt).toLocaleDateString(undefined, {
                                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                            });
                            const exerciseNames = [...new Set(workout.sets.map((s: any) => s.exercise.name))];
                            
                            return (
                                <div
                                    key={workout.id}
                                    className="p-4 glass rounded-xl border border-border hover:border-accent transition-colors"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="font-bold text-text-primary capitalize">{workout.name}</h3>
                                        <span className="text-xs text-text-muted">{date}</span>
                                    </div>
                                    <div className="flex w-full items-center justify-between">
                                        <div className="text-sm text-text-secondary line-clamp-1 flex-1 pr-2">
                                            {exerciseNames.join(', ')}
                                        </div>
                                        <div className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-accent bg-accent/10 px-2 py-1 rounded-md">
                                            <Clock className="w-3 h-3" />
                                            <span>{workout.durationMin}m</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
