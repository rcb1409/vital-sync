// SleepPage — sleep data synced from Google Health
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Moon, RefreshCw, Link2, AlertCircle, Loader2,
  Clock, Star, BarChart2,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  getGoogleHealthStatus, getSleep, syncGoogleHealth,
  type SleepSession, type GoogleHealthStatus,
} from '../services/googleHealth';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatNight(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STAGE_COLORS: Record<string, string> = {
  deep:  '#6366f1',
  rem:   '#a855f7',
  light: '#3b82f6',
  awake: '#52525b',
};

const STAGE_LABELS: Record<string, string> = {
  deep:  'Deep',
  rem:   'REM',
  light: 'Light',
  awake: 'Awake',
};

function qualityLabel(q: number | null) {
  if (!q) return null;
  const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
  return labels[Math.min(Math.max(Math.round(q), 1), 5)] ?? null;
}

// ── Connect Prompt ─────────────────────────────────────────────────────────────

function ConnectPrompt() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 text-center px-6">
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <Moon className="w-10 h-10 text-indigo-400" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-bg-primary rounded-full flex items-center justify-center border-2 border-indigo-400/30">
          <Link2 className="w-3.5 h-3.5 text-indigo-400" />
        </div>
      </div>
      <div>
        <h2 className="text-xl font-bold mb-2">Connect Google Health</h2>
        <p className="text-text-muted text-sm max-w-xs leading-relaxed">
          Link your Fitbit or Pixel Watch to automatically sync your sleep data here.
        </p>
      </div>
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl transition-all"
      >
        <Link2 className="w-4 h-4" />
        Go to Profile to Connect
      </button>
    </div>
  );
}

// ── Sleep Night Card ───────────────────────────────────────────────────────────

