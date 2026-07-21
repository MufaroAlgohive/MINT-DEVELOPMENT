import { useState } from 'react';
import { supabase, supabaseReady } from '../lib/supabase.js';

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const EmailIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

const AuthMethodModal = ({ mode = 'login', onClose, onContinueWithEmail }) => {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const isSignup = mode === 'signup';
  const title = isSignup ? 'Create a Mint account' : 'Welcome back';
  const switchLabel = isSignup ? 'Already have an account?' : "Don't have an account?";
  const switchAction = isSignup ? 'Log in' : 'Sign up';

  const handleGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const client = supabase || (await supabaseReady);
      if (!client) {
        setError('Connection error. Please refresh and try again.');
        setGoogleLoading(false);
        return;
      }
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setGoogleLoading(false);
      }
      // On success the browser navigates away — no need to stop loading
    } catch (err) {
      setError('An error occurred. Please try again.');
      setGoogleLoading(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Sheet / card */}
      <div
        className="relative w-full sm:max-w-sm bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl px-6 pt-8 pb-10 flex flex-col items-center gap-6"
        style={{ animation: 'auth-modal-in 0.28s cubic-bezier(0.34,1.56,0.64,1) both' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Logo */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <img src="/assets/mint-logo.svg" alt="Mint" className="h-9 w-auto drop-shadow" />
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-slate-900 text-center -mt-2">
          {title}
        </h2>

        {/* Buttons */}
        <div className="w-full flex flex-col gap-3">
          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-medium text-slate-800 hover:bg-slate-100 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {googleLoading ? (
              <span className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-violet-600 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            Continue with Google
          </button>

          {/* Email */}
          <button
            onClick={onContinueWithEmail}
            className="w-full flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-slate-800 hover:bg-slate-50 active:scale-[0.98] transition-all"
          >
            <EmailIcon />
            Continue with Email
          </button>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 text-center -mt-2">{error}</p>
        )}

        {/* Switch mode hint */}
        <p className="text-xs text-slate-500 text-center -mt-2">
          {switchLabel}{' '}
          <button
            onClick={() => { onClose(); /* parent handles switching */ }}
            className="font-semibold text-violet-700 hover:underline underline-offset-2"
            // We close and let the parent re-open in the other mode via onSwitchMode
            // For simplicity we just close — the welcome page has both buttons visible
          >
            {switchAction}
          </button>
        </p>
      </div>

      <style>{`
        @keyframes auth-modal-in {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (min-width: 640px) {
          @keyframes auth-modal-in {
            from { opacity: 0; transform: scale(0.94); }
            to   { opacity: 1; transform: scale(1); }
          }
        }
      `}</style>
    </div>
  );
};

export default AuthMethodModal;
