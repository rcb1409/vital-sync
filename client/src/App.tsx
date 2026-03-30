import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { WorkoutsPage } from './pages/WorkoutsPage';
import { WorkoutHistoryPage } from './pages/WorkoutHistoryPage';
import { ActiveWorkoutPage } from './pages/ActiveWorkoutPage';
import { NutritionPage } from './pages/NutritionPage';
import './index.css';

// Dashboard Placeholder - Will be expanded in later steps
function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-bg-primary p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 text-center pt-2">
          <h1 className="text-3xl font-bold">Dashboard</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass p-6 rounded-xl border border-border">
            <h3 className="text-text-secondary text-sm font-medium mb-2">Target Weight</h3>
            <p className="text-2xl font-bold">{user?.goals.target_weight} kg</p>
          </div>
          <div className="glass p-6 rounded-xl border border-border">
            <h3 className="text-text-secondary text-sm font-medium mb-2">Daily Calories</h3>
            <p className="text-2xl font-bold">{user?.goals.calorie_target} kcal</p>
          </div>
          <div className="glass p-6 rounded-xl border border-border">
            <h3 className="text-text-secondary text-sm font-medium mb-2">Training Schedule</h3>
            <p className="text-2xl font-bold">{user?.goals.training_days_per_week} days/week</p>
          </div>
        </div>

        <div className="glass mt-6 p-8 rounded-xl border border-border text-center">
          <p className="text-text-secondary text-lg mb-2">Auth Module Complete! 🎉</p>
          <p className="text-text-muted text-sm">Next up: Building the main navigation and layout shell.</p>
        </div>
      </div>
    </div>
  );
}

import { Layout } from './components/Layout'; // <-- Important new import
import { MetricsPage } from './pages/MetricsPage';

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show a blank screen while initializing auth to prevent flicker
  if (isLoading) {
    return <div className="min-h-screen bg-bg-primary" />;
  }

  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
      />

      {/* Protected Routes Wrapper */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/workouts" element={<WorkoutsPage />} />
        <Route path="/workouts/history" element={<WorkoutHistoryPage />} />
        <Route path="/workouts/active/new" element={<ActiveWorkoutPage />} />
        <Route path="/nutrition" element={<NutritionPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
