import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkoutPage } from './pages/WorkoutPage';
import { SleepPage } from './pages/SleepPage';
import { NutritionPage } from './pages/NutritionPage';
import { BodyPage } from './pages/BodyPage';
import { Layout } from './components/Layout';
import { ProfilePage } from './pages/ProfilePage';

import './index.css';

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-bg-primary" />;
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
      />

      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard"  element={<DashboardPage />} />
        <Route path="/workout"    element={<WorkoutPage />} />
        <Route path="/sleep"      element={<SleepPage />} />
        <Route path="/nutrition"  element={<NutritionPage />} />
        <Route path="/body"       element={<BodyPage />} />
        <Route path="/profile"    element={<ProfilePage />} />

        {/* Legacy redirects so bookmarked URLs still work */}
        <Route path="/workouts"   element={<Navigate to="/workout"    replace />} />
        <Route path="/metrics"    element={<Navigate to="/body"       replace />} />
        <Route path="/runs"       element={<Navigate to="/workout"    replace />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
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
