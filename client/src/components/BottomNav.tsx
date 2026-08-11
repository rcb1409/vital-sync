import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Dumbbell, Moon, Utensils, Scale } from 'lucide-react';

const TABS = [
    { name: 'Workout',   path: '/workout',    icon: Dumbbell },
    { name: 'Sleep',     path: '/sleep',      icon: Moon },
    { name: 'Dashboard', path: '/dashboard',  icon: LayoutDashboard },
    { name: 'Diet',      path: '/nutrition',  icon: Utensils },
    { name: 'Body',      path: '/body',       icon: Scale },
];

export function BottomNav() {
    return (
        <nav className="fixed bottom-0 left-0 right-0 glass border-t border-border z-50 pb-safe">
            <div className="flex justify-between items-center h-[64px] px-2 sm:px-4 max-w-md mx-auto">
                {TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <NavLink
                            key={tab.path}
                            to={tab.path}
                            className={({ isActive }) =>
                                `flex-1 flex flex-col items-center justify-center h-full space-y-1 transition-smooth
                                ${isActive ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`
                            }
                        >
                            <Icon className="w-5 h-5 mb-0.5" />
                            <span className="text-[10px] whitespace-nowrap font-medium tracking-tight">
                                {tab.name}
                            </span>
                        </NavLink>
                    );
                })}
            </div>
        </nav>
    );
}
