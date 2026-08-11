// WorkoutPage — shows activity sessions synced from Google Health
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Heart, Flame, Clock, Calendar,
  RefreshCw, Link2, ChevronDown, ChevronUp,
  AlertCircle, Loader2, Zap, MapPin, Footprints,
  Gauge, Mountain, Hand, Watch,
} from 'lucide-react';
import {
  getGoogleHealthStatus, getWorkouts, syncGoogleHealth,
  type WorkoutSession, type GoogleHealthStatus, type HeartRateZones,
} from '../services/googleHealth';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDistance(meters: number) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${meters} m`;
}

// Pace stored as decimal min/km (e.g. 8.66) → "8:40 /km"
function formatPace(minPerKm: number) {
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

const ACTIVITY_META: Record<WorkoutSession['activityType'], { icon: string; label: string; color: string }> = {
  run:      { icon: '🏃', label: 'Run',             color: 'from-orange-500/20 to-amber-500/10 border-orange-500/30' },
  walk:     { icon: '🚶', label: 'Walk',            color: 'from-blue-500/20 to-cyan-500/10 border-blue-500/30' },
  strength: { icon: '🏋️', label: 'Strength Training', color: 'from-accent/20 to-purple-500/10 border-accent/30' },
};

// Heart-rate zones, ordered light → peak with intensity colors
const ZONE_META: { key: keyof HeartRateZones; label: string; color: string }[] = [
  { key: 'lightMins',    label: 'Light',    color: '#3b82f6' },
  { key: 'moderateMins', label: 'Moderate', color: '#22c55e' },
  { key: 'vigorousMins', label: 'Vigorous', color: '#f97316' },
  { key: 'peakMins',     label: 'Peak',     color: '#ef4444' },
];

// ── Small building blocks ────────────────────────────────────────────────────

function MetricTile({ icon, value, label, accent }: { icon: React.ReactNode; value: string; label: string; accent: string }) {
  return (
    <div className="glass rounded-xl p-3 text-center">
      <div className={`flex items-center justify-center mb-1 ${accent}`}>{icon}</div>
      <p className="text-sm font-bold">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

// Stacked horizontal bar of time spent in each HR zone.
function HeartRateZoneBar({ zones }: { zones: HeartRateZones }) {
  const total = ZONE_META.reduce((sum, z) => sum + (zones[z.key] ?? 0), 0);
  if (total === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted">Heart Rate Zones</p>
        <p className="text-xs text-text-muted">{formatDuration(total)} active</p>
      </div>
      <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-0.5">
        {ZONE_META.map((z) => {
          const pct = (zones[z.key] / total) * 100;
          return pct > 0 ? (
            <div key={z.key} style={{ width: `${pct}%`, backgroundColor: z.color }} className="h-full rounded-sm" />
          ) : null;
        })}
      </div>
      <div className="flex gap-3 flex-wrap">
        {ZONE_META.map((z) => {
          const mins = zones[z.key];
          if (!mins) return null;
          return (
            <div key={z.key} className="flex items-center gap-1 text-xs text-text-muted">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: z.color }} />
              <span>{z.label} {formatDuration(mins)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Per-km pace bars for GPS runs — shorter bar = faster km.
function SplitsChart({ splits }: { splits: NonNullable<WorkoutSession['splits']> }) {
  const valid = splits.filter((s) => s.paceMinPerKm != null);
  if (valid.length < 2) return null;
  const slowest = Math.max(...valid.map((s) => s.paceMinPerKm!));
  const fastest = Math.min(...valid.map((s) => s.paceMinPerKm!));

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-text-muted">Pace by Kilometer</p>
      <div className="space-y-1.5">
        {valid.map((s) => {
          const isFastest = s.paceMinPerKm === fastest;
          const widthPct = 30 + (slowest > 0 ? (s.paceMinPerKm! / slowest) * 70 : 70);
          return (
            <div key={s.km} className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted w-8 shrink-0">km {s.km}</span>
              <div className="flex-1 bg-white/5 rounded-md h-5 overflow-hidden">
                <div
                  className={`h-full rounded-md flex items-center justify-end pr-2 ${isFastest ? 'bg-emerald-500/40' : 'bg-orange-500/30'}`}
                  style={{ width: `${widthPct}%` }}
                >
                  <span className="text-[10px] font-semibold">{formatPace(s.paceMinPerKm!)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Session Card ───────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: WorkoutSession }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTIVITY_META[session.activityType] ?? ACTIVITY_META.strength;
  const { date, time } = formatDateTime(session.startTime ?? session.recordedAt);
  const isCardio = session.activityType !== 'strength';

  const pausedMins = session.activeDurationMinutes != null
    ? session.durationMinutes - session.activeDurationMinutes
    : 0;

  return (
    <div className={`glass rounded-2xl border bg-gradient-to-br ${meta.color} transition-all duration-200`}>
      <button
        className="w-full p-4 flex items-center gap-4 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="text-3xl shrink-0">{meta.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold truncate">{meta.label}</p>
            {session.recordingMethod && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-text-muted bg-white/5 px-1.5 py-0.5 rounded-md">
                {session.recordingMethod === 'manual'
                  ? <><Hand className="w-2.5 h-2.5" /> Tracked</>
                  : <><Watch className="w-2.5 h-2.5" /> Auto</>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-text-muted flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {date}
            </span>
            <span>·</span>
            <span>{time}</span>
            {isCardio && session.distanceM != null && (
              <>
                <span>·</span>
                <span className="text-text-primary font-medium">{formatDistance(session.distanceM)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1 text-xs font-medium bg-white/10 px-2 py-1 rounded-lg">
            <Clock className="w-3 h-3 text-text-muted" />
            {formatDuration(session.durationMinutes)}
          </span>
          {session.calories != null && (
            <span className="flex items-center gap-1 text-xs font-medium bg-white/10 px-2 py-1 rounded-lg">
              <Flame className="w-3 h-3 text-orange-400" />
              {session.calories}
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/10 pt-3 space-y-4">
          {/* Metric grid — fields shown depend on activity type */}
          <div className="grid grid-cols-3 gap-3">
            {session.heartRate != null && (
              <MetricTile
                icon={<Heart className="w-3.5 h-3.5" />}
                value={`${Math.round(session.heartRate.avg)}`}
                label="Avg bpm"
                accent="text-rose-400"
              />
            )}
            {session.activeZoneMinutes != null && session.activeZoneMinutes > 0 && (
              <MetricTile
                icon={<Zap className="w-3.5 h-3.5" />}
                value={`${session.activeZoneMinutes}`}
                label="Zone min"
                accent="text-amber-400"
              />
            )}
            {isCardio && session.distanceM != null && (
              <MetricTile
                icon={<MapPin className="w-3.5 h-3.5" />}
                value={formatDistance(session.distanceM)}
                label="Distance"
                accent="text-blue-400"
              />
            )}
            {isCardio && session.avgPaceMinPerKm != null && session.avgPaceMinPerKm > 0 && (
              <MetricTile
                icon={<Gauge className="w-3.5 h-3.5" />}
                value={`${formatPace(session.avgPaceMinPerKm)}`}
                label="Pace /km"
                accent="text-cyan-400"
              />
            )}
            {isCardio && session.steps != null && session.steps > 0 && (
              <MetricTile
                icon={<Footprints className="w-3.5 h-3.5" />}
                value={session.steps.toLocaleString()}
                label="Steps"
                accent="text-emerald-400"
              />
            )}
            {isCardio && session.elevationGainM != null && session.elevationGainM > 0 && (
              <MetricTile
                icon={<Mountain className="w-3.5 h-3.5" />}
                value={`${session.elevationGainM} m`}
                label="Elevation"
                accent="text-lime-400"
              />
            )}
          </div>

          {pausedMins > 0 && (
            <p className="text-xs text-text-muted flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(session.activeDurationMinutes!)} active · {formatDuration(pausedMins)} paused
            </p>
          )}

          {session.heartRateZones && <HeartRateZoneBar zones={session.heartRateZones} />}

          {session.activityType === 'run' && session.splits && <SplitsChart splits={session.splits} />}
        </div>
      )}
    </div>
  );
}

// ── Empty / Connect States ─────────────────────────────────────────────────────

function ConnectPrompt() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 text-center px-6">
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center">
          <Activity className="w-10 h-10 text-accent" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-bg-primary rounded-full flex items-center justify-center border-2 border-accent/30">
          <Link2 className="w-3.5 h-3.5 text-accent" />
        </div>
      </div>
      <div>
        <h2 className="text-xl font-bold mb-2">Connect Google Health</h2>
        <p className="text-text-muted text-sm max-w-xs leading-relaxed">
          Link your Fitbit or Pixel Watch to automatically sync all your workout sessions here.
        </p>
      </div>
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 bg-accent text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-accent/25 transition-all"
      >
        <Link2 className="w-4 h-4" />
        Go to Profile to Connect
      </button>
    </div>
  );
}

function EmptyState({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
        <Activity className="w-8 h-8 text-text-muted" />
      </div>
      <div>
        <h3 className="font-semibold mb-1">No workouts found</h3>
        <p className="text-text-muted text-sm max-w-xs">
          No activity sessions synced yet. Complete a workout on your device and tap Sync.
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

export function WorkoutPage() {
  const [status, setStatus] = useState<GoogleHealthStatus | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
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
        const data = await getWorkouts(days);
        setSessions(data);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load workouts');
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

  const totalMinutes  = sessions.reduce((s, w) => s + w.durationMinutes, 0);
  const totalCalories = sessions.reduce((s, w) => s + (w.calories ?? 0), 0);

  return (
    <div className="flex flex-col pb-24 pt-2 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activity</h1>
          <p className="text-text-muted text-sm mt-0.5">Synced from Google Health</p>
        </div>
        {status?.connected && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm font-medium text-accent bg-accent/10 border border-accent/20 px-3 py-1.5 rounded-xl hover:bg-accent/20 transition-all disabled:opacity-50"
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
          {sessions.length > 0 && (
            <>
              {/* Summary strip */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: <Zap className="w-4 h-4 text-accent" />,         value: sessions.length,                                   label: 'Sessions', bg: 'bg-accent/10' },
                  { icon: <Clock className="w-4 h-4 text-blue-400" />,     value: formatDuration(totalMinutes),                      label: 'Total Time', bg: 'bg-blue-500/10' },
                  { icon: <Flame className="w-4 h-4 text-orange-400" />,   value: totalCalories > 0 ? totalCalories.toLocaleString() : '—', label: 'Calories', bg: 'bg-orange-500/10' },
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
                        days === d ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
                {status.account?.lastSyncAt && (
                  <p className="text-xs text-text-muted ml-auto">
                    Synced {new Date(status.account.lastSyncAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </>
          )}

          {sessions.length === 0
            ? <EmptyState onSync={handleSync} syncing={syncing} />
            : (
              <div className="flex flex-col gap-3">
                {sessions.map((s) => <SessionCard key={s.id} session={s} />)}
              </div>
            )
          }
        </>
      )}
    </div>
  );
}
