// BodyPage — weight tracking (Google Health replaces manual habits)
import { useState, useEffect } from 'react';
import { Scale, TrendingDown, TrendingUp, Minus, Loader2 } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { logWeight, getWeightHistory, type WeightLog } from '../services/metrics';

const formatDate = (date: Date) => date.toISOString().split('T')[0];
const COLORS = {
  grid: 'rgba(255,255,255,0.06)',
  text: 'rgba(255,255,255,0.4)',
};

export function BodyPage() {
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [weightRange, setWeightRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [history, setHistory]       = useState<WeightLog[]>([]);
  const [weightInput, setWeightInput] = useState('');
  const todayStr = formatDate(new Date());

  const fetchWeights = async () => {
    const data = await getWeightHistory(weightRange);
    setHistory(data);
    const todayEntry = data.find((w) => w.date.split('T')[0] === todayStr);
    if (todayEntry) setWeightInput(todayEntry.rawWeight.toString());
  };

  useEffect(() => {
    setLoading(true);
    fetchWeights().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading) fetchWeights();
  }, [weightRange]);

  const handleLogWeight = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await logWeight({ weightKg: parseFloat(weightInput), date: todayStr });
      await fetchWeights();
    } catch {
      alert('Failed to log weight');
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate trend direction
  const latest = history[history.length - 1];
  const delta = history.length >= 2
    ? history[history.length - 1].emaWeight - history[0].emaWeight
    : 0;

  const chartData = history.map((w) => ({
    ...w,
    shortDate: w.date.split('T')[0].slice(5),
  }));

  // Goal line — use ema of oldest entries as rough baseline for context
  const avgEma = history.length > 0
    ? history.reduce((s, w) => s + w.emaWeight, 0) / history.length
    : null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-24 pt-2">
      <h1 className="text-2xl font-bold">Body</h1>

      {/* Current weight card */}
      {latest && (
        <div className="glass p-5 rounded-2xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-muted text-xs font-medium uppercase tracking-wider mb-1">Current Weight (7-day EMA)</p>
              <div className="flex items-end gap-2">
                <p className="text-4xl font-black">{latest.emaWeight.toFixed(1)}</p>
                <p className="text-lg text-text-muted mb-1">kg</p>
              </div>
            </div>
            <div className={`flex items-center gap-1 text-sm font-semibold px-3 py-2 rounded-xl ${
              delta < -0.2 ? 'text-emerald-400 bg-emerald-500/10'
              : delta > 0.2 ? 'text-rose-400 bg-rose-500/10'
              : 'text-text-muted bg-white/5'
            }`}>
              {delta < -0.2 ? <TrendingDown className="w-4 h-4" />
               : delta > 0.2 ? <TrendingUp className="w-4 h-4" />
               : <Minus className="w-4 h-4" />}
              {delta > 0 ? '+' : ''}{delta.toFixed(1)} kg
            </div>
          </div>
        </div>
      )}

      {/* Log weight form */}
      <div className="glass p-5 rounded-2xl border border-border">
        <h2 className="text-base font-bold flex items-center gap-2 mb-4">
          <Scale className="w-5 h-5 text-accent" /> Log Today's Weight
        </h2>
        <form onSubmit={handleLogWeight} className="flex gap-3">
          <input
            type="number"
            step="0.1"
            required
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            className="flex-1 bg-bg-input rounded-xl px-4 py-3 focus:ring-1 focus:ring-accent outline-none"
            placeholder="Weight in kg"
          />
          <button
            type="submit"
            disabled={submitting}
            className="bg-accent text-white px-6 font-bold rounded-xl active:scale-95 transition-transform flex items-center justify-center min-w-[80px]"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Log'}
          </button>
        </form>
      </div>

      {/* Weight trend chart */}
      <div className="glass p-5 rounded-2xl border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Scale className="w-5 h-5 text-purple-400" /> Weight Trend
          </h2>
          <div className="flex bg-white/5 rounded-lg p-0.5">
            {(['7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setWeightRange(r)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  weightRange === r ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis
                dataKey="shortDate"
                tick={{ fill: COLORS.text, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={['dataMin - 1', 'dataMax + 1']}
                tick={{ fill: COLORS.text, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', fontSize: 12 }}
              />
              {avgEma && (
                <ReferenceLine
                  y={parseFloat(avgEma.toFixed(1))}
                  stroke="rgba(99,102,241,0.4)"
                  strokeDasharray="4 4"
                />
              )}
              <Line
                type="monotone"
                dataKey="rawWeight"
                stroke="rgba(168,85,247,0.35)"
                strokeWidth={1}
                dot={{ r: 2, fill: 'rgba(168,85,247,0.4)' }}
                name="Raw"
              />
              <Line
                type="monotone"
                dataKey="emaWeight"
                stroke="#a855f7"
                strokeWidth={2.5}
                dot={false}
                name="7-Day EMA"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 flex flex-col items-center justify-center border border-dashed border-border rounded-xl">
            <Scale className="w-10 h-10 text-text-muted mb-2 opacity-50" />
            <p className="text-text-muted text-sm">Log more weight to see your trend</p>
          </div>
        )}
      </div>
    </div>
  );
}
