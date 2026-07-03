import React, { useEffect, useState } from "react";
import { TrendingUp, Pencil } from "lucide-react";
import { isAdminPreview } from "../lib/adminPreview";
import { useProfile } from "../lib/useProfile";
import { useInvestments } from "../lib/useFinancialData";
import { supabase } from "../lib/supabase";
import InvestmentsSkeleton from "../components/InvestmentsSkeleton";
import NotificationBell from "../components/NotificationBell";
import FamilyDropdown from "../components/FamilyDropdown";

const InvestmentsPage = ({ onOpenNotifications, onOpenInvest }) => {
  const { profile, loading } = useProfile();
  const { 
    totalInvestments, 
    monthlyChangePercent, 
    portfolioMix, 
    goals, 
    hasInvestments,
    loading: investmentsLoading,
    refetch
  } = useInvestments();
  const [allocations, setAllocations] = useState([]);
  const [customGoals, setCustomGoals] = useState([]);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [savingGoal, setSavingGoal] = useState(false);
  
  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    let isMounted = true;

    const loadAllocations = async () => {
      try {
        if (!supabase) {
          return;
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user) {
          return;
        }

        // allocations table removed — set empty gracefully
        if (isMounted) {
          setAllocations([]);
        }
      } catch (error) {
        console.error("Failed to load allocations", error);
      }
    };

    loadAllocations();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading || investmentsLoading) {
    return <InvestmentsSkeleton />;
  }

  const defaultPortfolioMix = [
    { label: "Equities", value: "0%" },
    { label: "Fixed income", value: "0%" },
    { label: "Crypto", value: "0%" },
    { label: "Cash", value: "0%" },
  ];

  const displayPortfolioMix = portfolioMix.length > 0 ? portfolioMix : defaultPortfolioMix;
  const hasAllocations = allocations.length > 0;
  const displayGoals = [...goals, ...customGoals];

  const handleGoalSubmit = async (event) => {
    event.preventDefault();
    if (!goalName || !goalTarget || !goalDate) return;
    setSavingGoal(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return;

      if (editingGoalId) {
        const updatePayload = {
          name: goalName,
          target_amount: Number(goalTarget),
        };
        if (goalDate) updatePayload.target_date = goalDate;

        let { error } = await supabase
          .from("investment_goals")
          .update(updatePayload)
          .eq("id", editingGoalId)
          .eq("user_id", userData.user.id);

        if (error && error.message && error.message.includes("target_date")) {
          console.warn("[goals] target_date column not found, saving without date");
          const { error: retryError } = await supabase
            .from("investment_goals")
            .update({ name: goalName, target_amount: Number(goalTarget) })
            .eq("id", editingGoalId)
            .eq("user_id", userData.user.id);
          if (retryError) console.error("[goals] Update failed:", retryError);
        } else if (error) {
          console.error("[goals] Update failed:", error);
        }
        setEditingGoalId(null);
      } else {
        const insertPayload = {
          user_id: userData.user.id,
          name: goalName,
          target_amount: Number(goalTarget),
          current_amount: 0,
          is_active: true,
        };
        if (goalDate) insertPayload.target_date = goalDate;

        const { error } = await supabase.from("investment_goals").insert(insertPayload);
        if (error) console.error("[goals] Insert failed:", error);
      }

      setGoalName("");
      setGoalTarget("");
      setGoalDate("");
      if (refetch) refetch();
    } catch (err) {
      console.error("Failed to save goal:", err);
    } finally {
      setSavingGoal(false);
    }
  };

  const handleEditGoal = (goal) => {
    setEditingGoalId(goal.id);
    setGoalName(goal.label || "");
    setGoalTarget(goal.targetAmount || "");
    setGoalDate(goal.targetDate || "");
    const formEl = document.getElementById("goal-form-section");
    if (formEl) formEl.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)] text-slate-900">
      <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-12 pt-12 text-white md:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6 md:max-w-md">
          <header className="flex items-center justify-between text-white">
            <FamilyDropdown
              profile={profile}
              userId={profile.id}
              initials={initials}
              avatarUrl={profile.avatarUrl}
              onOpenFamily={() =>
                window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "family" } }))
              }
              onSelectMember={(member) =>
                window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "memberPortfolio", member } }))
              }
            />
            <NotificationBell onClick={onOpenNotifications} />
          </header>

          <section className="glass-card p-5 text-white">
            <p className="text-xs uppercase tracking-[0.2em] text-white/70">Total Investments</p>
            <p className="mt-3 text-3xl font-semibold">
              R{totalInvestments.toLocaleString()}
            </p>
            {hasInvestments && monthlyChangePercent !== 0 && (
              <div className={`mt-4 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                monthlyChangePercent >= 0 
                  ? 'bg-emerald-400/20 text-emerald-100' 
                  : 'bg-rose-400/20 text-rose-100'
              }`}>
                {monthlyChangePercent >= 0 ? '+' : ''}{monthlyChangePercent.toFixed(1)}% this month
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mx-auto -mt-10 flex w-full max-w-sm flex-col gap-5 px-4 pb-10 md:max-w-md md:px-8">
        {!hasInvestments ? (
          <section className="rounded-3xl bg-white px-4 py-8 shadow-md text-center">
            <div className="flex h-20 w-20 mx-auto items-center justify-center rounded-full bg-violet-50 text-violet-600 mb-5">
              <TrendingUp className="h-10 w-10" />
            </div>
            <p className="text-lg font-semibold text-slate-900 mb-2">Start Your Investment Journey</p>
            <p className="text-sm text-slate-500 mb-6 max-w-xs mx-auto">
              Build wealth over time by investing in a diversified portfolio tailored to your goals.
            </p>
            <button
              type="button"
              onClick={onOpenInvest}
              className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
            >
              Make your first investment
            </button>
          </section>
        ) : (
          <>
            <section className="rounded-3xl bg-white px-4 py-5 shadow-md">
              <p className="text-sm font-semibold text-slate-700">Portfolio Mix</p>
              <p className="mt-1 text-xs text-slate-400">
                {hasInvestments ? "Balanced across major assets." : "Start investing to see your portfolio mix."}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                {displayPortfolioMix.map((item) => (
                  <div key={item.label} className="rounded-2xl bg-slate-50 px-3 py-4">
                    <p className="text-xs text-slate-400">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl bg-white px-4 py-5 shadow-md">
              <p className="text-sm font-semibold text-slate-700">Investment Goals</p>
              <p className="mt-1 text-xs text-slate-400">Track progress for your next milestone.</p>
              <div className="mt-4 space-y-4">
                {displayGoals.length > 0 ? (
                  displayGoals.map((goal) => (
                    <div key={goal.id || goal.label} className="rounded-2xl bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                        <span>{goal.label}</span>
                        <div className="flex items-center gap-2">
                          <span>{goal.progress}</span>
                          {goal.id && (
                            <button
                              type="button"
                              onClick={() => handleEditGoal(goal)}
                              className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-violet-600 active:bg-slate-300"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-slate-400">{goal.value}</p>
                        {goal.targetDate && !isNaN(new Date(goal.targetDate).getTime()) && (
                          <p className="text-xs text-slate-400">
                            • {new Date(goal.targetDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-emerald-300"
                          style={{ width: goal.progress }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center">
                    <p className="text-xs text-slate-500">No investment goals set</p>
                    <p className="text-xs text-slate-400 mt-1">Set goals to track your progress</p>
                  </div>
                )}
              </div>
            </section>

            <section id="goal-form-section" className="rounded-3xl bg-white px-4 py-5 shadow-md">
              <p className="text-sm font-semibold text-slate-700">{editingGoalId ? "Edit investment goal" : "Add an investment goal"}</p>
              <p className="mt-1 text-xs text-slate-400">Set your target amount and date.</p>
              <form className="mt-4 space-y-4" onSubmit={handleGoalSubmit}>
                <input
                  id="investment-goal-name"
                  name="investment-goal-name"
                  type="text"
                  value={goalName}
                  onChange={(event) => setGoalName(event.target.value)}
                  placeholder="Goal name (e.g. First home)"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none focus:border-violet-400"
                  required
                />
                <input
                  id="investment-goal-target"
                  name="investment-goal-target"
                  type="number"
                  min="1"
                  value={goalTarget}
                  onChange={(event) => setGoalTarget(event.target.value)}
                  placeholder="Target amount"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none focus:border-violet-400"
                  required
                />
                <input
                  id="investment-goal-date"
                  name="investment-goal-date"
                  type="date"
                  value={goalDate}
                  onChange={(event) => setGoalDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none focus:border-violet-400"
                  required
                />
                <div className="flex gap-3">
                  {editingGoalId && (
                    <button
                      type="button"
                      onClick={() => { setEditingGoalId(null); setGoalName(""); setGoalTarget(""); setGoalDate(""); }}
                      className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-600 transition-all active:scale-95"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingGoal || isAdminPreview()}
                    className={`flex-1 rounded-2xl bg-gradient-to-r from-black to-purple-600 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-lg transition-all active:scale-95 disabled:opacity-50${isAdminPreview() ? " cursor-not-allowed pointer-events-none" : ""}`}
                  >
                    {savingGoal ? "Saving..." : editingGoalId ? "Update goal" : "Add goal"}
                  </button>
                </div>
              </form>
            </section>
          </>
        )}

        {hasAllocations ? (
          <section className="rounded-3xl bg-white px-4 py-5 shadow-md">
            <p className="text-sm font-semibold text-slate-700">Allocations</p>
            <p className="mt-1 text-xs text-slate-400">Your latest portfolio allocations.</p>
            <div className="mt-4 space-y-3">
              {allocations.map((allocation) => (
                <div
                  key={allocation.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {allocation.asset_class}
                      </p>
                      <p className="text-xs text-slate-500">
                        Weight: {Number(allocation.weight || 0).toFixed(2)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">
                        {allocation.value ? `R${Number(allocation.value).toFixed(2)}` : "—"}
                      </p>
                      <p className="text-xs text-slate-500">
                        As of {allocation.as_of_date || "—"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default InvestmentsPage;
