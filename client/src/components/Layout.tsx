// client/src/components/Layout.tsx
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Bot, UserCircle, Activity } from 'lucide-react';
import { BottomNav } from './BottomNav';
import { useAuth } from '../context/AuthContext';
import { ChatDrawer } from './ChatDrawer';

export function Layout() {
    const navigate = useNavigate();
    const location = useLocation();
    const { logout } = useAuth();

    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Check if there is a background workout draft running
    const [activeWorkout, setActiveWorkout] = useState<any>(null);

    useEffect(() => {
        // We run this check every time the user navigates to a new page
        const saved = localStorage.getItem('draft_workout');
        // If there's a draft AND we are not currently ON the active workout page
        if (saved && location.pathname !== '/workouts/active/new') {
            try {
                setActiveWorkout(JSON.parse(saved));
            } catch (e) {
                setActiveWorkout(null);
            }
        } else {
            setActiveWorkout(null);
        }
    }, [location.pathname]);

    return (
        // The main container: full height, hidden overflow so only the middle scrolls
        <div className="h-screen w-full flex flex-col bg-bg-primary overflow-hidden">
            {/* 1. TOP HEADER */}
            <header className="flex-none h-14 px-4 flex items-center justify-between glass border-b border-border z-10">
                <h1 className="text-lg font-bold bg-gradient-to-r from-accent to-purple-400 bg-clip-text text-transparent">
                    VitalSync
                </h1>

                {/* User Profile Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="text-text-secondary hover:text-accent transition-smooth p-1"
                    >
                        <UserCircle className="w-6 h-6" />
                    </button>

                    {isDropdownOpen && (
                        <>
                            {/* Invisible click-away backdrop */}
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setIsDropdownOpen(false)}
                            />
                            {/* Dropdown Menu */}
                            <div className="absolute right-0 mt-2 w-48 bg-bg-card border border-border shadow-2xl rounded-2xl py-2 z-50 animate-in fade-in zoom-in-95">
                                <button
                                    onClick={() => { setIsDropdownOpen(false); navigate('/profile'); }}
                                    className="w-full text-left px-4 py-3 text-sm font-medium hover:bg-white/5 transition-colors"
                                >
                                    Settings
                                </button>

                                <button
                                    onClick={() => { setIsDropdownOpen(false); logout(); }}
                                    className="w-full text-left px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                                >
                                    Sign Out
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </header>

            {/* 2. SCROLLABLE MAIN CONTENT */}
            <main className="flex-1 overflow-y-auto pb-[140px] relative">
                <div className="p-4 max-w-md mx-auto">
                    <Outlet />
                </div>
            </main>

            {/* 3. FLOATING ACTION BARS */}
            <div className="fixed bottom-[76px] left-0 right-0 px-4 z-40 max-w-md mx-auto flex flex-col gap-2">

                {/* Active Workout Banner */}
                {activeWorkout && (
                    <button
                        onClick={() => navigate('/workouts/active/new')}
                        className="w-full flex items-center justify-between bg-accent text-white border border-accent rounded-2xl py-3 px-4 shadow-[0_0_20px_rgba(255,59,48,0.3)] hover:scale-[1.02] transition-all animate-in slide-in-from-bottom-5"
                    >
                        <div className="flex items-center gap-3">
                            <div className="bg-white/20 p-2 rounded-full animate-pulse">
                                <Activity className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                                <span className="font-bold text-sm leading-none">Workout in Progress</span>
                                <span className="text-xs text-white/80 font-medium">{activeWorkout.name || 'Logging exercises...'}</span>
                            </div>
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider bg-white/20 px-3 py-1.5 rounded-lg active:scale-95 transition-all">Resume</span>
                    </button>
                )}

                {/* AI Chat Bar (Trigger) */}
                <button
                    onClick={() => setIsChatOpen(true)}
                    className="w-full flex items-center gap-3 bg-bg-input/90 backdrop-blur-md border border-border rounded-full py-3 px-4 shadow-[0_4px_30px_rgba(0,0,0,0.4)] hover:border-accent/50 transition-smooth group"
                >
                    <div className="bg-accent/20 p-1.5 rounded-full text-accent">
                        <Bot className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    </div>
                    <span className="text-text-muted text-[13px] font-medium flex-1 text-left">
                        Ask AI Coach anything...
                    </span>
                </button>
            </div>

            {/* The Hidden Chat Drawer */}
            <ChatDrawer isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

            {/* 4. BOTTOM NAVIGATION */}
            <BottomNav />
        </div>
    );
}
