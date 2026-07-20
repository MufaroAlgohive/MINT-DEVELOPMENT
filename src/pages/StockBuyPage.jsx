import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { formatCurrency } from "../lib/formatCurrency";
import GiftToggleV2 from "../components/GiftToggleV2";
import { useFees } from "../lib/useFees";

const MIN_INVESTMENT = 200;

const StockBuyPage = ({ security, onBack, onContinue, paymentMethod, onGiftDone }) => {
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();
  const { displayCurrency, priceValue } = useMemo(() => {
    const currency = security?.currency || "R";
    const normalizedCurrency = currency.toUpperCase() === "ZAC" ? "R" : currency;
    const currentPrice = Number(security?.currentPrice ?? 0);
    const normalizedPrice = currency.toUpperCase() === "ZAC" ? currentPrice / 100 : currentPrice;
    return {
      displayCurrency: normalizedCurrency,
      priceValue: Number.isFinite(normalizedPrice) ? normalizedPrice : 0,
    };
  }, [security]);

  const minShares = useMemo(() => {
    if (priceValue <= 0) return 1;
    return Math.ceil(MIN_INVESTMENT / priceValue);
  }, [priceValue]);

  const [shares, setShares] = useState(minShares);
  const [feeExpanded, setFeeExpanded] = useState(false);
  const [giftEnabled, setGiftEnabled] = useState(false);

  useEffect(() => {
    if (shares < minShares) setShares(minShares);
  }, [minShares]);

  const validShares = Number.isFinite(shares) && shares > 0 ? shares : 0;

  const totalAmount = useMemo(() => {
    const total = validShares * priceValue;
    return Number.isFinite(total) ? total : 0;
  }, [validShares, priceValue]);

  const numAssets = validShares > 0 ? 1 : 0;

  const fees = useMemo(() => {
    const bufferedBase = totalAmount * (1 + CASH_BUFFER_RATE);
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * numAssets;
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    console.log('[PRICE-DEBUG StockBuyPage] security:', JSON.stringify({ symbol: security?.symbol, currency: security?.currency, currentPrice: security?.currentPrice }));
    console.log('[PRICE-DEBUG StockBuyPage] priceValue:', priceValue, '| shares:', shares, '| totalAmount (Rand):', totalAmount);
    console.log('[PRICE-DEBUG StockBuyPage] rates — CASH_BUFFER:', CASH_BUFFER_RATE, 'BROKER:', BROKER_FEE_RATE, 'TRANSACTION:', TRANSACTION_FEE_RATE, 'ISIN_FEE_PER_ASSET:', ISIN_FEE_PER_ASSET, 'numAssets:', numAssets);
    console.log('[PRICE-DEBUG StockBuyPage] breakdown — bufferedBase:', bufferedBase.toFixed(2), 'brokerAmount:', brokerAmount.toFixed(2), 'isinTotal:', isinTotal.toFixed(2), 'transactionAmount:', transactionAmount.toFixed(2));
    console.log('[PRICE-DEBUG StockBuyPage] TOTAL COST (R):', totalCost.toFixed(2));
    return { brokerAmount, isinTotal, transactionAmount, totalCost };
  }, [totalAmount, numAssets, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE, security, priceValue, shares]);

  const isInvalid = !Number.isFinite(shares) || shares <= 0 || shares < minShares;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!security || isInvalid || giftEnabled) return;
    onContinue?.(fees.totalCost, security, totalAmount, validShares);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-sm flex-col px-4 pb-10 pt-12 md:max-w-md md:px-8">
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">Buy {security?.symbol || "Stock"}</h1>
          <div className="h-10 w-10" aria-hidden="true" />
        </header>

        <section className="mt-8 rounded-3xl bg-white p-5 shadow-md">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Price per share</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">
            {displayCurrency}{priceValue.toFixed(2)}
          </p>
        </section>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Number of shares
            </label>
            <input
              id="stock-buy-shares"
              name="stock-buy-shares"
              type="number"
              min={minShares}
              step="1"
              value={shares}
              onChange={(event) => setShares(Number(event.target.value))}
              className={`mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none focus:border-violet-400 ${isInvalid ? "border-red-300" : "border-slate-200"}`}
            />
            {isInvalid && (
              <p className="mt-1.5 text-xs text-red-500">
                Minimum {minShares} share{minShares !== 1 ? "s" : ""} required ({formatCurrency(MIN_INVESTMENT, displayCurrency)} minimum investment)
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            <div className="flex items-center justify-between">
              <span>Investment Amount</span>
              <span className="font-semibold text-slate-900">
                {displayCurrency} {totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">Total Cost</p>
            <p className="text-sm font-bold text-slate-900">{formatCurrency(fees.totalCost, displayCurrency)}</p>
          </div>

          {!giftEnabled && (
            <button
              type="submit"
              disabled={isInvalid}
              className={`w-full rounded-2xl py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-lg transition-all active:scale-95 ${isInvalid ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-black to-purple-600"}`}
            >
              Invest
            </button>
          )}

          <GiftToggleV2
            enabled={giftEnabled}
            onToggle={setGiftEnabled}
            onDone={onGiftDone}
            security={security}
            totalCostCents={Math.round(fees.totalCost * 100)}
            amountDisplay={formatCurrency(fees.totalCost, displayCurrency)}
          />
        </form>
      </div>
    </div>
  );
};

export default StockBuyPage;
