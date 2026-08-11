// client/src/pages/NutritionPage.tsx
import { useState, useEffect, useRef } from 'react';
import {
  Plus, ChevronLeft, ChevronRight, Utensils, Flame, Wheat,
  Loader2, Trash2, X, Camera, Check, Droplet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getNutritionForDate, logFood, deleteFoodLog, type DayNutritionSummary, type MealType } from '../services/nutrition';
import { api } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FoodItem {
  foodName: string;
  calories: number;
  proteinG: number;
  carbsG:   number;
  fatG:     number;
}

type ModalStep = 'input' | 'reviewing';

// ── Helpers ────────────────────────────────────────────────────────────────────

const formatDate = (date: Date) => date.toISOString().split('T')[0];

// ── Components ─────────────────────────────────────────────────────────────────

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
        style={{ width: `${Math.min(100, (actual / target) * 100)}%` }}
      />
    </div>
  </div>
);

// ── Main Page ──────────────────────────────────────────────────────────────────

export function NutritionPage() {
  const { user } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [summary, setSummary]         = useState<DayNutritionSummary | null>(null);
  const [loading, setLoading]         = useState(true);

  // Modal state
  const [isModalOpen, setIsModalOpen]         = useState(false);
  const [selectedMeal, setSelectedMeal]       = useState<MealType>('breakfast');
  const [modalStep, setModalStep]             = useState<ModalStep>('input');
  const [isSubmitting, setIsSubmitting]       = useState(false);
  const [photoAnalyzing, setPhotoAnalyzing]   = useState(false);
  const [photoItems, setPhotoItems]           = useState<FoodItem[]>([]);
  const [selectedItems, setSelectedItems]     = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual form
  const [form, setForm] = useState({
    foodName: '', calories: '', proteinG: '', carbsG: '', fatG: '',
  });

  const goals = (user?.goals as any) || {};
  const calGoal     = goals.calorie_target  ?? goals.calories  ?? 2000;
  const proteinGoal = goals.protein_target  ?? goals.proteinG  ?? 150;
  const carbsGoal   = 250;
  const fatGoal     = 70;

  // ── Data loading ─────────────────────────────────────────────────────────────

  const fetchDay = async (dateObj: Date) => {
    setLoading(true);
    try {
      setSummary(await getNutritionForDate(formatDate(dateObj)));
    } catch (err) {
      console.error('Failed to load nutrition', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDay(currentDate); }, [currentDate]);

  const prevDay = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); };
  const nextDay = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); };
  const isToday = formatDate(currentDate) === formatDate(new Date());

  // ── Modal helpers ─────────────────────────────────────────────────────────────

  const openModal = (meal: MealType) => {
    setSelectedMeal(meal);
    setModalStep('input');
    setForm({ foodName: '', calories: '', proteinG: '', carbsG: '', fatG: '' });
    setPhotoItems([]);
    setSelectedItems(new Set());
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setPhotoAnalyzing(false);
  };

  // ── Manual log ────────────────────────────────────────────────────────────────

  const handleManualLog = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await logFood({
        foodName: form.foodName,
        calories: parseInt(form.calories, 10),
        proteinG: parseFloat(form.proteinG) || 0,
        carbsG:   parseFloat(form.carbsG)   || 0,
        fatG:     parseFloat(form.fatG)     || 0,
        mealType: selectedMeal,
        date: formatDate(currentDate),
      });
      closeModal();
      fetchDay(currentDate);
    } catch {
      alert('Failed to log food');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Photo analysis ────────────────────────────────────────────────────────────

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setPhotoAnalyzing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const mimeType = file.type as any;
      const { data } = await api.post('/nutrition/analyze-photo', { imageBase64: base64, mimeType });

      if (!data.items?.length) {
        alert('No food detected in the photo. Try a clearer image.');
        return;
      }
      setPhotoItems(data.items);
      setSelectedItems(new Set(data.items.map((_: any, i: number) => i)));
      setModalStep('reviewing');
    } catch {
      alert('Photo analysis failed. Please try again or enter manually.');
    } finally {
      setPhotoAnalyzing(false);
    }
  };

  // ── Log selected photo items ───────────────────────────────────────────────

  const handleLogPhotoItems = async () => {
    const toLog = photoItems.filter((_, i) => selectedItems.has(i));
    if (!toLog.length) return;
    try {
      setIsSubmitting(true);
      await Promise.all(
        toLog.map((item) =>
          logFood({
            foodName: item.foodName,
            calories: item.calories,
            proteinG: item.proteinG,
            carbsG:   item.carbsG,
            fatG:     item.fatG,
            mealType: selectedMeal,
            date: formatDate(currentDate),
          })
        )
      );
      closeModal();
      fetchDay(currentDate);
    } catch {
      alert('Failed to log items');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this food entry?')) return;
    await deleteFoodLog(id);
    fetchDay(currentDate);
  };

  // ── Meal grouping ─────────────────────────────────────────────────────────────

  const logsByMeal: Record<MealType, NonNullable<typeof summary>['logs']> = {
    breakfast: summary?.logs.filter((l) => l.mealType === 'breakfast') ?? [],
    lunch:     summary?.logs.filter((l) => l.mealType === 'lunch')     ?? [],
    dinner:    summary?.logs.filter((l) => l.mealType === 'dinner')    ?? [],
    snack:     summary?.logs.filter((l) => l.mealType === 'snack')     ?? [],
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full -mx-4 sm:mx-0 pb-20">
      {/* Header */}
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
          {/* Macro summary */}
          <div className="space-y-3">
            <div className="glass p-4 rounded-xl border border-border">
              <div className="flex justify-between items-end mb-2">
                <div>
                  <span className="text-sm font-medium text-text-muted uppercase tracking-wider">Calories</span>
                  <div className="text-3xl font-black">
                    {summary?.totals.calories || 0}
                    <span className="text-lg font-normal text-text-muted"> / {calGoal}</span>
                  </div>
                </div>
                <div className="text-sm font-bold text-accent">
                  {Math.max(0, calGoal - (summary?.totals.calories || 0))} remaining
                </div>
              </div>
              <div className="h-2.5 w-full bg-bg-input rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${Math.min(100, ((summary?.totals.calories || 0) / calGoal) * 100)}%` }}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <MacroBar icon={Droplet} label="Protein" actual={summary?.totals.proteinG || 0} target={proteinGoal} colorClass="text-blue-500" bgClass="bg-blue-500" />
              <MacroBar icon={Wheat}   label="Carbs"   actual={summary?.totals.carbsG   || 0} target={carbsGoal}   colorClass="text-green-500" bgClass="bg-green-500" />
              <MacroBar icon={Flame}   label="Fat"     actual={summary?.totals.fatG     || 0} target={fatGoal}     colorClass="text-orange-500" bgClass="bg-orange-500" />
            </div>
          </div>

          {/* Meal sections */}
          {(['breakfast', 'lunch', 'dinner', 'snack'] as MealType[]).map((meal) => (
            <div key={meal} className="glass rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border/50 flex justify-between items-center bg-bg-card/50">
                <h3 className="font-bold capitalize flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-text-muted" /> {meal}
                </h3>
                <button
                  onClick={() => openModal(meal)}
                  className="text-accent hover:bg-accent/10 p-1.5 rounded-lg transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="p-2">
                {logsByMeal[meal].length === 0 ? (
                  <p className="p-3 text-sm text-text-muted text-center italic">No items logged</p>
                ) : (
                  logsByMeal[meal].map((log) => (
                    <div key={log.id} className="group flex justify-between items-center p-3 hover:bg-bg-input/50 rounded-lg transition-colors">
                      <div>
                        <p className="font-medium text-sm leading-tight">{log.foodName}</p>
                        <p className="text-xs text-text-muted mt-0.5">{log.proteinG}g P • {log.carbsG}g C • {log.fatG}g F</p>
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

      {/* ── ADD FOOD MODAL ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-bg-card w-full max-w-sm rounded-2xl border border-border shadow-2xl animate-in slide-in-from-bottom-4">

            {/* Modal header */}
            <header className="flex justify-between items-center p-4 border-b border-border">
              <h2 className="font-bold text-lg capitalize">Add to {selectedMeal}</h2>
              <div className="flex items-center gap-2">
                {/* Camera / Scan button */}
                {modalStep === 'input' && (
                  <button
                    type="button"
                    disabled={photoAnalyzing}
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs font-semibold text-accent bg-accent/10 border border-accent/20 px-3 py-1.5 rounded-lg hover:bg-accent/20 transition-all disabled:opacity-50"
                  >
                    {photoAnalyzing
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Camera className="w-3.5 h-3.5" />}
                    {photoAnalyzing ? 'Analysing…' : 'Scan Photo'}
                  </button>
                )}
                <button onClick={closeModal} className="p-2 text-text-muted hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            {/* Hidden file input */}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoSelect}
            />

            {/* ── STEP 1: Manual form ── */}
            {modalStep === 'input' && (
              <form onSubmit={handleManualLog} className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-text-muted mb-1 block">Food Name</label>
                  <input
                    required type="text" value={form.foodName}
                    onChange={(e) => setForm({ ...form, foodName: e.target.value })}
                    className="w-full bg-bg-input rounded-xl px-4 py-3 text-white placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. Oatmeal with Berries"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-accent mb-1 block">Calories (kcal)</label>
                  <input
                    required type="number" min="0" value={form.calories}
                    onChange={(e) => setForm({ ...form, calories: e.target.value })}
                    className="w-full bg-bg-input rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="0"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { key: 'proteinG', label: 'Protein (g)', ring: 'focus:ring-blue-400', color: 'text-blue-400' },
                    { key: 'carbsG',   label: 'Carbs (g)',   ring: 'focus:ring-green-400', color: 'text-green-400' },
                    { key: 'fatG',     label: 'Fat (g)',     ring: 'focus:ring-orange-400', color: 'text-orange-400' },
                  ] as const).map(({ key, label, ring, color }) => (
                    <div key={key}>
                      <label className={`text-xs font-medium ${color} mb-1 block`}>{label}</label>
                      <input
                        type="number" step="0.1" min="0"
                        value={(form as any)[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        className={`w-full bg-bg-input rounded-xl px-3 py-2 text-white text-center focus:outline-none focus:ring-1 ${ring}`}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
                <button
                  disabled={isSubmitting}
                  type="submit"
                  className="w-full mt-4 bg-accent text-white font-bold py-4 rounded-xl hover:shadow-[0_0_20px_rgba(255,59,48,0.3)] transition-all flex justify-center items-center gap-2"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Log Food'}
                </button>
              </form>
            )}

            {/* ── STEP 2: Review photo items ── */}
            {modalStep === 'reviewing' && (
              <div className="p-4 space-y-3">
                <p className="text-sm text-text-muted mb-1">
                  AI detected {photoItems.length} item{photoItems.length !== 1 ? 's' : ''}. Select what to log:
                </p>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {photoItems.map((item, i) => {
                    const selected = selectedItems.has(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          const next = new Set(selectedItems);
                          selected ? next.delete(i) : next.add(i);
                          setSelectedItems(next);
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                          selected
                            ? 'border-accent/60 bg-accent/10'
                            : 'border-border bg-white/3 opacity-60'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-accent bg-accent' : 'border-border'}`}>
                          {selected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.foodName}</p>
                          <p className="text-xs text-text-muted">{item.calories} kcal • {item.proteinG}g P • {item.carbsG}g C • {item.fatG}g F</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalStep('input')}
                    className="flex-1 py-3 rounded-xl border border-border text-sm font-medium text-text-muted hover:bg-white/5 transition-colors"
                  >
                    Manual Instead
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting || selectedItems.size === 0}
                    onClick={handleLogPhotoItems}
                    className="flex-1 py-3 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-50 transition-all flex justify-center items-center gap-2"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : `Log ${selectedItems.size} item${selectedItems.size !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
