// client/src/components/BottomNav.tsx
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    Dumbbell,
    Apple,
    Activity,
    CheckSquare // Icon for Habits
} from 'lucide-react';

const MAIN_TABS = [
    { name: 'Home', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Workouts', path: '/workouts', icon: Dumbbell },
    { name: 'Diet & Body', path: '/nutrition', icon: Apple },
    { name: 'Runs', path: '/runs', icon: Activity },
    { name: 'Habits', path: '/metrics', icon: CheckSquare },
];

export function BottomNav() {
    return (
        // Fixed to the bottom, full width, with a beautiful glassmorphism background
        <nav className="fixed bottom-0 left-0 right-0 glass border-t border-border z-50 pb-safe">
            <div className="flex justify-between items-center h-[64px] px-2 sm:px-4 max-w-md mx-auto">

                {MAIN_TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <NavLink
                            key={tab.path}
                            to={tab.path}
                            // Using flex-1 ensures all 5 buttons get exactly equal space
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
