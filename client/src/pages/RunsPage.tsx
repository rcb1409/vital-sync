import { useState, useEffect } from 'react';
import { getStravaAuthUrl, getRunsHistory, triggerStravaSync, type RunActivityLog } from '../services/run';
import { Activity, Loader2, RefreshCw, Flame, Navigation, Clock } from 'lucide-react';
import { useLocation } from 'react-router-dom';

export function RunsPage() {
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const isJustSynced = queryParams.get('synced') === 'true';

    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [runs, setRuns] = useState<RunActivityLog[]>([]);

    const fetchRuns = async () => {
        try {
            setLoading(true);
            const history = await getRunsHistory();
            setRuns(history);
        } catch (error) {
            console.error("Failed to fetch runs", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRuns();
    }, []);

    const handleConnect = async () => {
        try {
            setConnecting(true);
            const url = await getStravaAuthUrl();
            window.location.href = url;
        } catch (error) {
            console.error("Failed to fetch auth url", error);
            setConnecting(false);
        }
    };

    const handleManualSync = async () => {
        try {
            setSyncing(true);
            const res = await triggerStravaSync();
            if (res.synced > 0) await fetchRuns();
        } catch (error) {
            console.error("Sync failed", error);
        } finally {
            setSyncing(false);
        }
    };

    const formatPace = (secondsPerKm: number) => {
        if (!secondsPerKm) return '0:00';
        const m = Math.floor(secondsPerKm / 60);
        const s = secondsPerKm % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    if (loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;
    }

    if (runs.length === 0 && !isJustSynced) {
        return (
            <div className="flex flex-col items-center justify-center h-full space-y-4 pb-20 mt-20">
                <h1 className="text-3xl font-bold">Connect Strava</h1>
                <p className="text-text-muted text-center max-w-sm mb-6">
                    Sync your rides, runs, and swims directly into your VitalSync dashboard to track your cardio goals.
                </p>
                <button 
                    onClick={handleConnect} 
                    className="bg-[#fc4c02] hover:bg-[#e34402] text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-colors shadow-lg shadow-orange-500/20"
                >
                    {connecting ? <Loader2 className="w-6 h-6 animate-spin" /> : <><Activity className="w-6 h-6"/> Connect Account</>}
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full space-y-6 pb-20 pt-2">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">Activities</h1>
                <button 
                    onClick={handleManualSync} 
                    className="flex items-center gap-2 bg-bg-input hover:bg-white/10 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                >
                    {syncing ? <Loader2 className="w-4 h-4 animate-spin text-accent" /> : <RefreshCw className="w-4 h-4 text-accent" />}
                    Sync Status
                </button>
            </div>

            {isJustSynced && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-4 rounded-xl flex items-center justify-center font-medium">
                    Strava Account Successfully Linked!
                </div>
            )}

            <div className="space-y-4">
                {runs.length === 0 ? (
                    <div className="glass p-8 rounded-xl border border-border text-center text-text-muted">
                        No recent activities found on Strava linking to this account.
                    </div>
                ) : (
                    runs.map((run) => (
                        <div key={run.id} className="glass p-5 rounded-xl border border-border flex flex-col gap-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    {/* Detect if it's a ride or swim using the raw JSON data we safely saved! */}
                                    <h3 className="font-bold text-lg">{run.raw?.name || 'Activity'}</h3>
                                    <p className="text-sm text-text-muted">
                                        {new Date(run.startTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </p>
                                </div>
                                <div className="bg-[#fc4c02]/10 p-2 rounded-lg">
                                    <Activity className="w-5 h-5 text-[#fc4c02]" />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
                                <div className="flex flex-col">
                                    <span className="text-xs text-text-muted flex items-center gap-1"><Navigation className="w-3 h-3"/> Distance</span>
                                    <span className="font-bold text-lg">{(run.distanceM / 1000).toFixed(2)}<span className="text-xs font-normal"> km</span></span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs text-text-muted flex items-center gap-1"><Clock className="w-3 h-3"/> Time</span>
                                    <span className="font-bold text-lg">
                                        {Math.floor(run.movingTimeS / 60)}<span className="text-xs font-normal"> min</span>
                                    </span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs text-text-muted flex items-center gap-1"><Flame className="w-3 h-3"/> Pace</span>
                                    <span className="font-bold text-lg">{formatPace(run.averagePaceSPerKm)}<span className="text-xs font-normal"> /km</span></span>
                                </div>
                                
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
