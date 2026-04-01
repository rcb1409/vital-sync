import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  Dumbbell,
  Flame,
  Droplets,
  Wine,
  TrendingDown,
  Loader2,
  Activity,
  Apple,
  Scale,
} from 'lucide-react';

// -------------------------------------------------------
// Types matching exactly what our GraphQL schema returns
// -------------------------------------------------------
interface DashboardSummary {
  todayWorkouts: number;
  macros: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  streaks: {
    hydration: number;
    alcoholFree: number;
  };
  currentWeightEma: number | null;
}

// -------------------------------------------------------
// GraphQL fetch helper
// Uses our JWT token from localStorage, just like Axios
// -------------------------------------------------------
async function fetchDashboard(): Promise<DashboardSummary> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `
        query GetDashboardSummary {
          getDashboardSummary {
            todayWorkouts
            macros { calories proteinG carbsG fatG }
            streaks { hydration alcoholFree }
            currentWeightEma
          }
        }
      `,
    }),
  });

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data.getDashboardSummary;
}

// -------------------------------------------------------
// The Dashboard Component
// -------------------------------------------------------
export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400 mb-2">Failed to load dashboard</p>
        <p className="text-text-muted text-sm">{error}</p>
      </div>
    );
  }

  const calorieTarget = user?.goals.calorie_target || 2000;
  const proteinTarget = user?.goals.protein_target || 150;
  const caloriePct = Math.min(100, Math.round((data.macros.calories / calorieTarget) * 100));
  const proteinPct = Math.min(100, Math.round((data.macros.proteinG / proteinTarget) * 100));

  return (
    <div className="flex flex-col gap-5 pb-24 pt-2">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">
          Hey, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-text-muted text-sm mt-1">Here's your daily snapshot.</p>
      </div>

      {/* ---- Row 1: Workouts + Weight ---- */}
      <div className="grid grid-cols-2 gap-4">
        {/* Workouts Today */}
        <button
          onClick={() => navigate('/workouts')}
          className="glass p-5 rounded-2xl border border-border text-left hover:border-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-accent/10 p-2 rounded-lg">
              <Dumbbell className="w-5 h-5 text-accent" />
            </div>
          </div>
          <p className="text-3xl font-bold">{data.todayWorkouts}</p>
          <p className="text-text-muted text-xs mt-1">Workouts Today</p>
        </button>

        {/* Current Weight EMA */}
        <button
          onClick={() => navigate('/metrics')}
          className="glass p-5 rounded-2xl border border-border text-left hover:border-purple-500/50 transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-purple-500/10 p-2 rounded-lg">
              <Scale className="w-5 h-5 text-purple-400" />
            </div>
          </div>
          <p className="text-3xl font-bold">
            {data.currentWeightEma ? `${data.currentWeightEma}` : '—'}
          </p>
          <p className="text-text-muted text-xs mt-1">
            {data.currentWeightEma ? (
              <>
                <TrendingDown className="w-3 h-3 inline mr-1" />
                7-day EMA (kg)
              </>
            ) : (
              'No weight data'
            )}
          </p>
        </button>
      </div>

      {/* ---- Row 2: Nutrition Card ---- */}
      <button
        onClick={() => navigate('/nutrition')}
        className="glass p-5 rounded-2xl border border-border text-left hover:border-orange-500/50 transition-colors"
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="bg-orange-500/10 p-2 rounded-lg">
            <Apple className="w-5 h-5 text-orange-400" />
          </div>
          <span className="font-semibold">Today's Nutrition</span>
        </div>

        {/* Calories Bar */}
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-orange-400" /> Calories
            </span>
            <span className="text-text-muted">
              {data.macros.calories} / {calorieTarget} kcal
            </span>
          </div>
          <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-700"
              style={{ width: `${caloriePct}%` }}
            />
          </div>
        </div>

        {/* Protein Bar */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span>Protein</span>
            <span className="text-text-muted">
              {Math.round(data.macros.proteinG)}g / {proteinTarget}g
            </span>
          </div>
          <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-700"
              style={{ width: `${proteinPct}%` }}
            />
          </div>
        </div>

        {/* Macro Pills */}
        <div className="flex gap-3 mt-3 text-xs text-text-muted">
          <span>Carbs: {Math.round(data.macros.carbsG)}g</span>
          <span>Fat: {Math.round(data.macros.fatG)}g</span>
        </div>
      </button>

      {/* ---- Row 3: Streaks ---- */}
      <div className="grid grid-cols-2 gap-4">
        {/* Hydration Streak */}
        <div className="glass p-5 rounded-2xl border border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-sky-500/10 p-2 rounded-lg">
              <Droplets className="w-5 h-5 text-sky-400" />
            </div>
          </div>
          <p className="text-3xl font-bold">{data.streaks.hydration}</p>
          <p className="text-text-muted text-xs mt-1">Day Hydration Streak</p>
        </div>

        {/* Alcohol-Free Streak */}
        <div className="glass p-5 rounded-2xl border border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-emerald-500/10 p-2 rounded-lg">
              <Wine className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <p className="text-3xl font-bold">{data.streaks.alcoholFree}</p>
          <p className="text-text-muted text-xs mt-1">Day Alcohol-Free</p>
        </div>
      </div>

      {/* ---- Row 4: Quick Actions ---- */}
      <div className="glass p-4 rounded-2xl border border-border">
        <p className="text-text-muted text-xs font-medium mb-3 uppercase tracking-wider">Quick Actions</p>
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => navigate('/workouts/active/new')}
            className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-accent/10 transition-colors"
          >
            <Dumbbell className="w-5 h-5 text-accent" />
            <span className="text-xs">Workout</span>
          </button>
          <button
            onClick={() => navigate('/nutrition')}
            className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-orange-500/10 transition-colors"
          >
            <Apple className="w-5 h-5 text-orange-400" />
            <span className="text-xs">Log Food</span>
          </button>
          <button
            onClick={() => navigate('/runs')}
            className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-[#fc4c02]/10 transition-colors"
          >
            <Activity className="w-5 h-5 text-[#fc4c02]" />
            <span className="text-xs">Runs</span>
          </button>
        </div>
      </div>
    </div>
  );
}
