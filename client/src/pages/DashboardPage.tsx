import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  Dumbbell, Flame, TrendingDown, TrendingUp, Minus,
  Loader2, Apple, Scale, BarChart3, Moon,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine, Legend,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────────

interface WeightDataPoint  { date: string; rawWeight: number; emaWeight: number }
interface CalorieDataPoint { date: string; calories: number; target: number }
interface MacroBreakdown   { protein: number; carbs: number; fat: number }

interface DashboardSummary {
  todayWorkouts: number;
  lastNightSleepMinutes: number | null;
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
  currentWeightEma: number | null;
  charts: {
    weightTrend:    WeightDataPoint[];
    dailyCalories:  CalorieDataPoint[];
    macroBreakdown: MacroBreakdown;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORS = {
  accent:  '#6366f1',
  orange:  '#f97316',
  amber:   '#f59e0b',
  purple:  '#a855f7',
  pink:    '#ec4899',
  blue:    '#3b82f6',
  emerald: '#10b981',
  rose:    '#f43f5e',
  text:    'rgba(255,255,255,0.6)',
  grid:    'rgba(255,255,255,0.06)',
};
const MACRO_COLORS = ['#a855f7', '#f97316', '#f59e0b'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass border border-border rounded-lg p-2.5 text-xs shadow-xl">
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
        </p>
      ))}
    </div>
  );
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSleepDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── GraphQL fetch ─────────────────────────────────────────────────────────────

