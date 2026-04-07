// client/src/pages/NutritionPage.tsx
import { useState, useEffect } from 'react';
import { Plus, ChevronLeft, ChevronRight, Utensils, Droplet, Flame, Wheat, Loader2, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getNutritionForDate, logFood, deleteFoodLog, type DayNutritionSummary, type MealType } from '../services/nutrition';

// Utility to format dates as YYYY-MM-DD
const formatDate = (date: Date) => date.toISOString().split('T')[0];

export function NutritionPage() {
    const { user } = useAuth();

    // Core State
    const [currentDate, setCurrentDate] = useState(new Date());
    const [summary, setSummary] = useState<DayNutritionSummary | null>(null);
    const [loading, setLoading] = useState(true);

    // Modal State
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [selectedMealType, setSelectedMealType] = useState<MealType>('breakfast');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        foodName: '', calories: '', proteinG: '', carbsG: '', fatG: ''
    });

    // Fetch daily data whenever the date changes
    const fetchDayData = async (dateObj: Date) => {
        try {
            setLoading(true);
            const data = await getNutritionForDate(formatDate(dateObj));
            setSummary(data);
        } catch (error) {
            console.error("Failed to load nutrition", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDayData(currentDate);
    }, [currentDate]);

    // Navigation
    const prevDay = () => {
        const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d);
    };
    const nextDay = () => {
        const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d);
    };
    const isToday = formatDate(currentDate) === formatDate(new Date());

    // UI Helpers for Progress Bars
    const getProgress = (actual: number, target: number) => {
        if (!target) return 0;
        return Math.min(100, (actual / target) * 100);
    };
    const goals = (user?.goals as any) || { calories: 2000, proteinG: 150, carbsG: 250, fatG: 70 }; // Fallbacks

    // Form Actions
    const handleLogFood = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsSubmitting(true);
            await logFood({
                foodName: formData.foodName,
                calories: parseInt(formData.calories, 10),
                proteinG: parseFloat(formData.proteinG) || 0,
                carbsG: parseFloat(formData.carbsG) || 0,
                fatG: parseFloat(formData.fatG) || 0,
                mealType: selectedMealType,
                date: formatDate(currentDate)
            });
            // Reset form and modal
            setFormData({ foodName: '', calories: '', proteinG: '', carbsG: '', fatG: '' });
            setIsAddModalOpen(false);
            // Refresh the screen data
            await fetchDayData(currentDate);
        } catch (err) {
            console.error(err);
            alert("Failed to log food");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Remove this food entry?")) return;
        await deleteFoodLog(id);
        fetchDayData(currentDate);
    };

    // Group logs by meal type for display
    const logsByMeal = {
        breakfast: summary?.logs.filter(l => l.mealType === 'breakfast') || [],
        lunch: summary?.logs.filter(l => l.mealType === 'lunch') || [],
        dinner: summary?.logs.filter(l => l.mealType === 'dinner') || [],
        snack: summary?.logs.filter(l => l.mealType === 'snack') || [],
    };

    const MacroBar = ({ icon: Icon, label, actual, target, colorClass, bgClass }: any) => (
        <div className="flex-1 glass p-3 rounded-xl border border-border">
            <div className="flex items-center gap-1.5 mb-1 text-text-muted">
                <Icon className={`w-4 h-4 ${colorClass}`} />
                <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
            </div>
            <p className="font-bold text-lg leading-tight mb-2">
                {Math.round(actual)}<span className="text-sm text-text-muted font-normal"> / {target}g</span>
            </p>
            <div className="h-1.5 w-full bg-bg-input rounded-full overflow-hidden">
                <div
                    className={`h-full ${bgClass}`}
                    style={{ width: `${getProgress(actual, target)}%` }}
                />
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-full -mx-4 sm:mx-0 pb-20">
            {/* Header / Date Scrubber */}
            <div className="px-4 mb-6 pt-2 select-none">
                <h1 className="text-3xl font-bold mb-4">Nutrition</h1>
                <div className="flex items-center justify-between glass py-2 px-4 rounded-xl border border-border">
                    <button onClick={prevDay} className="p-2 hover:bg-bg-input rounded-lg transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="text-center font-bold">
                        {isToday ? 'Today' : currentDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <button onClick={nextDay} disabled={isToday} className="p-2 hover:bg-bg-input rounded-lg disabled:opacity-30 transition-colors">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-accent" />
                </div>
            ) : (
                <div className="px-4 space-y-6">
                    {/* MACRO SUMMARY DASHBOARD */}
                    <div className="space-y-3">
                        {/* Calories Master Bar */}
                        <div className="glass p-4 rounded-xl border border-border">
                            <div className="flex justify-between items-end mb-2">
                                <div>
                                    <span className="text-sm font-medium text-text-muted uppercase tracking-wider">Calories</span>
                                    <div className="text-3xl font-black">
                                        {summary?.totals.calories || 0}
                                        <span className="text-lg font-normal text-text-muted"> / {goals.calories}</span>
                                    </div>
                                </div>
                                <div className="text-sm font-bold text-accent">
                                    {Math.max(0, goals.calories - (summary?.totals.calories || 0))} remaining
                                </div>
                            </div>
                            <div className="h-2.5 w-full bg-bg-input rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-accent transition-all duration-500 ease-out"
                                    style={{ width: `${getProgress(summary?.totals.calories || 0, goals.calories)}%` }}
                                />
                            </div>
                        </div>

                        {/* Macro Triplets */}
                        <div className="flex gap-3">
                            <MacroBar icon={Droplet} label="Protein" actual={summary?.totals.proteinG || 0} target={goals.proteinG} colorClass="text-blue-500" bgClass="bg-blue-500" />
                            <MacroBar icon={Wheat} label="Carbs" actual={summary?.totals.carbsG || 0} target={goals.carbsG || 250} colorClass="text-green-500" bgClass="bg-green-500" />
                            <MacroBar icon={Flame} label="Fat" actual={summary?.totals.fatG || 0} target={goals.fatG || 70} colorClass="text-orange-500" bgClass="bg-orange-500" />
                        </div>
                    </div>

                    {/* MEAL SECTIONS */}
                    {(['breakfast', 'lunch', 'dinner', 'snack'] as MealType[]).map((mealType) => (
                        <div key={mealType} className="glass rounded-xl border border-border overflow-hidden">
                            <div className="p-4 border-b border-border/50 flex justify-between items-center bg-bg-card/50">
                                <h3 className="font-bold capitalize flex items-center gap-2">
                                    <Utensils className="w-4 h-4 text-text-muted" />
                                    {mealType}
                                </h3>
                                <button
                                    onClick={() => { setSelectedMealType(mealType); setIsAddModalOpen(true); }}
                                    className="text-accent hover:bg-accent/10 p-1.5 rounded-lg transition-colors"
                                >
                                    <Plus className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-2">
                                {logsByMeal[mealType].length === 0 ? (
                                    <p className="p-3 text-sm text-text-muted text-center italic">No items logged</p>
                                ) : (
                                    logsByMeal[mealType].map(log => (
                                        <div key={log.id} className="group flex justify-between items-center p-3 hover:bg-bg-input/50 rounded-lg transition-colors">
                                            <div>
                                                <p className="font-medium text-sm leading-tight">{log.foodName}</p>
                                                <p className="text-xs text-text-muted mt-0.5">
                                                    {log.proteinG}g P • {log.carbsG}g C • {log.fatG}g F
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold">{log.calories} <span className="text-xs font-normal text-text-muted">kcal</span></span>
                                                <button onClick={() => handleDelete(log.id)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ADD FOOD MODAL */}
            {isAddModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-bg-card w-full max-w-sm rounded-2xl border border-border shadow-2xl animate-in slide-in-from-bottom-4">
                        <header className="flex justify-between items-center p-4 border-b border-border">
                            <h2 className="font-bold text-lg capitalize">Add to {selectedMealType}</h2>
                            <button onClick={() => setIsAddModalOpen(false)} className="p-2 text-text-muted hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </header>
                        <form onSubmit={handleLogFood} className="p-4 space-y-4">
                            <div>
                                <label className="text-xs font-medium text-text-muted mb-1 block">Food Name</label>
                                <input required type="text" value={formData.foodName} onChange={e => setFormData({ ...formData, foodName: e.target.value })} className="w-full bg-bg-input rounded-xl px-4 py-3 text-white placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent" placeholder="e.g. Oatmeal with Berries" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-accent mb-1 block">Calories (kcal)</label>
                                <input required type="number" min="0" value={formData.calories} onChange={e => setFormData({ ...formData, calories: e.target.value })} className="w-full bg-bg-input rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-accent" placeholder="0" />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-blue-400 mb-1 block">Protein (g)</label>
                                    <input type="number" step="0.1" min="0" value={formData.proteinG} onChange={e => setFormData({ ...formData, proteinG: e.target.value })} className="w-full bg-bg-input rounded-xl px-3 py-2 text-white text-center focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="0" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-green-400 mb-1 block">Carbs (g)</label>
                                    <input type="number" step="0.1" min="0" value={formData.carbsG} onChange={e => setFormData({ ...formData, carbsG: e.target.value })} className="w-full bg-bg-input rounded-xl px-3 py-2 text-white text-center focus:outline-none focus:ring-1 focus:ring-green-400" placeholder="0" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-orange-400 mb-1 block">Fat (g)</label>
                                    <input type="number" step="0.1" min="0" value={formData.fatG} onChange={e => setFormData({ ...formData, fatG: e.target.value })} className="w-full bg-bg-input rounded-xl px-3 py-2 text-white text-center focus:outline-none focus:ring-1 focus:ring-orange-400" placeholder="0" />
                                </div>
                            </div>
                            <button disabled={isSubmitting} type="submit" className="w-full mt-4 bg-accent text-white font-bold py-4 rounded-xl hover:shadow-[0_0_20px_rgba(255,59,48,0.3)] transition-all flex justify-center items-center gap-2">
                                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Log Food"}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
