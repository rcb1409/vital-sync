// client/src/pages/MetricsPage.tsx
import { useState, useEffect } from 'react';
import { Scale, Moon, Droplets, Wine, Trophy, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
    logWeight, getWeightHistory,
    logHabits, getHabitsHistory, getStreaks,
    type WeightLog, type DailyHabitsLog, type StreaksSummary
} from '../services/metrics';

// Utility to format dates as YYYY-MM-DD
const formatDate = (date: Date) => date.toISOString().split('T')[0];

export function MetricsPage() {
    const { user } = useAuth();
    // --- State ---
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState('');
    const todayStr = formatDate(new Date());

    // Data
    const [weightRange, setWeightRange] = useState<'7d' | '30d' | '90d'>('30d');
    const [weightHistory, setWeightHistory] = useState<WeightLog[]>([]);
    const [habitsHistory, setHabitsHistory] = useState<DailyHabitsLog[]>([]);
    const [streaks, setStreaks] = useState<StreaksSummary>({ alcoholFree: 0, hydration: 0 });

    // Forms
    const [weightInput, setWeightInput] = useState('');
    const [habitInput, setHabitInput] = useState({
        sleepHours: '8', sleepQuality: '3', waterMl: '2000', alcohol: false
    });

    // --- Fetch Data ---
    const fetchWeightOnly = async () => {
        const weights = await getWeightHistory(weightRange);
        setWeightHistory(weights);
        const todayWeight = weights.find(w => w.date.split('T')[0] === todayStr);
        if (todayWeight) setWeightInput(todayWeight.rawWeight.toString());
    };

    const fetchHabitsOnly = async () => {
        const [habits, streaksData] = await Promise.all([
            getHabitsHistory('30d'),
            getStreaks()
        ]);
        setHabitsHistory(habits);
        setStreaks(streaksData);
        
        const todayHabits = habits.find(h => h.date.split('T')[0] === todayStr);
        if (todayHabits) setHabitInput({
            sleepHours: todayHabits.sleepHours.toString(),
            sleepQuality: todayHabits.sleepQuality.toString(),
            waterMl: todayHabits.waterMl.toString(),
            alcohol: todayHabits.alcohol
        });
    };

    const fetchAll = async () => {
        setLoading(true);
        try {
            await Promise.all([fetchWeightOnly(), fetchHabitsOnly()]);
        } catch (error) {
            console.error("Failed to load metrics", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAll(); }, []);

    // Refetch weight only when range changes
    useEffect(() => {
        if (!loading) fetchWeightOnly();
    }, [weightRange]);

    // --- Actions ---
    const handleLogWeight = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting('weight');
            await logWeight({ weightKg: parseFloat(weightInput), date: todayStr });
            await fetchWeightOnly();
        } catch (err) { alert("Failed to log weight"); }
        finally { setSubmitting(''); }
    };

    const handleLogHabits = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting('habits');
            await logHabits({
                sleepHours: parseFloat(habitInput.sleepHours),
                sleepQuality: parseInt(habitInput.sleepQuality),
                waterMl: parseInt(habitInput.waterMl),
                alcohol: habitInput.alcohol,
                date: todayStr
            });
            await fetchHabitsOnly();
        } catch (err) { alert("Failed to log habits"); }
        finally { setSubmitting(''); }
    };

    const handleAddWater = async (amount: number) => {
        try {
            setSubmitting('water');
            const newTotal = (parseInt(habitInput.waterMl) || 0) + amount;
            setHabitInput(prev => ({ ...prev, waterMl: newTotal.toString() }));
            await logHabits({
                sleepHours: parseFloat(habitInput.sleepHours),
                sleepQuality: parseInt(habitInput.sleepQuality),
                waterMl: newTotal,
                alcohol: habitInput.alcohol,
                date: todayStr
            });
            await fetchHabitsOnly();
        } catch (err) { alert("Failed to add water"); }
        finally { setSubmitting(''); }
    };

    if (loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;
    }

    const currentEma = weightHistory.length > 0 ? weightHistory[weightHistory.length - 1].emaWeight : '--';

    return (
        <div className="flex flex-col h-full space-y-6 pb-20">
            <h1 className="text-3xl font-bold pt-2">Body & Habits</h1>

            {/* STREAKS DASHBOARD */}
            <div className="grid grid-cols-2 gap-4">
                <div className="glass p-4 rounded-xl border border-border flex items-center gap-4">
                    <div className="bg-blue-500/20 p-3 rounded-full"><Droplets className="w-6 h-6 text-blue-500" /></div>
                    <div>
                        <p className="text-sm text-text-muted font-medium">Hydration</p>
                        <p className="text-xl font-bold">{streaks.hydration} <span className="text-sm font-normal">days</span></p>
                    </div>
                </div>
                <div className="glass p-4 rounded-xl border border-border flex items-center gap-4">
                    <div className="bg-green-500/20 p-3 rounded-full"><Trophy className="w-6 h-6 text-green-500" /></div>
                    <div>
                        <p className="text-sm text-text-muted font-medium">Alcohol-Free</p>
                        <p className="text-xl font-bold">{streaks.alcoholFree} <span className="text-sm font-normal">days</span></p>
                    </div>
                </div>
            </div>

            {/* WEIGHT TRACKER */}
            <div className="glass p-5 rounded-xl border border-border">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold flex items-center gap-2"><Scale className="w-5 h-5 text-accent" /> Weight Trend</h2>
                    <div className="flex bg-bg-input rounded-lg p-1">
                        {['7d', '30d', '90d'].map((range) => (
                            <button 
                                key={range} 
                                onClick={() => setWeightRange(range as any)}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${weightRange === range ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-white'}`}
                            >
                                {range.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {weightHistory.length > 1 ? (
                    <div className="h-48 w-full mt-2 mb-6">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={weightHistory.map(w => ({ ...w, shortDate: w.date.split('T')[0].slice(5) }))}>
                                <XAxis dataKey="shortDate" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis domain={['dataMin - 1', 'dataMax + 1']} hide />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} 
                                    labelStyle={{ color: '#a1a1aa' }}
                                />
                                <Line type="monotone" dataKey="rawWeight" stroke="#52525b" strokeWidth={1} dot={{ r: 2, fill: '#52525b' }} name="Raw Weight" />
                                <Line type="monotone" dataKey="emaWeight" stroke="#ff3b30" strokeWidth={3} dot={false} name="7-Day EMA" />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-48 w-full mt-2 mb-6 flex flex-col items-center justify-center border border-dashed border-border rounded-xl">
                        <p className="text-text-muted text-sm font-medium">Log more weight to see your trend</p>
                    </div>
                )}
                
                <form onSubmit={handleLogWeight} className="flex gap-3 mt-4">
                    <input
                        type="number" step="0.1" required
                        value={weightInput} onChange={e => setWeightInput(e.target.value)}
                        className="flex-1 bg-bg-input rounded-xl px-4 py-3 focus:ring-1 focus:ring-accent outline-none"
                        placeholder="Today's Weight (kg)"
                    />
                    <button type="submit" disabled={!!submitting} className="bg-accent text-white px-6 font-bold rounded-xl active:scale-95 transition-transform flex items-center justify-center min-w-[100px]">
                        {submitting === 'weight' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Log'}
                    </button>
                </form>
            </div>

            {/* HABITS TRACKER */}
            <div className="glass p-5 rounded-xl border border-border">
                <h2 className="text-lg font-bold flex items-center gap-2 mb-4">Daily Habits</h2>

                <form onSubmit={handleLogHabits} className="space-y-4">
                    {/* Sleep */}
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className="text-xs text-text-muted font-medium ml-1 flex items-center gap-1 mb-1"><Moon className="w-3 h-3" /> Sleep Hours</label>
                            <input type="number" step="0.5" required value={habitInput.sleepHours} onChange={e => setHabitInput({ ...habitInput, sleepHours: e.target.value })} className="w-full bg-bg-input rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-purple-400" />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs text-text-muted font-medium ml-1 mb-1 block">Quality (1-5)</label>
                            <select value={habitInput.sleepQuality} onChange={e => setHabitInput({ ...habitInput, sleepQuality: e.target.value })} className="w-full bg-bg-input rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-purple-400 appearance-none">
                                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} Stars</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Water */}
                    <div className="bg-bg-input p-4 rounded-xl space-y-3 border border-border/50">
                        <div className="flex justify-between items-end mb-1">
                            <div>
                                <span className="text-xs font-medium text-text-muted flex items-center gap-1 uppercase tracking-wider"><Droplets className="w-3.5 h-3.5 text-blue-400" /> Water Intake</span>
                                <div className="text-2xl font-black mt-1">
                                    {habitInput.waterMl} <span className="text-sm font-normal text-text-muted">/ {user?.goals?.waterMl || 3000} ml</span>
                                </div>
                            </div>
                        </div>
                        <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 transition-all duration-500 ease-out"
                                style={{ width: `${Math.min(100, (parseInt(habitInput.waterMl) || 0) / (user?.goals?.waterMl || 3000) * 100)}%` }}
                            />
                        </div>
                        
                        <div className="flex gap-2 pt-2">
                            <button type="button" disabled={!!submitting} onClick={() => handleAddWater(250)} className="flex-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 py-2.5 rounded-lg text-sm font-bold transition-all flex justify-center items-center">
                                {submitting === 'water' ? <Loader2 className="w-4 h-4 animate-spin" /> : '+250ml'}
                            </button>
                            <button type="button" disabled={!!submitting} onClick={() => handleAddWater(500)} className="flex-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 py-2.5 rounded-lg text-sm font-bold transition-all flex justify-center items-center">
                                {submitting === 'water' ? <Loader2 className="w-4 h-4 animate-spin" /> : '+500ml'}
                            </button>
                        </div>
                    </div>

                    {/* Alcohol */}
                    <div className="flex items-center justify-between bg-bg-input p-4 rounded-xl mt-2">
                        <div className="flex items-center gap-2">
                            <Wine className={`w-5 h-5 ${habitInput.alcohol ? 'text-red-400' : 'text-text-muted'}`} />
                            <span className="font-medium">Drank Alcohol Today?</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={habitInput.alcohol} onChange={e => setHabitInput({ ...habitInput, alcohol: e.target.checked })} className="sr-only peer" />
                            <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                        </label>
                    </div>

                    <button type="submit" disabled={!!submitting} className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/20 font-bold py-3 rounded-xl transition-all flex justify-center items-center mt-2">
                        {submitting === 'habits' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Habits'}
                    </button>
                </form>
            </div>
        </div>
    );
}
