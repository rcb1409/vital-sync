// client/src/pages/ActiveWorkoutPage.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Plus, Search, X, Loader2, Play } from 'lucide-react';
import { logCompletedWorkout } from '../services/workout';
import { searchExercises, type Exercise } from '../services/exercise';

// --- Types for Local Draft State ---
interface DraftSet {
    id: string; // React key
    reps: string;
    weightKg: string;
    completed: boolean;
}

interface DraftExercise {
    id: string; // React key
    exerciseId: number;
    exerciseName: string;
    sets: DraftSet[];
}

interface DraftWorkout {
    name: string;
    startedAt: string;
    exercises: DraftExercise[];
}

export function ActiveWorkoutPage() {
    const navigate = useNavigate();

    // 1. Core Workout State
    const [workout, setWorkout] = useState<DraftWorkout>(() => {
        const saved = localStorage.getItem('draft_workout');
        if (saved) return JSON.parse(saved);
        return { name: 'Workout', startedAt: new Date().toISOString(), exercises: [] };
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [elapsedTime, setElapsedTime] = useState('00:00');

    // 2. Modal State for Adding Exercises
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [catalog, setCatalog] = useState<Exercise[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMuscle, setSelectedMuscle] = useState<string>('');

    // --- Persist to Local Storage ---
    useEffect(() => {
        localStorage.setItem('draft_workout', JSON.stringify(workout));
    }, [workout]);

    // --- Timer Logic ---
    useEffect(() => {
        const start = new Date(workout.startedAt).getTime();
        const interval = setInterval(() => {
            const now = new Date().getTime();
            const diffSec = Math.floor((now - start) / 1000);
            const mins = Math.floor(diffSec / 60).toString().padStart(2, '0');
            const secs = (diffSec % 60).toString().padStart(2, '0');
            setElapsedTime(`${mins}:${secs}`);
        }, 1000);
        return () => clearInterval(interval);
    }, [workout.startedAt]);

    // --- Fetch Catalog for Modal ---
    useEffect(() => {
        if (isModalOpen && catalog.length === 0) {
            searchExercises("").then(setCatalog);
        }
    }, [isModalOpen, catalog.length]);

    // Predefined muscle groups from the database schema
    const muscleGroups = ['back', 'biceps', 'cardio', 'chest', 'core', 'legs', 'shoulders', 'triceps'];

    const filteredCatalog = catalog.filter(ex => {
        const matchesSearch = ex.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesMuscle = selectedMuscle ? ex.muscleGroup === selectedMuscle : true;
        return matchesSearch && matchesMuscle;
    });

    // --- Actions ---
    const addExerciseToWorkout = (exercise: Exercise) => {
        setWorkout(prev => ({
            ...prev,
            exercises: [
                ...prev.exercises,
                {
                    id: crypto.randomUUID(),
                    exerciseId: exercise.id,
                    exerciseName: exercise.name,
                    sets: [{ id: crypto.randomUUID(), reps: '', weightKg: '', completed: false }]
                }
            ]
        }));
        setSearchQuery('');
        setSelectedMuscle('');
        setIsModalOpen(false);
    };

    const addSet = (exerciseId: string) => {
        setWorkout(prev => ({
            ...prev,
            exercises: prev.exercises.map(ex =>
                ex.id === exerciseId
                    ? { ...ex, sets: [...ex.sets, { id: crypto.randomUUID(), reps: '', weightKg: '', completed: false }] }
                    : ex
            )
        }));
    };

    const updateSet = (exerciseId: string, setId: string, field: keyof DraftSet, value: string | boolean) => {
        setWorkout(prev => ({
            ...prev,
            exercises: prev.exercises.map(ex =>
                ex.id === exerciseId
                    ? { ...ex, sets: ex.sets.map(s => s.id === setId ? { ...s, [field]: value } : s) }
                    : ex
            )
        }));
    };

    const finishWorkout = async () => {
        const allCompletedSets: any[] = [];

        // Flatten sets for payload
        workout.exercises.forEach(ex => {
            const completed = ex.sets.filter(s => s.completed);
            completed.forEach((s, index) => {
                allCompletedSets.push({
                    exerciseId: ex.exerciseId,
                    setNumber: index + 1,
                    reps: parseInt(s.reps, 10) || 0,
                    weightKg: parseFloat(s.weightKg) || 0,
                });
            });
        });

        if (allCompletedSets.length === 0) {
            alert('You must complete at least one set to finish a workout.');
            return;
        }

        try {
            setIsSubmitting(true);
            const ms = new Date().getTime() - new Date(workout.startedAt).getTime();
            const durationMin = Math.max(1, Math.round(ms / 60000));

            await logCompletedWorkout({
                name: workout.name,
                startedAt: workout.startedAt,
                durationMin,
                sets: allCompletedSets
            });

            localStorage.removeItem('draft_workout');
            navigate('/workouts');

        } catch (error) {
            console.error('Failed to submit workout', error);
            alert('Failed to save to database. Check network.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg-primary flex flex-col pb-24">
            {/* Header */}
            <header className="h-16 px-4 flex items-center justify-between glass border-b border-border sticky top-0 z-40">
                <div className="flex items-center gap-2 flex-1">
                    <button onClick={() => navigate('/workouts')} className="w-8 h-8 rounded-full hover:bg-bg-card-hover flex items-center justify-center">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="flex flex-col flex-1 pl-1">
                        <input
                            type="text"
                            value={workout.name}
                            onChange={(e) => setWorkout(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Workout Name"
                            className="bg-transparent font-bold text-lg focus:outline-none w-full text-text-primary"
                        />
                        <div className="flex items-center gap-1 text-xs text-accent font-medium mt-0.5">
                            <Play className="w-3 h-3 fill-accent" />
                            {elapsedTime}
                        </div>
                    </div>
                </div>
                <button
                    onClick={finishWorkout}
                    disabled={isSubmitting}
                    className="text-white font-semibold px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 transition-smooth flex items-center gap-2"
                >
                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Finish
                </button>
            </header>

            {/* Workflow Area */}
            <div className="p-4 space-y-6 flex-1">
                {workout.exercises.length === 0 ? (
                    <div className="text-center py-12 text-text-muted">
                        <p>No exercises added yet.</p>
                        <p className="text-sm">Click below to start logging sets.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {workout.exercises.map(group => (
                            <div key={group.id} className="glass rounded-xl border border-border overflow-hidden">
                                <div className="px-4 py-3 border-b border-border bg-bg-card flex justify-between items-center">
                                    <h3 className="font-bold text-text-primary text-[15px] text-accent">
                                        {group.exerciseName}
                                    </h3>
                                </div>
                                <div className="p-2 space-y-2">
                                    {/* Column Headers */}
                                    <div className="flex text-xs font-semibold text-text-muted uppercase tracking-wider px-2">
                                        <div className="w-10 text-center">Set</div>
                                        <div className="flex-1 text-center">kg</div>
                                        <div className="flex-1 text-center">Reps</div>
                                        <div className="w-12 text-center">Done</div>
                                    </div>

                                    {/* Set Rows */}
                                    {group.sets.map((set, setIdx) => (
                                        <div key={set.id} className={`flex items-center gap-2 p-1.5 rounded-lg transition-colors ${set.completed ? 'bg-green-500/10' : ''}`}>
                                            <div className="w-10 text-center text-sm font-medium text-text-secondary">
                                                {setIdx + 1}
                                            </div>
                                            <div className="flex-1">
                                                <input
                                                    type="number"
                                                    value={set.weightKg}
                                                    onChange={(e) => updateSet(group.id, set.id, 'weightKg', e.target.value)}
                                                    disabled={set.completed}
                                                    className="w-full bg-bg-input rounded-md px-2 py-2 text-center text-sm font-medium text-text-primary disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-accent"
                                                    placeholder="-"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <input
                                                    type="number"
                                                    value={set.reps}
                                                    onChange={(e) => updateSet(group.id, set.id, 'reps', e.target.value)}
                                                    disabled={set.completed}
                                                    className="w-full bg-bg-input rounded-md px-2 py-2 text-center text-sm font-medium text-text-primary disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-accent"
                                                    placeholder="-"
                                                />
                                            </div>
                                            <div className="w-12 flex justify-center">
                                                <button
                                                    onClick={() => updateSet(group.id, set.id, 'completed', !set.completed)}
                                                    className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${set.completed ? 'bg-green-500 text-white' : 'bg-bg-card-hover text-text-muted hover:bg-bg-input'}`}
                                                >
                                                    <Check className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => addSet(group.id)}
                                        className="w-full mt-2 py-2 text-sm font-semibold text-accent flex items-center justify-center gap-1 hover:bg-accent/10 rounded-lg transition-smooth"
                                    >
                                        <Plus className="w-4 h-4" /> Add Set
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <button
                    onClick={() => setIsModalOpen(true)}
                    className="w-full py-4 rounded-xl border-2 border-dashed border-accent/50 text-accent font-bold flex items-center justify-center gap-2 hover:border-accent hover:bg-accent/5 transition-smooth mt-6"
                >
                    <Plus className="w-5 h-5" /> Add Exercise
                </button>
            </div>

            {/* FULL SCREEN EXERCISE SEARCH MODAL */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-bg-primary z-50 flex flex-col animate-in slide-in-from-bottom">
                    <header className="h-14 px-4 flex items-center gap-3 border-b border-border bg-bg-card">
                        <button onClick={() => setIsModalOpen(false)} className="p-2 -ml-2 text-text-muted">
                            <X className="w-6 h-6" />
                        </button>
                        <h2 className="font-bold text-lg">Select Exercise</h2>
                    </header>
                    <div className="p-4 space-y-3 shadow-sm z-10">
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search exercises..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-bg-input border border-border rounded-xl pl-12 pr-4 py-3 text-text-primary focus:outline-none focus:border-accent transition-colors"
                            />
                        </div>
                        {/* Muscle Group Dropdown Filter */}
                        <div className="pt-2">
                            <select
                                value={selectedMuscle}
                                onChange={(e) => setSelectedMuscle(e.target.value)}
                                className="w-full bg-bg-input border border-border rounded-xl px-4 py-3 text-sm font-medium text-text-primary focus:outline-none focus:border-accent transition-colors capitalize cursor-pointer"
                            >
                                <option value="">All Muscle Groups</option>
                                {muscleGroups.map(mg => (
                                    <option key={mg} value={mg} className="capitalize">{mg}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-2 pt-2">
                        {filteredCatalog.map(exercise => (
                            <button
                                key={exercise.id}
                                onClick={() => addExerciseToWorkout(exercise)}
                                className="w-full flex items-center justify-between p-4 glass rounded-xl border border-border hover:border-accent group transition-colors"
                            >
                                <div className="text-left">
                                    <h3 className="font-semibold group-hover:text-accent transition-colors">{exercise.name}</h3>
                                    <p className="text-xs text-text-muted uppercase tracking-wider mt-1">{exercise.muscleGroup}</p>
                                </div>
                                <Plus className="w-5 h-5 text-text-muted group-hover:text-accent transition-colors" />
                            </button>
                        ))}
                        {filteredCatalog.length === 0 && (
                            <p className="text-center text-text-muted mt-8">No exercises found.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
