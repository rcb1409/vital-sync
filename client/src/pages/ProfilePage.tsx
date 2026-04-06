import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { LogOut, Save, Flame, Droplets, Moon, Beef } from 'lucide-react';

export function ProfilePage() {
    const { user, updateUser, logout } = useAuth();
    const [isLoading, setIsLoading] = useState(false);

    // We initialize the local state using the deeply-injected global user goals
    const [goals, setGoals] = useState({
        weightKg: user?.goals?.weightKg || 75,
        calories: user?.goals?.calories || 2500,
        proteinG: user?.goals?.proteinG || 150,
        waterMl: user?.goals?.waterMl || 3000,
        sleepHours: user?.goals?.sleepHours || 8,
    });

    const safeAiMemory = Array.isArray(user?.aiMemory) 
        ? user.aiMemory.map(m => typeof m === 'string' ? { category: 'General', fact: m, expiresAt: null } : m)
        : [];
    const [aiMemory, setAiMemory] = useState<{category?: string, fact: string, expiresAt?: string | null}[]>(safeAiMemory);

    const formatDate = (isoString?: string | null) => {
        if (!isoString) return null;
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    const handleSaveGoals = async () => {
        setIsLoading(true);
        try {
            // ONLY send goals. Never send aiMemory here, or it will wipe the database!
            const res = await api.patch('/users/profile', { goals });
            updateUser(res.data.user);
            alert("✅ Goals securely updated!");
        } catch (error: any) {
            alert("❌ Failed to save goals. Check your inputs.");
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveMemory = async (newMemory: any[]) => {
        setAiMemory(newMemory);
        try {
            const res = await api.patch('/users/profile', { aiMemory: newMemory });
            updateUser(res.data.user);
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4">

            <div className="glass border border-border p-5 rounded-3xl flex flex-col items-center gap-2">
                <div className="bg-accent/20 w-16 h-16 rounded-full flex items-center justify-center text-accent text-2xl font-bold">
                    {user?.name?.charAt(0).toUpperCase()}
                </div>
                <h1 className="font-bold text-xl">{user?.name}</h1>
                <p className="text-sm text-text-muted">{user?.email}</p>
            </div>

            {/* App Preferences */}
            <div className="glass border border-border p-5 rounded-3xl">
                <h2 className="font-bold text-lg mb-4 tracking-tight">App Preferences</h2>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Theme</span>
                        <div className="flex gap-2 border border-border p-1 rounded-xl bg-black/20">
                            <button className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-bold shadow-md">Dark</button>
                            <button className="px-4 py-1.5 rounded-lg text-text-muted hover:text-white text-xs font-bold transition-colors">Light</button>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Units</span>
                        <div className="flex gap-2 border border-border p-1 rounded-xl bg-black/20">
                            <button className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-bold shadow-md">Metric (kg/ml)</button>
                            <button className="px-4 py-1.5 rounded-lg text-text-muted hover:text-white text-xs font-bold transition-colors">Imperial (lbs/oz)</button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="glass border border-border p-5 rounded-3xl">
                <h2 className="font-bold text-lg mb-6 tracking-tight">Your Daily Targets</h2>

                <div className="flex flex-col gap-5">
                    {/* Weight Goal */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                                <span className="text-purple-400">⚖️</span> Weight Target
                            </span>
                            <span className="text-sm font-bold">{goals.weightKg} kg</span>
                        </div>
                        <input
                            type="range" min="40" max="150" step="1"
                            value={goals.weightKg}
                            onChange={(e) => setGoals({ ...goals, weightKg: Number(e.target.value) })}
                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-400"
                        />
                    </div>

                    {/* Calories */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                                <Flame className="w-4 h-4 text-orange-400" /> Calories
                            </span>
                            <span className="text-sm font-bold">{goals.calories} kcal</span>
                        </div>
                        <input
                            type="range" min="1200" max="4000" step="50"
                            value={goals.calories}
                            onChange={(e) => setGoals({ ...goals, calories: Number(e.target.value) })}
                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-400"
                        />
                    </div>

                    {/* Protein */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                                <Beef className="w-4 h-4 text-rose-400" /> Protein Target
                            </span>
                            <span className="text-sm font-bold">{goals.proteinG} g</span>
                        </div>
                        <input
                            type="range" min="50" max="300" step="5"
                            value={goals.proteinG}
                            onChange={(e) => setGoals({ ...goals, proteinG: Number(e.target.value) })}
                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-rose-400"
                        />
                    </div>

                    {/* Water */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                                <Droplets className="w-4 h-4 text-blue-400" /> Water Intake
                            </span>
                            <span className="text-sm font-bold">{goals.waterMl} ml</span>
                        </div>
                        <input
                            type="range" min="1000" max="6000" step="250"
                            value={goals.waterMl}
                            onChange={(e) => setGoals({ ...goals, waterMl: Number(e.target.value) })}
                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-400"
                        />
                    </div>

                    {/* Sleep */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                                <Moon className="w-4 h-4 text-indigo-400" /> Sleep Goal
                            </span>
                            <span className="text-sm font-bold">{goals.sleepHours} hrs</span>
                        </div>
                        <input
                            type="range" min="4" max="12" step="0.5"
                            value={goals.sleepHours}
                            onChange={(e) => setGoals({ ...goals, sleepHours: Number(e.target.value) })}
                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                        />
                    </div>
                </div>

                {/* AI Knowledge Base */}
                <h2 className="font-bold text-lg mt-8 mb-6 tracking-tight flex items-center gap-2">
                    <span className="text-blue-400">🧠</span> AI Knowledge Base
                </h2>
                <div className="flex flex-col gap-3">
                    {aiMemory.length === 0 ? (
                        <p className="text-text-muted text-sm italic">The Coach hasn't learned any persistent facts about you yet. Chat with it to build memory!</p>
                    ) : aiMemory.map((item, index) => (
                        <div key={index} className="glass p-3 rounded-xl border border-border flex items-start gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">{item.category || 'General'}</span>
                                    {item.expiresAt && (
                                        <span className="text-[10px] uppercase font-bold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full">
                                            Expires: {formatDate(item.expiresAt)}
                                        </span>
                                    )}
                                </div>
                                <input
                                    type="text"
                                    value={item.fact}
                                    onChange={(e) => {
                                        const newMemory = [...aiMemory];
                                        newMemory[index].fact = e.target.value;
                                        setAiMemory(newMemory);
                                    }}
                                    onBlur={() => handleSaveMemory(aiMemory)}
                                    className="w-full bg-transparent border-none text-sm focus:outline-none mt-1"
                                />
                            </div>
                            <button
                                onClick={() => handleSaveMemory(aiMemory.filter((_, i) => i !== index))}
                                className="text-text-muted hover:text-red-400 p-1 transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>

                <div className="mt-8">
                    <button
                        onClick={handleSaveGoals}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/80 text-white font-bold py-3.5 rounded-2xl transition-all disabled:opacity-50"
                    >
                        <Save className="w-5 h-5" />
                        {isLoading ? 'Saving...' : 'Save Targets'}
                    </button>
                </div>
            </div>

            {/* Logout Button moved here safely */}
            <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 py-4 rounded-3xl font-bold transition-smooth"
            >
                <LogOut className="w-5 h-5" />
                Sign Out
            </button>
        </div>
    );
}
