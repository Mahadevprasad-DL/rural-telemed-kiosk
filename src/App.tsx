import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { AuthPage } from './pages/AuthPage';
import { DoctorDashboardPage } from './pages/DoctorDashboardPage';
import { DoctorAlertsPage } from './pages/DoctorAlertsPage';
import { VillagerDashboardPage } from './pages/VillagerDashboardPage';
import { PatientDetailsPage } from './pages/PatientDetailsPage';
import { AIHealthCheckPage } from './pages/AIHealthCheckPage';
import { DoctorConsultationPage } from './pages/DoctorConsultationPage';
import { ReportsPage } from './pages/ReportsPage';
import { MedicinePage } from './pages/MedicinePage';
import { CreateCasePage } from './pages/CreateCasePage';
import { AllCasesPage } from './pages/AllCasesPage';
import { AshaWorkerPage } from './pages/AshaWorkerPage';
import { AshaHospitalDetailsPage } from './pages/AshaHospitalDetailsPage';
import { AshaReportsPage } from './pages/AshaReportsPage';
import { AdminPage } from './pages/AdminPage';
import type { NavPage, Profile, UserRole } from './types/database';

const AUTH_TOKEN_KEY = 'telemed_kiosk_auth_token';
const PROFILE_KEY = 'telemed_kiosk_profile';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

const roleHomePage: Record<UserRole, NavPage> = {
  patient: 'villager-dashboard',
  doctor: 'doctor-dashboard',
  asha_worker: 'asha-hospital-details',
  admin: 'admin',
};

const roleAllowedPages: Record<UserRole, NavPage[]> = {
  patient: [
    'villager-dashboard',
    'patient-details',
    'ai-health-check',
    'doctor-consultation',
    'create-case',
    'all-cases',
    'reports',
    'medicine',
  ],
  doctor: ['doctor-dashboard', 'all-cases', 'doctor-alerts'],
  asha_worker: ['doctor-alerts', 'all-cases', 'asha-reports', 'asha-hospital-details', 'asha-worker'],
  admin: ['admin', 'reports'],
};

function App() {
  const [currentPage, setCurrentPage] = useState<NavPage>('home');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const profileData = localStorage.getItem(PROFILE_KEY);
    
    if (!token || !profileData) {
      setProfile(null);
      return;
    }

    try {
      const parsedProfile = JSON.parse(profileData) as Profile;

      const validProfileId = UUID_REGEX.test(parsedProfile.id) || OBJECT_ID_REGEX.test(parsedProfile.id);
      if (!parsedProfile?.id || !validProfileId) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(PROFILE_KEY);
        setProfile(null);
        return;
      }

      setProfile(parsedProfile);
      const role = parsedProfile.role as UserRole;
      setCurrentPage(roleHomePage[role] || 'villager-dashboard');
    } catch {
      setProfile(null);
    }
  };

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        await loadProfile();
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void init();

    return () => {
      mounted = false;
    };
  }, []);

  const handleAuthSuccess = async (user: Profile, token: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
    setProfile(user);
    const role = user.role as UserRole;
    setCurrentPage(roleHomePage[role] || 'villager-dashboard');
  };

  const handleSignOut = async () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
    setProfile(null);
    setCurrentPage('home');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-teal-700 font-semibold">
          <Loader2 size={20} className="animate-spin" />
          Loading TeleMed Kiosk
        </div>
      </div>
    );
  }

  const isAuthenticated = Boolean(profile);
  const userRole = (profile?.role || 'patient') as UserRole;
  const allowedPages = roleAllowedPages[userRole] || roleAllowedPages.patient;
  const resolvedPage = isAuthenticated
    ? currentPage === 'home' || currentPage === 'auth'
      ? roleHomePage[userRole]
      : allowedPages.includes(currentPage)
        ? currentPage
        : roleHomePage[userRole]
    : currentPage !== 'home' && currentPage !== 'auth'
      ? 'home'
      : currentPage;

  const renderPage = () => {
    switch (resolvedPage) {
      case 'home':
        return (
          <HomePage
            onNavigate={setCurrentPage}
            onLogin={() => {
              setAuthMode('login');
              setCurrentPage('auth');
            }}
            onRegister={() => {
              setAuthMode('register');
              setCurrentPage('auth');
            }}
          />
        );
      case 'auth':
        return <AuthPage onAuthSuccess={handleAuthSuccess} initialMode={authMode} />;
      case 'doctor-dashboard':
        return <DoctorDashboardPage profile={profile} />;
      case 'doctor-alerts':
        return <DoctorAlertsPage profile={profile} />;
      case 'villager-dashboard':
        return <VillagerDashboardPage profile={profile} />;
      case 'patient-details':
        return <PatientDetailsPage profile={profile} />;
      case 'ai-health-check':
        return <AIHealthCheckPage profile={profile} />;
      case 'doctor-consultation':
        return <DoctorConsultationPage profile={profile} />;
      case 'create-case':
        return <CreateCasePage profile={profile} />;
      case 'all-cases':
        return <AllCasesPage profile={profile} />;
      case 'reports':
        return <ReportsPage profile={profile} />;
      case 'medicine':
        return <MedicinePage profile={profile} />;
      case 'asha-worker':
        return <AshaWorkerPage profile={profile} onNavigate={setCurrentPage} />;
      case 'asha-hospital-details':
        return <AshaHospitalDetailsPage profile={profile} />;
      case 'asha-reports':
        return <AshaReportsPage profile={profile} />;
      case 'admin':
        return <AdminPage profile={profile} />;
      default:
        return (
          <HomePage
            onNavigate={setCurrentPage}
            onLogin={() => {
              setAuthMode('login');
              setCurrentPage('auth');
            }}
            onRegister={() => {
              setAuthMode('register');
              setCurrentPage('auth');
            }}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {isAuthenticated && (
        <Navbar
          currentPage={resolvedPage}
          onNavigate={setCurrentPage}
          profile={profile}
          onSignOut={handleSignOut}
        />
      )}
      <main className={`${isAuthenticated ? 'lg:pl-[24rem]' : ''} min-h-screen`}>
        <div className="mx-auto max-w-[96rem] px-6 py-8 lg:px-8 lg:py-10">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

export default App;
