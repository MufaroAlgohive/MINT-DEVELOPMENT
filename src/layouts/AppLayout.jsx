import React from "react";
import { X } from "lucide-react";
import Navbar from "../components/Navbar.jsx";
import CreditNavbar from "../components/CreditNavbar.jsx";
import FamilyDropdown from "../components/FamilyDropdown.jsx";
import { useProfile } from "../lib/useProfile.js";

const AppLayout = ({ activeTab, onTabChange, onWithdraw, onShowComingSoon, modal, onCloseModal, children }) => {
  const { profile } = useProfile({ enabled: true });
  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  // Pages that render their own inline FamilyDropdown or don't need it
  const noOverlayTabs = [
    "home", "investments", "credit", "markets", "news", "more",
    "instantLiquidity", "creditApply", "creditRepay", "liquidityHistory", "unsecuredCreditDashboard",
    "deposit", "withdraw",
  ];
  const showFamilyDropdown = !noOverlayTabs.includes(activeTab);
  const creditTabs = ["credit", "instantLiquidity", "creditApply", "creditRepay", "liquidityHistory", "unsecuredCreditDashboard"];
  const isCredit = creditTabs.includes(activeTab);

  return (
    <div className="app-shell flex min-h-screen flex-col overflow-hidden">
      {/* Family profile dropdown — fixed overlay on all tabs except home (home renders its own inline) */}
      {showFamilyDropdown && profile && (
        <div className="fixed top-11 left-4 z-[200] pointer-events-auto">
          <FamilyDropdown
            profile={profile}
            userId={profile?.id}
            initials={initials}
            avatarUrl={profile?.avatarUrl}
            onOpenFamily={() =>
              window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "family" } }))
            }
            onSelectMember={(member) =>
              window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "memberPortfolio", member } }))
            }
          />
        </div>
      )}
      <main
        className="app-content flex-1 overflow-y-auto pb-[calc(7rem+env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
      {modal ? (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-900/60 px-4">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close modal"
            onClick={onCloseModal}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">{modal.title}</h2>
                <button
                  type="button"
                  onClick={onCloseModal}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-slate-600">{modal.message}</p>
            </div>
          </div>
        </div>
      ) : null}
      {isCredit ? (
        <CreditNavbar
          activeTab={activeTab}
          setActiveTab={onTabChange}
        />
      ) : (
        <Navbar
          activeTab={activeTab}
          setActiveTab={onTabChange}
          onWithdraw={onWithdraw}
          onShowComingSoon={onShowComingSoon}
          className="fixed bottom-0 left-0 w-full z-50"
        />
      )}
    </div>
  );
};

export default AppLayout;
