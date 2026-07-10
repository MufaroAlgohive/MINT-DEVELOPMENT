import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Check, ChevronLeft, Landmark, CreditCard,
  TrendingDown, X, ArrowRight, ShieldCheck, UploadCloud
} from "lucide-react";
import { motion, AnimatePresence } from 'framer-motion';
import { formatZar } from "../../lib/formatCurrency";
import { supabase } from "../../lib/supabase";

const RepayLiquidity = ({ onBack, profile, fonts }) => {
  // --- CORE STATE ---
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLoan, setSelectedLoan] = useState(null);

  // --- FLOW & MODAL STATE ---
  const [showEftModal, setShowEftModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [portalTarget, setPortalTarget] = useState(null);

  // --- PAYMENT UPLOAD STATE ---
  const [paymentAmount, setPaymentAmount] = useState("");
  const [popFile, setPopFile] = useState(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // --- DATA FETCHING ---
  const fetchRepayable = async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('loan_application')
        .select('*')
        .neq('status', 'repaid')
        .eq('user_id', profile.id)
        .eq('Secured_Unsecured', 'secured')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLoans(data || []);
    } catch (err) {
      console.error("Error fetching loans:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepayable();
  }, [profile?.id]);

  // --- PAYMENT PROCESSING (UPLOAD + DB UPDATE) ---
  const handleProcessPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      alert("Please enter a valid payment amount.");
      return;
    }
    if (!popFile) {
      alert("Please upload your Proof of Payment document.");
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Upload Document to Storage
      const fileExt = popFile.name.split('.').pop();
      const fileName = `pop-${selectedLoan.id}-${Date.now()}.${fileExt}`;
      const filePath = `${profile.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, popFile);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      // 2. Insert Record into loan_documents
      const { error: docError } = await supabase.from('loan_documents').insert({
        user_id: profile.id,
        loan_application_id: selectedLoan.id,
        document_name: popFile.name,
        document_url: publicUrlData.publicUrl,
        document_type: 'proof_of_payment'
      });

      if (docError) throw docError;

      // 3. Update loan balance
      const newPrincipal = Math.max(0, selectedLoan.principal_amount - amount);
      const newStatus = newPrincipal === 0 ? 'repaid' : selectedLoan.status;

      const { error: loanError } = await supabase
        .from('loan_application')
        .update({ principal_amount: newPrincipal, status: newStatus })
        .eq('id', selectedLoan.id);

      if (loanError) throw loanError;

      // 4. INSERT INTO LEDGER (CRITICAL FOR HISTORY PAGE)
      const { error: historyError } = await supabase
        .from('credit_transactions_history')
        .insert({
          user_id: profile.id,
          loan_application_id: selectedLoan.id,
          loan_type: 'secured',
          transaction_type: 'repayment',
          direction: 'debit',
          amount: amount,
          description: 'Facility Settlement (EFT)',
          occurred_at: new Date().toISOString()
        });

      if (historyError) throw historyError;

      // 5. Cleanup & Show Success
      setShowEftModal(false);
      setPopFile(null);
      setPaymentAmount("");
      setIsSuccess(true);
    } catch (err) {
      console.error("Payment processing failed", err);
      alert("Payment failed. Please ensure storage buckets are correctly configured.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- SUCCESS SCREEN ---
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center animate-in slide-in-from-bottom-4 duration-500">
        <div className="h-24 w-24 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-8 shadow-inner border border-emerald-100">
          <Check size={48} strokeWidth={3} />
        </div>
        <h2 className="text-3xl font-bold mb-3 text-slate-900 tracking-tight" style={{ fontFamily: fonts?.display }}>
          Payment Submitted
        </h2>
        <p className="text-xs text-slate-500 mb-10 leading-relaxed max-w-[260px] font-medium">
          Your settlement is being processed. Our team will verify your Proof of Payment and update your ledger.
        </p>
        <button
          onClick={onBack}
          className="w-full max-w-xs py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl active:scale-95 transition-all"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const totalDebt = loans.reduce((sum, loan) => sum + Number(loan.principal_amount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-32 relative text-slate-900 overflow-x-hidden">
      {/* Sticky Header */}
      <div className="px-5 pt-14 pb-6 sticky top-0 bg-slate-50/80 backdrop-blur-xl z-30 border-b border-slate-100/50">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm active:scale-95 transition-all"
          >
            <ChevronLeft size={20} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: fonts?.display }}>Repay Capital</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {loading ? "Syncing ledgers..." : `Settle Active Facilities`}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-6">
        {/* Premium Summary Card */}
        <div className="bg-gradient-to-br from-[#0d0d12] via-[#25173e] to-[#5b21b6] rounded-[32px] p-6 text-white shadow-xl relative overflow-hidden mb-8">
          <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

          <div className="relative z-10 flex justify-between items-start">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/60 mb-2">Total Outstanding Debt</p>
              <div className="min-h-[40px] flex items-center">
                {loading ? <div className="h-9 w-40 bg-white/20 animate-pulse rounded-xl" /> : <p className="text-4xl font-light tracking-tight drop-shadow-md" style={{ fontFamily: fonts?.display }}>{formatZar(totalDebt)}</p>}
              </div>
            </div>
            <div className="h-12 w-12 rounded-[18px] bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-lg">
              <Landmark size={20} className="text-violet-300" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Active Obligations</h2>
        </div>

        {/* Loans List */}
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="w-full bg-white rounded-[32px] p-6 shadow-sm border border-slate-100 animate-pulse">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-slate-100"></div>
                      <div>
                        <div className="h-2 w-16 bg-slate-100 rounded mb-1"></div>
                        <div className="h-4 w-24 bg-slate-100 rounded"></div>
                      </div>
                    </div>
                    <div className="h-6 w-20 bg-slate-100 rounded-full"></div>
                  </div>
                  <div className="pt-4 border-t border-slate-100/80 flex justify-between items-end">
                    <div>
                      <div className="h-2 w-24 bg-slate-100 rounded mb-2"></div>
                      <div className="h-8 w-32 bg-slate-100 rounded"></div>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="h-2 w-10 bg-slate-100 rounded mb-1"></div>
                      <div className="h-4 w-16 bg-slate-100 rounded"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : loans.length === 0 ? (
            <div className="bg-white rounded-[36px] p-10 text-center border border-slate-100 shadow-sm mt-4 animate-in fade-in duration-700">
              <div className="h-20 w-20 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-6 text-slate-300">
                <ShieldCheck size={32} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">No Active Obligations</h3>
              <p className="text-xs text-slate-500 font-medium mb-8 leading-relaxed">
                You have no active loans to settle. Utilize your portfolio to generate instant capital.
              </p>
              <button
                onClick={onBack}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex justify-center items-center gap-2 active:scale-95 transition-all"
              >
                Start Application <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            loans.map(loan => {
              const isSelected = selectedLoan?.id === loan.id;

              return (
                <button
                  key={loan.id}
                  onClick={() => setSelectedLoan(isSelected ? null : loan)}
                  className={`w-full text-left bg-white rounded-[32px] p-6 shadow-sm border transition-all duration-300 ${isSelected
                    ? 'border-violet-500 bg-violet-50/30 ring-4 ring-violet-500/10 scale-[0.98]'
                    : 'border-slate-100 hover:border-violet-200'
                    }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors ${isSelected ? 'bg-violet-600 text-white shadow-md' : 'bg-violet-50 text-violet-600 border border-violet-100'}`}>
                        {isSelected ? <Check size={18} strokeWidth={3} /> : <CreditCard size={18} />}
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Facility ID</p>
                        <p className="font-mono text-sm font-bold text-slate-900">#{loan.id.slice(0, 8)}</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 text-[9px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                      Unsettled
                    </span>
                  </div>

                  <div className="pt-4 border-t border-slate-100/80 flex justify-between items-end">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Outstanding</p>
                      <p className="text-2xl font-bold text-slate-900 tracking-tight" style={{ fontFamily: fonts?.display }}>
                        {formatZar(loan.principal_amount)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Term</p>
                      <p className="text-xs font-bold text-slate-900">{loan.number_of_months} Month(s)</p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Floating Action Bar */}
      <AnimatePresence>
        {selectedLoan && !isProcessing && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-24 left-0 right-0 z-40 px-5"
          >
            <div className="bg-slate-900 text-white p-4 rounded-[28px] shadow-2xl flex items-center justify-between border border-white/10 backdrop-blur-md">
              <div className="pl-2">
                <p className="font-bold text-sm">Settle Facility</p>
                <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                  #{selectedLoan.id.slice(0, 8)}
                </p>
              </div>
              <button
                onClick={() => {
                  setPaymentAmount((selectedLoan.amount_repayable / selectedLoan.number_of_months).toFixed(2));
                  setPopFile(null);
                  setShowEftModal(true);
                }}
                className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-violet-600/30 flex items-center gap-2"
              >
                Proceed
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- MINT EFT PAYMENT MODAL --- */}
      {showEftModal && selectedLoan && portalTarget && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <button className="absolute inset-0" onClick={() => !isProcessing && setShowEftModal(false)} />

          <div className="relative w-full max-w-sm bg-white rounded-[36px] p-8 shadow-2xl animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
            <button
              disabled={isProcessing}
              onClick={() => setShowEftModal(false)}
              className="absolute top-6 right-6 h-8 w-8 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={16} />
            </button>

            <div className="h-14 w-14 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center mb-6 border border-violet-100">
              <Landmark size={24} />
            </div>

            <h3 className="text-xl font-bold text-slate-900 mb-1" style={{ fontFamily: fonts?.display }}>EFT Repayment</h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              Transfer funds to the MINT account and upload your POP to settle.
            </p>

            {/* ── Loan Summary Section ── */}
            {(() => {
              const principal = Number(selectedLoan.principal_amount || 0);
              const totalRepayable = Number(selectedLoan.amount_repayable || 0);
              const months = Number(selectedLoan.number_of_months || 1);
              const monthlyDue = totalRepayable > 0 ? totalRepayable / months : 0;
              const interestRate = Number(selectedLoan.interest_rate || 0.04);
              const monthlyRatePct = interestRate * 100;
              const amountPaid = Math.max(0, totalRepayable - principal);
              const progressPct = totalRepayable > 0 ? Math.min(100, (amountPaid / totalRepayable) * 100) : 0;
              const nextDate = selectedLoan.first_repayment_date
                ? new Date(selectedLoan.first_repayment_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                : 'TBD';
              const originDate = selectedLoan.created_at
                ? new Date(selectedLoan.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—';

              return (
                <div className="mb-6">
                  {/* Hero amount card */}
                  <div className="bg-gradient-to-br from-[#0d0d12] via-[#25173e] to-[#5b21b6] rounded-[24px] p-5 text-white mb-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-violet-500/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
                    <div className="relative z-10">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/50 mb-1">This Month's Instalment</p>
                      <p className="text-3xl font-light tracking-tight mb-4" style={{ fontFamily: fonts?.display }}>
                        {formatZar(monthlyDue)}
                      </p>
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/40 mb-0.5">Outstanding Balance</p>
                          <p className="text-sm font-bold text-white">{formatZar(principal)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/40 mb-0.5">Total Repayable</p>
                          <p className="text-sm font-bold text-white">{formatZar(totalRepayable)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
                      <span>Repayment Progress</span>
                      <span className="text-violet-600">{progressPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${progressPct}%`,
                          background: progressPct >= 75 ? '#10b981' : progressPct >= 40 ? '#6d28d9' : '#6d28d9'
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-400 mt-1.5 font-medium">
                      <span>Paid: {formatZar(amountPaid)}</span>
                      <span>Remaining: {formatZar(principal)}</span>
                    </div>
                  </div>

                  {/* Detail grid */}
                  <div className="bg-slate-50 rounded-[20px] p-4 border border-slate-100 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loan Term</span>
                      <span className="text-xs font-bold text-slate-900">{months} Month{months > 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Interest Rate</span>
                      <span className="text-xs font-bold text-slate-900">{monthlyRatePct > 0 ? `${monthlyRatePct.toFixed(2)}% p.m.` : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Next Payment</span>
                      <span className="text-xs font-bold text-violet-600">{nextDate}</span>
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t border-slate-200/60">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Originated</span>
                      <span className="text-xs font-bold text-slate-900">{originDate}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Bank Details from Account Confirmation PDF */}
            <div className="bg-slate-50 rounded-[24px] p-5 mb-6 border border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bank</span>
                <span className="text-xs font-bold text-slate-900">Capitec Business</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account Name</span>
                <span className="text-xs font-bold text-slate-900">ALGOHIVE PTY LTD</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account No.</span>
                <span className="text-xs font-bold text-slate-900 font-mono">1053045883</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Branch Code</span>
                <span className="text-xs font-bold text-slate-900 font-mono">450105</span>
              </div>
              <div className="pt-4 border-t border-slate-200/60 flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-violet-600">Reference</span>
                <span className="text-xs font-black text-slate-900 font-mono bg-violet-100 px-2.5 py-1 rounded-lg">
                  MINT-{selectedLoan.id.slice(0, 6).toUpperCase()}
                </span>
              </div>
            </div>

            {/* Custom Payment Amount */}
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 pl-2">Payment Amount</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">R</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-10 pr-4 font-bold text-slate-900 outline-none focus:border-violet-500 transition-colors shadow-sm"
                />
              </div>
            </div>

            {/* Proof of Payment Upload */}
            <div className="mb-8">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 pl-2">Proof of Payment</label>
              <div className="relative overflow-hidden w-full bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center p-4 shadow-sm hover:bg-slate-100 transition-colors cursor-pointer group">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setPopFile(e.target.files[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex items-center gap-3 text-slate-500 group-hover:text-violet-600 transition-colors">
                  <UploadCloud size={20} />
                  <span className="text-xs font-bold truncate max-w-[200px]">
                    {popFile ? popFile.name : "Tap to Upload File"}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleProcessPayment}
              disabled={isProcessing || !paymentAmount || !popFile}
              className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-40"
            >
              {isProcessing ? "Uploading & Processing..." : "Submit Payment"}
            </button>
          </div>
        </div>
        , portalTarget)}
    </div>
  );
};

export default RepayLiquidity;