function SleepCard({ session, isFirst }: { session: SleepSession; isFirst?: boolean }) {
  const night = formatNight(session.startTime ?? session.recordedAt);
  const hours = session.durationMinutes / 60;
  const total = Object.values(session.stages).reduce((a, b) => a + b, 0);

  return (
    <div className={`glass rounded-2xl border p-4 ${
      isFirst ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-border'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Moon className={`w-4 h-4 ${isFirst ? 'text-indigo-400' : 'text-text-muted'}`} />
          <span className="font-semibold text-sm">{night}</span>
          {isFirst && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">
              Last Night
            </span>
          )}
        </div>
        {session.quality != null && (
          <div className="flex items-center gap-1 text-xs text-amber-400">
            <Star className="w-3.5 h-3.5 fill-amber-400" />
            <span>{qualityLabel(session.quality)}</span>
          </div>
        )}
      </div>

      {/* Duration */}
      <div className="flex items-end gap-2 mb-3">
        <p className="text-3xl font-black">{Math.floor(hours)}</p>
        <p className="text-lg font-bold text-text-muted mb-0.5">h</p>
        <p className="text-3xl font-black">{session.durationMinutes % 60}</p>
        <p className="text-lg font-bold text-text-muted mb-0.5">m</p>
      </div>

      {/* Stage bar */}
      {total > 0 && (
        <div className="space-y-2">
          <div className="flex h-2 w-full rounded-full overflow-hidden gap-0.5">
            {(['deep', 'rem', 'light', 'awake'] as const).map((stage) => {
              const pct = total > 0 ? (session.stages[stage] / total) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={stage}
                  style={{ width: `${pct}%`, backgroundColor: STAGE_COLORS[stage] }}
                  className="h-full rounded-sm"
                />
              ) : null;
            })}
          </div>

          {/* Stage legend */}
          <div className="flex gap-3 flex-wrap">
            {(['deep', 'rem', 'light', 'awake'] as const).map((stage) => {
              const min = session.stages[stage];
              if (!min) return null;
              return (
                <div key={stage} className="flex items-center gap-1 text-xs text-text-muted">
                  <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                  <span>{STAGE_LABELS[stage]} {formatDuration(min)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
        <Moon className="w-8 h-8 text-text-muted" />
      </div>
      <div>
        <h3 className="font-semibold mb-1">No sleep data yet</h3>
        <p className="text-text-muted text-sm max-w-xs">
          No sleep sessions synced. Wear your device at night and tap Sync.
        </p>
      </div>
      <button
        onClick={onSync}
        disabled={syncing}
        className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-sm font-medium px-4 py-2 rounded-xl transition-all disabled:opacity-50"
      >
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {syncing ? 'Syncing…' : 'Sync Now'}
      </button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function SleepPage() {
  const [status, setStatus] = useState<GoogleHealthStatus | null>(null);
  const [sessions, setSessions] = useState<SleepSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const s = await getGoogleHealthStatus();
      setStatus(s);
      if (s.connected) {
        const data = await getSleep(days);
        setSessions(data);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load sleep data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      await syncGoogleHealth(days);
      await load();
    } catch (e: any) {
      setError(e.message ?? 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Chart data — duration trend
  const chartData = [...sessions]
    .reverse()
    .map((s) => ({
      date:  formatShortDate(s.startTime ?? s.recordedAt),
      hours: parseFloat((s.durationMinutes / 60).toFixed(2)),
    }));

  const avgHours = sessions.length > 0
    ? parseFloat((sessions.reduce((sum, s) => sum + s.durationMinutes, 0) / sessions.length / 60).toFixed(1))
    : null;

  return (
    <div className="flex flex-col pb-24 pt-2 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sleep</h1>
          <p className="text-text-muted text-sm mt-0.5">Synced from Google Health</p>
        </div>
        {status?.connected && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-xl hover:bg-indigo-500/20 transition-all disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm px-4 py-3 rounded-xl">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      )}

      {!loading && status && !status.connected && <ConnectPrompt />}

      {!loading && status?.connected && (
        <>
          {/* Summary stats */}
          {sessions.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: <Moon className="w-4 h-4 text-indigo-400" />,   value: sessions.length,   label: 'Nights',    bg: 'bg-indigo-500/10' },
                  { icon: <Clock className="w-4 h-4 text-blue-400" />,    value: avgHours ? `${avgHours}h` : '—', label: 'Avg Duration', bg: 'bg-blue-500/10' },
                  { icon: <BarChart2 className="w-4 h-4 text-purple-400" />, value: `${days}d`, label: 'Period', bg: 'bg-purple-500/10' },
                ].map(({ icon, value, label, bg }) => (
                  <div key={label} className={`glass rounded-2xl border border-border p-3 text-center ${bg}`}>
                    <div className="flex justify-center mb-1">{icon}</div>
                    <p className="text-lg font-bold">{value}</p>
                    <p className="text-text-muted text-xs">{label}</p>
                  </div>
                ))}
              </div>

              {/* Range selector */}
              <div className="flex items-center gap-2">
                <p className="text-xs text-text-muted">Showing last</p>
                <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
                  {[7, 30, 90].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDays(d)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        days === d ? 'bg-indigo-600 text-white shadow-sm' : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              {/* Sleep trend chart */}
              {chartData.length > 1 && (
                <div className="glass p-5 rounded-2xl border border-border">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="bg-indigo-500/10 p-2 rounded-lg">
                      <BarChart2 className="w-5 h-5 text-indigo-400" />
                    </div>
                    <span className="font-semibold">Sleep Duration Trend</span>
                    {avgHours && (
                      <span className="text-text-muted text-xs ml-auto">{avgHours}h avg</span>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 12]}
                        tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                        tickFormatter={(v) => `${v}h`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', fontSize: 12 }}
                        formatter={(v: any) => [`${v}h`, 'Sleep']}
                      />
                      <Line
                        type="monotone"
                        dataKey="hours"
                        stroke="#6366f1"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#6366f1' }}
                        name="Sleep"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}

          {/* Sessions list */}
          {sessions.length === 0
            ? <EmptyState onSync={handleSync} syncing={syncing} />
            : (
              <div className="flex flex-col gap-3">
                {sessions.map((s, i) => (
                  <SleepCard key={s.id} session={s} isFirst={i === 0} />
                ))}
              </div>
            )
          }
        </>
      )}
    </div>
  );
}
