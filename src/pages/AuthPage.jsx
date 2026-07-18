import { useEffect, useState } from 'react';
import AuthLayout from '../components/AuthLayout.jsx';
import AuthForm from '../components/AuthForm.jsx';
import { supabase } from '../lib/supabase.js';

const MaintenanceScreen = () => (
  <div className="relative flex min-h-screen flex-col bg-white">
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
      {/* Logo */}
      <div className="mb-10">
        <span className="mint-brand text-3xl font-semibold tracking-[0.2em]">MINT</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-snug">
        System Maintenance in Progress
      </h1>

      <p className="text-sm text-gray-500 max-w-sm leading-relaxed mb-4">
        We are currently upgrading our systems to provide you with a better, more secure experience.
      </p>

      <p className="text-sm text-gray-500 max-w-sm leading-relaxed mb-4">
        Please rest assured that all your funds and investments remain entirely secure. During this maintenance window, logging in and creating new accounts are temporarily disabled.
      </p>

      <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
        We will be back online shortly. Please contact support for any urgent queries. Thank you for your patience and understanding.
      </p>

      <a
        href="mailto:support@mymint.co.za"
        className="mt-8 inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-5 py-2.5 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
      >
        Contact Support
      </a>
    </div>

    <div className="px-6 pb-10 text-center text-xs text-gray-400 leading-relaxed">
      <span className="font-semibold" style={{ color: '#4f2d8a' }}>MINT</span> (Pty) Ltd is a Financial Services Provider (FSP 55118) and a
      Registered Credit Provider (NCRCP22892). <span className="font-semibold" style={{ color: '#4f2d8a' }}>MINT</span> Reg no: 2024/644796/07
    </div>
  </div>
);

const AuthPage = ({ initialStep, onSignupComplete, onLoginComplete, onPreLogin }) => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkMaintenanceMode = async () => {
      try {
        const { data, error } = await supabase
          .from('app_settings')
          .select('is_enabled')
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          setIsEnabled(data.is_enabled);
        }
      } catch {
        setIsEnabled(true);
      } finally {
        setLoading(false);
      }
    };

    checkMaintenanceMode();

    if (!supabase) return;

    const channel = supabase
      .channel('app_settings_maintenance')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'app_settings' },
        (payload) => {
          if (payload.new && typeof payload.new.is_enabled === 'boolean') {
            setIsEnabled(payload.new.is_enabled);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="w-8 h-8 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin" />
      </div>
    );
  }

  if (!isEnabled) {
    return <MaintenanceScreen />;
  }

  return (
    <AuthLayout>
      <AuthForm
        initialStep={initialStep}
        onSignupComplete={onSignupComplete}
        onLoginComplete={onLoginComplete}
        onPreLogin={onPreLogin}
      />
    </AuthLayout>
  );
};

export default AuthPage;
