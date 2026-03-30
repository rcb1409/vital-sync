// client/src/pages/WorkoutsPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Dumbbell, History } from 'lucide-react';

export function WorkoutsPage() {
    const navigate = useNavigate();
    const [starting, setStarting] = useState(false);

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

            {/* MY TEMPLATES (Placeholder) */}
            <div className="px-4 mb-8">
                <h2 className="text-lg font-semibold mb-3">My Templates</h2>
                <div className="glass p-6 rounded-xl border border-border flex flex-col items-center justify-center text-center">
                    <Dumbbell className="w-8 h-8 text-text-muted mb-2" />
                    <p className="text-text-secondary text-sm">You haven't saved any routine templates yet.</p>
                </div>
            </div>
        </div>
    );
}
