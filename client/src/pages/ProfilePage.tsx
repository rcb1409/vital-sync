import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import {
  LogOut, Save, Flame, Beef, Activity,
  CheckCircle2, Link2, Loader2, RefreshCw,
} from 'lucide-react';
import { getGoogleHealthStatus, syncGoogleHealth, type GoogleHealthStatus } from '../services/googleHealth';

export function ProfilePage() {
  const { user, updateUser, logout } = useAuth();
  const [isSaving, setIsSaving]   = useState(false);

  const [goals, setGoals] = useState({
    target_weight:   user?.goals?.target_weight   ?? 75,
    calorie_target:  user?.goals?.calorie_target  ?? 2500,
    protein_target:  user?.goals?.protein_target  ?? 150,
  });

  // AI memory
  const safeMemory = Array.isArray(user?.aiMemory)
    ? user.aiMemory.map((m) => (typeof m === 'string' ? { category: 'General', fact: m, expiresAt: null } : m))
    : [];
  const [aiMemory, setAiMemory] = useState<{ category?: string; fact: string; expiresAt?: string | null }[]>(safeMemory);

  // Google Health status
  const [ghStatus, setGhStatus]   = useState<GoogleHealthStatus | null>(null);
  const [ghLoading, setGhLoading] = useState(true);
  const [ghSyncing, setGhSyncing] = useState(false);
  const [ghError, setGhError]     = useState<string | null>(null);

  useEffect(() => {
    // Check for OAuth callback query params
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connected')) {
      window.history.replaceState({}, '', '/profile');
    }
    if (params.get('google_error')) {
      setGhError('Google Health access was denied.');
      window.history.replaceState({}, '', '/profile');
    }

    getGoogleHealthStatus()
      .then(setGhStatus)
      .catch(() => setGhStatus({ connected: false }))
      .finally(() => setGhLoading(false));
  }, []);

  const handleConnectGoogle = async () => {
    try {
      const { data } = await api.get('/google-health/connect');
      window.location.href = data.url;
    } catch {
      setGhError('Failed to start Google Health connection. Try again.');
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!confirm('Disconnect Google Health? Your synced data will be kept.')) return;
    try {
      await api.delete('/google-health/disconnect');
      setGhStatus({ connected: false });
    } catch {
      setGhError('Failed to disconnect. Try again.');
    }
  };

  const handleSync = async () => {
    try {
      setGhSyncing(true);
      await syncGoogleHealth(30);
      const s = await getGoogleHealthStatus();
      setGhStatus(s);
    } catch {
      setGhError('Sync failed. Check your connection.');
    } finally {
      setGhSyncing(false);
    }
  };

  const handleSaveGoals = async () => {
    setIsSaving(true);
    try {
      const res = await api.patch('/users/profile', { goals });
      updateUser(res.data.user);
      alert('Goals saved!');
    } catch {
      alert('Failed to save goals.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveMemory = async (newMemory: typeof aiMemory) => {
    setAiMemory(newMemory);
    try {
      const res = await api.patch('/users/profile', { aiMemory: newMemory });
      updateUser(res.data.user);
    } catch {
      console.error('Failed to save AI memory');
    }
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex flex-col gap-6 pb-24 animate-in fade-in slide-in-from-bottom-4">

      {/* Profile card */}
      <div className="glass border border-border p-5 rounded-3xl flex flex-col items-center gap-2 mt-2">
        <div className="bg-accent/20 w-16 h-16 rounded-full flex items-center justify-center text-accent text-2xl font-bold">
          {user?.name?.charAt(0).toUpperCase()}
        </div>
        <h1 className="font-bold text-xl">{user?.name}</h1>
        <p className="text-sm text-text-muted">{user?.email}</p>
      </div>

      {/* Google Health connection */}
      <div className="glass border border-border p-5 rounded-3xl">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent" /> Google Health
        </h2>

        {ghError && (
          <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 mb-4">{ghError}</p>
        )}

        {ghLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking status…
          </div>
        ) : ghStatus?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
              <CheckCircle2 className="w-5 h-5" /> Connected
              {ghStatus.account?.lastSyncAt && (
                <span className="text-text-muted font-normal ml-auto text-xs">
                  Last sync {new Date(ghStatus.account.lastSyncAt).toLocaleDateString()}
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSync}
                disabled={ghSyncing}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all disabled:opacity-50"
              >
                {ghSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {ghSyncing ? 'Syncing…' : 'Sync Now'}
              </button>
              <button
                onClick={handleDisconnectGoogle}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleConnectGoogle}
            className="w-full flex items-center justify-center gap-2 bg-accent text-white font-semibold py-3 rounded-xl shadow-lg hover:shadow-accent/25 transition-all"
          >
            <Link2 className="w-4 h-4" />
            Connect Google Health
          </button>
        )}
      </div>

      {/* Daily targets */}
      <div className="glass border border-border p-5 rounded-3xl">
        <h2 className="font-bold text-lg mb-6">Daily Targets</h2>

        <div className="flex flex-col gap-5">
          {/* Target weight */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">⚖️ Weight Target</span>
              <span className="text-sm font-bold">{goals.target_weight} kg</span>
            </div>
            <input
              type="range" min="40" max="150" step="1"
              value={goals.target_weight}
              onChange={(e) => setGoals({ ...goals, target_weight: Number(e.target.value) })}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-400"
            />
          </div>

          {/* Calories */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-400" /> Calorie Target
              </span>
              <span className="text-sm font-bold">{goals.calorie_target} kcal</span>
            </div>
            <input
              type="range" min="1200" max="4000" step="50"
              value={goals.calorie_target}
              onChange={(e) => setGoals({ ...goals, calorie_target: Number(e.target.value) })}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-400"
            />
          </div>

          {/* Protein */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">
                <Beef className="w-4 h-4 text-rose-400" /> Protein Target
              </span>
              <span className="text-sm font-bold">{goals.protein_target} g</span>
            </div>
            <input
              type="range" min="50" max="300" step="5"
              value={goals.protein_target}
              onChange={(e) => setGoals({ ...goals, protein_target: Number(e.target.value) })}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-rose-400"
            />
          </div>
        </div>

        {/* AI Memory */}
        <h2 className="font-bold text-lg mt-8 mb-4 flex items-center gap-2">
          <span className="text-blue-400">🧠</span> AI Knowledge Base
        </h2>
        <div className="flex flex-col gap-3">
          {aiMemory.length === 0 ? (
            <p className="text-text-muted text-sm italic">The Coach hasn't learned any persistent facts about you yet. Chat with it to build memory!</p>
          ) : aiMemory.map((item, index) => (
            <div key={index} className="glass p-3 rounded-xl border border-border flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">{item.category ?? 'General'}</span>
                  {item.expiresAt && (
                    <span className="text-[10px] uppercase font-bold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full">
                      Expires {formatDate(item.expiresAt)}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={item.fact}
                  onChange={(e) => {
                    const next = [...aiMemory];
                    next[index] = { ...next[index], fact: e.target.value };
                    setAiMemory(next);
                  }}
                  onBlur={() => handleSaveMemory(aiMemory)}
                  className="w-full bg-transparent border-none text-sm focus:outline-none mt-1"
                />
              </div>
              <button
                onClick={() => handleSaveMemory(aiMemory.filter((_, i) => i !== index))}
                className="text-text-muted hover:text-red-400 p-1 transition-colors"
              >✕</button>
            </div>
          ))}
        </div>

        <button
          onClick={handleSaveGoals}
          disabled={isSaving}
          className="w-full mt-8 flex items-center justify-center gap-2 bg-accent hover:bg-accent/80 text-white font-bold py-3.5 rounded-2xl transition-all disabled:opacity-50"
        >
          <Save className="w-5 h-5" />
          {isSaving ? 'Saving…' : 'Save Targets'}
        </button>
      </div>

      {/* Sign out */}
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
