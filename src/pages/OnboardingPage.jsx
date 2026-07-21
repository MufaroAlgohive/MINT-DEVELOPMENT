import React, { useState, useEffect } from "react";
import OriginButton from "../components/OriginButton";
import { supabase } from "../lib/supabase.js";
import AuthMethodModal from "../components/AuthMethodModal.jsx";

const OnboardingPage = ({ onCreateAccount, onLogin, oauthError }) => {
  const [authModal, setAuthModal] = useState(null); // 'login' | 'signup' | null
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [giftId, setGiftId] = useState(() => {
    const fromStorage = localStorage.getItem('mint_pending_gift_id');
    if (fromStorage) return fromStorage;
    const urlParam = new URLSearchParams(window.location.search).get('gift');
    if (urlParam && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(urlParam)) {
      localStorage.setItem('mint_pending_gift_id', urlParam);
      return urlParam;
    }
    return null;
  });
  const [giftDetails, setGiftDetails] = useState(null);
  const [giftCountdown, setGiftCountdown] = useState(null);

  function fmtCountdown(expiresAt) {
    const ms = new Date(expiresAt) - Date.now();
    if (ms <= 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  useEffect(() => {
    const exp = giftDetails?.expires_at;
    if (!exp) return;
    const tick = () => {
      const label = fmtCountdown(exp);
      if (!label) {
        localStorage.removeItem('mint_pending_gift_id');
        setGiftId(null);
      } else {
        setGiftCountdown(label);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [giftDetails?.expires_at]);

  useEffect(() => {
    const fetchLandingImage = async () => {
      try {
        if (!supabase) throw new Error("Supabase client not initialized");
        const { data, error } = await supabase.storage
          .from('MintAuthImages')
          .list('', {
            limit: 20,
            sortBy: { column: 'name', order: 'asc' }
          });
        
        if (error) throw error;

        if (data && data.length > 0) {
          const imageFiles = data.filter(file => 
            /\.(png|jpe?g|webp|avif)$/i.test(file.name)
          );
          if (imageFiles.length > 0) {
            const randomIndex = Math.floor(Math.random() * imageFiles.length);
            const selectedFile = imageFiles[randomIndex];
            
            const { data: { publicUrl } } = supabase.storage
              .from('MintAuthImages')
              .getPublicUrl(selectedFile.name);
            
            setImageUrl(publicUrl);
            return;
          }
        }
      } catch (err) {
        console.warn("Failed to load dynamic auth image:", err.message);
      }
      
      setImageUrl("/assets/images/onboarding-hero.png");
    };

    fetchLandingImage();
  }, []);

  useEffect(() => {
    if (!giftId) return;
    fetch(`/api/gift/by-id/${giftId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.status) {
          if (['claimed', 'completed', 'expired', 'cancelled'].includes(data.status)) {
            localStorage.removeItem('mint_pending_gift_id');
            localStorage.removeItem('mint_pending_gift_expires');
            setGiftId(null);
          } else {
            setGiftDetails(data);
          }
        } else if (!data) {
          localStorage.removeItem('mint_pending_gift_id');
          localStorage.removeItem('mint_pending_gift_expires');
          setGiftId(null);
        }
      })
      .catch(() => {});
  }, [giftId]);

  const formatAmount = (cents) => {
    if (!cents) return '';
    return `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  return (
    <>
    <div className="h-screen overflow-hidden bg-white">
      <div className="grid h-full grid-rows-2 lg:grid-cols-[1.05fr_1fr] lg:grid-rows-none">
        <div className="order-2 flex h-full flex-col overflow-y-auto px-6 py-8 lg:order-1 lg:px-16 lg:py-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 animate-on-load delay-1">
              <img src="/assets/mint-logo.svg" alt="MINT logo" className="h-6 w-auto" />
              <span className="mint-brand text-lg font-semibold tracking-[0.12em]">MINT</span>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-xl my-auto flex-col space-y-8 py-6">
            {giftId && (
              <>
                <style>{`
                  @keyframes gift-slide-up {
                    from { opacity: 0; transform: translateY(14px); }
                    to   { opacity: 1; transform: translateY(0); }
                  }
                  @keyframes gift-shimmer {
                    0%   { transform: translateX(-100%) skewX(-12deg); }
                    100% { transform: translateX(300%) skewX(-12deg); }
                  }
                  @keyframes gift-glow-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(167,139,250,0), 0 0 18px 2px rgba(139,92,246,0.18); }
                    50%      { box-shadow: 0 0 0 3px rgba(167,139,250,0.18), 0 0 32px 6px rgba(139,92,246,0.32); }
                  }
                  @keyframes gift-icon-float {
                    0%, 100% { transform: translateY(0); }
                    50%      { transform: translateY(-3px); }
                  }
                  @keyframes gift-dot-ping {
                    0%   { transform: scale(1); opacity: 1; }
                    75%, 100% { transform: scale(2.2); opacity: 0; }
                  }
                  .gift-banner {
                    animation: gift-slide-up 0.55s cubic-bezier(0.16,1,0.3,1) both,
                               gift-glow-pulse 2.8s ease-in-out 0.6s infinite;
                  }
                  .gift-shimmer::after {
                    content: '';
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.10) 50%, transparent 70%);
                    animation: gift-shimmer 2.6s ease-in-out 0.8s infinite;
                  }
                  .gift-icon { animation: gift-icon-float 2.4s ease-in-out 0.4s infinite; }
                  .gift-dot  { animation: gift-dot-ping 1.4s cubic-bezier(0,0,0.2,1) 0.5s infinite; }
                `}</style>

                <div
                  className="gift-banner relative overflow-hidden rounded-2xl px-4 py-4 flex items-center gap-3.5 cursor-default select-none"
                  style={{
                    background: 'linear-gradient(135deg, #1e0d3a 0%, #3b1a6b 45%, #2a1050 100%)',
                    border: '1px solid rgba(167,139,250,0.3)',
                  }}
                >
                  {/* Shimmer overlay */}
                  <div className="gift-shimmer absolute inset-0 rounded-2xl pointer-events-none" />

                  {/* Gift icon */}
                  <span className="gift-icon shrink-0 flex h-10 w-10 items-center justify-center rounded-xl text-2xl"
                    style={{ background: 'rgba(255,255,255,0.07)', boxShadow: '0 0 14px 2px rgba(250,204,21,0.18)' }}>
                    🎁
                  </span>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold tracking-wide leading-tight" style={{
                      background: 'linear-gradient(90deg, #ffffff 0%, #e9d5ff 60%, #fde68a 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}>
                      You have an investment gift waiting
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'rgba(196,181,253,0.85)' }}>
                      Log in or create an account to claim it
                    </p>
                    {giftCountdown && (
                      <p className="text-xs mt-1 font-medium" style={{ color: 'rgba(250,204,21,0.9)' }}>
                        ⏱ Expires in {giftCountdown}
                      </p>
                    )}
                  </div>

                  {/* Dismiss */}
                  <button
                    onClick={() => { localStorage.removeItem('mint_pending_gift_id'); setGiftId(null); }}
                    className="shrink-0 flex items-center justify-center rounded-full w-6 h-6 ml-1"
                    style={{ background: 'rgba(255,255,255,0.10)' }}
                    aria-label="Dismiss gift banner"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1 1l8 8M9 1L1 9" stroke="rgba(196,181,253,0.85)" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </>
            )}

            <div className="space-y-3 animate-on-load delay-2">
              <h1 className="text-4xl font-semibold text-slate-900 sm:text-5xl">
                Welcome to <span className="mint-brand">Mint</span>
              </h1>
              <p className="text-lg text-slate-600">
                Your money tools are ready when you are.
              </p>
            </div>

            {oauthError && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 animate-on-load delay-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 5Zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" fill="currentColor"/>
                </svg>
                {oauthError}
              </div>
            )}

            <div className="flex flex-col gap-4 animate-on-load delay-3 sm:items-start">
              <OriginButton
                onClick={() => setAuthModal('login')}
                circleColor="rgba(148,163,184,0.18)"
                className="inline-flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-900 shadow-sm sm:w-auto"
              >
                Login
              </OriginButton>

              <OriginButton
                onClick={() => setAuthModal('signup')}
                circleColor="rgba(255,255,255,0.12)"
                className="inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-slate-900/20 sm:w-auto"
              >
                Create Account
              </OriginButton>
            </div>
          </div>
        </div>

        <div className="order-1 h-full lg:order-2">
          <div className="relative h-full w-full overflow-hidden bg-slate-50 rounded-b-[3.5rem] [clip-path:ellipse(140%_90%_at_50%_0%)] lg:rounded-none lg:[clip-path:none]">
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Person using a phone"
                className="h-full w-full object-cover transition-opacity duration-700 ease-out"
                style={{ opacity: imageLoading ? 0 : 1 }}
                onLoad={() => setImageLoading(false)}
              />
            )}
            {imageLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-violet-600" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {authModal && (
      <AuthMethodModal
        mode={authModal}
        onClose={() => setAuthModal(null)}
        onContinueWithEmail={() => {
          setAuthModal(null);
          if (authModal === 'login') {
            onLogin();
          } else {
            onCreateAccount();
          }
        }}
      />
    )}
    </>
  );
};

export default OnboardingPage;
