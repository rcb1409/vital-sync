import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkoutsPage } from './pages/WorkoutsPage';
import { WorkoutHistoryPage } from './pages/WorkoutHistoryPage';
import { ActiveWorkoutPage } from './pages/ActiveWorkoutPage';
import { NutritionPage } from './pages/NutritionPage';
import { MetricsPage } from './pages/MetricsPage';
import { RunsPage } from './pages/RunsPage';
import { Layout } from './components/Layout';
import { ProfilePage } from './pages/ProfilePage';

import './index.css';

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
        <Route path="/workouts/templates/:templateId" element={<ActiveWorkoutPage />} />
        <Route path="/nutrition" element={<NutritionPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
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
