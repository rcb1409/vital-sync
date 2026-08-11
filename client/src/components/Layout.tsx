import { Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Bot, UserCircle } from 'lucide-react';
import { BottomNav } from './BottomNav';
import { useAuth } from '../context/AuthContext';
import { ChatDrawer } from './ChatDrawer';

export function Layout() {
    const navigate = useNavigate();
    const { logout } = useAuth();

    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    return (
        <div className="h-screen w-full flex flex-col bg-bg-primary overflow-hidden">
            {/* TOP HEADER */}
            <header className="flex-none h-14 px-4 flex items-center justify-between glass border-b border-border z-10">
                <h1 className="text-lg font-bold bg-gradient-to-r from-accent to-purple-400 bg-clip-text text-transparent">
                    VitalSync
                </h1>

                <div className="relative">
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="text-text-secondary hover:text-accent transition-smooth p-1"
                    >
                        <UserCircle className="w-6 h-6" />
                    </button>

                    {isDropdownOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
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

            {/* SCROLLABLE MAIN CONTENT */}
            <main className="flex-1 overflow-y-auto pb-[140px] relative">
                <div className="p-4 max-w-md mx-auto">
                    <Outlet />
                </div>
            </main>

            {/* FLOATING AI CHAT BAR */}
            <div className="fixed bottom-[76px] left-0 right-0 px-4 z-40 max-w-md mx-auto">
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

            <ChatDrawer isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
            <BottomNav />
        </div>
    );
}