async function fetchDashboard(rangeDays: number): Promise<DashboardSummary> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `
        query GetDashboardSummary($rangeDays: Int) {
          getDashboardSummary(rangeDays: $rangeDays) {
            todayWorkouts
            lastNightSleepMinutes
            macros { calories proteinG carbsG fatG }
            currentWeightEma
            charts {
              weightTrend { date rawWeight emaWeight }
              dailyCalories { date calories target }
              macroBreakdown { protein carbs fat }
            }
          }
        }
      `,
      variables: { rangeDays },
    }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data.getDashboardSummary;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData]         = useState<DashboardSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetchDashboard(rangeDays)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [rangeDays]);

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

  const calorieTarget = user?.goals?.calorie_target  ?? 2500;
  const proteinTarget = user?.goals?.protein_target  ?? 150;

  const caloriePct = Math.min(100, Math.round((data.macros.calories / calorieTarget) * 100));
  const proteinPct = Math.min(100, Math.round((data.macros.proteinG / proteinTarget) * 100));

  const weightTrend = data.charts.weightTrend;
  const weightDelta = weightTrend.length >= 2
    ? weightTrend[weightTrend.length - 1].emaWeight - weightTrend[0].emaWeight
    : 0;

  const macroPieData = [
    { name: 'Protein', value: data.charts.macroBreakdown.protein, unit: 'g' },
    { name: 'Carbs',   value: data.charts.macroBreakdown.carbs,   unit: 'g' },
    { name: 'Fat',     value: data.charts.macroBreakdown.fat,     unit: 'g' },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex flex-col gap-5 pb-24 pt-2">
      {/* Greeting + range selector */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hey, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-text-muted text-sm mt-1">Here's your daily snapshot.</p>
        </div>
        <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRangeDays(d)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                rangeDays === d ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Row 1: Workouts + Sleep + Weight */}
      <div className="grid grid-cols-3 gap-3">
        {/* Workouts today */}
        <button
          onClick={() => navigate('/workout')}
          className="glass p-4 rounded-2xl border border-border text-left hover:border-accent/50 transition-colors"
        >
          <div className="bg-accent/10 p-2 rounded-lg w-fit mb-2">
            <Dumbbell className="w-4 h-4 text-accent" />
          </div>
          <p className="text-2xl font-bold">{data.todayWorkouts}</p>
          <p className="text-text-muted text-[11px] mt-0.5">Workouts</p>
        </button>

        {/* Sleep last night */}
        <button
          onClick={() => navigate('/sleep')}
          className="glass p-4 rounded-2xl border border-border text-left hover:border-indigo-500/50 transition-colors"
        >
          <div className="bg-indigo-500/10 p-2 rounded-lg w-fit mb-2">
            <Moon className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-2xl font-bold leading-none">
            {data.lastNightSleepMinutes
              ? formatSleepDuration(data.lastNightSleepMinutes)
              : '—'}
          </p>
          <p className="text-text-muted text-[11px] mt-0.5">Sleep</p>
        </button>

        {/* Weight EMA */}
        <button
          onClick={() => navigate('/body')}
          className="glass p-4 rounded-2xl border border-border text-left hover:border-purple-500/50 transition-colors"
        >
          <div className="bg-purple-500/10 p-2 rounded-lg w-fit mb-2">
            <Scale className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-2xl font-bold">
            {data.currentWeightEma ?? '—'}
          </p>
          <p className="text-text-muted text-[11px] mt-0.5 flex items-center gap-1">
            {data.currentWeightEma && (
              weightDelta < -0.2 ? <TrendingDown className="w-3 h-3 text-emerald-400" />
              : weightDelta > 0.2 ? <TrendingUp className="w-3 h-3 text-rose-400" />
              : <Minus className="w-3 h-3" />
            )}
            EMA (kg)
          </p>
        </button>
      </div>

      {/* Nutrition card */}
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

        {/* Calories */}
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-orange-400" /> Calories
            </span>
            <span className="text-text-muted">{data.macros.calories} / {calorieTarget} kcal</span>
          </div>
          <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full" style={{ width: `${caloriePct}%` }} />
          </div>
        </div>

        {/* Protein */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span>Protein</span>
            <span className="text-text-muted">{Math.round(data.macros.proteinG)}g / {proteinTarget}g</span>
          </div>
          <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-purple-500 to-pink-400 rounded-full" style={{ width: `${proteinPct}%` }} />
          </div>
        </div>

        <div className="flex gap-3 mt-3 text-xs text-text-muted">
          <span>Carbs: {Math.round(data.macros.carbsG)}g</span>
          <span>Fat: {Math.round(data.macros.fatG)}g</span>
        </div>
      </button>

      {/* Weight trend chart */}
      {weightTrend.length > 1 && (
        <div className="glass p-5 rounded-2xl border border-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-purple-500/10 p-2 rounded-lg">
              <Scale className="w-5 h-5 text-purple-400" />
            </div>
            <span className="font-semibold">Weight Trend</span>
            <span className="text-text-muted text-xs ml-auto">
              {weightDelta > 0 ? '+' : ''}{weightDelta.toFixed(1)} kg
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={weightTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="date" tickFormatter={formatDateShort} tick={{ fill: COLORS.text, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: COLORS.text, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="rawWeight" stroke="rgba(168,85,247,0.3)" strokeWidth={1} dot={{ r: 2, fill: 'rgba(168,85,247,0.4)' }} name="Raw" />
              <Line type="monotone" dataKey="emaWeight" stroke={COLORS.purple} strokeWidth={2.5} dot={false} name="7-Day EMA" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily calories chart */}
      {data.charts.dailyCalories.length > 0 && (
        <div className="glass p-5 rounded-2xl border border-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-orange-500/10 p-2 rounded-lg">
              <Flame className="w-5 h-5 text-orange-400" />
            </div>
            <span className="font-semibold">Daily Calories</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.charts.dailyCalories}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="date" tickFormatter={formatDateShort} tick={{ fill: COLORS.text, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: COLORS.text, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={calorieTarget} stroke={COLORS.rose} strokeDasharray="4 4" strokeWidth={1.5} label={{ value: 'Target', fill: COLORS.rose, fontSize: 10, position: 'right' }} />
              <Bar dataKey="calories" fill={COLORS.orange} radius={[4, 4, 0, 0]} name="Calories" opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Macro donut */}
      {macroPieData.length > 0 && (
        <div className="glass p-5 rounded-2xl border border-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-accent/10 p-2 rounded-lg">
              <BarChart3 className="w-5 h-5 text-accent" />
            </div>
            <span className="font-semibold">Today's Macros</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={macroPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value" strokeWidth={0}>
                {macroPieData.map((_e, i) => <Cell key={i} fill={MACRO_COLORS[i % MACRO_COLORS.length]} />)}
              </Pie>
              <Tooltip
                content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="glass border border-border rounded-lg p-2 text-xs shadow-xl">
                      <p className="font-medium">{d.name}: {Math.round(d.value)}{d.unit}</p>
                    </div>
                  );
                }}
              />
              <Legend verticalAlign="bottom" height={36} formatter={(value: string, entry: any) => (
                <span style={{ color: COLORS.text, fontSize: 11 }}>{value}: {Math.round(entry.payload.value)}g</span>
              )} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Quick actions */}
      <div className="glass p-4 rounded-2xl border border-border">
        <p className="text-text-muted text-xs font-medium mb-3 uppercase tracking-wider">Quick Actions</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: <Dumbbell className="w-5 h-5 text-accent" />,       label: 'Activity', path: '/workout'   },
            { icon: <Apple className="w-5 h-5 text-orange-400" />,      label: 'Log Food', path: '/nutrition' },
            { icon: <Moon className="w-5 h-5 text-indigo-400" />,       label: 'Sleep',    path: '/sleep'     },
          ].map(({ icon, label, path }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
            >
              {icon}
              <span className="text-xs">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
