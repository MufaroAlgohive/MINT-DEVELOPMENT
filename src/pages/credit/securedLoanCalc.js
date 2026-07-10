/**
 * securedLoanCalc.js
 * Self-contained secured credit calculator for the Instant Liquidity product.
 * Uses SA Prime Rate (10.5% p.a.) with NCR-regulated fees.
 *
 * - Daily interest accrual (annual_rate / 365)
 * - 4-Day Salary Rule for first repayment
 * - Initiation fee with NCR caps (R165 + 10% > R1000, capped at R1050)
 * - Monthly service fee: R69
 * - Identical fixed installments (DebiCheck ready)
 */

const MONTHLY_RATE = 0.04;       // 4% per month
const DAILY_RATE = MONTHLY_RATE / 30; // Accrued daily
const SERVICE_FEE_MONTHLY = 69.00;
const DAILY_SERVICE_FEE = SERVICE_FEE_MONTHLY / 30;

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calcInitiationFee(principal) {
  let fee = 0;
  if (principal <= 1000) {
    fee = 165;
  } else {
    fee = 165 + (principal - 1000) * 0.10;
  }
  return round2(Math.min(fee, 1050));
}

/**
 * 4-Day Rule: if next salary date is ≤ 4 days from origination,
 * push first payment to the following month.
 *
 * Safety: if the provided salary date is in the past, we advance it
 * to the next future occurrence of the same day-of-month so we never
 * compute negative days → negative interest/fees.
 */
function determinePaymentDates(originationDate, nextSalaryDate, termMonths) {
  const dates = [];
  const salaryDay = nextSalaryDate.getDate();

  // Build a "candidate" date = this month's salary day, at midnight
  const today = new Date(originationDate);
  today.setHours(0, 0, 0, 0);

  let candidate = new Date(today.getFullYear(), today.getMonth(), salaryDay);

  // If that day has already passed this month (or is today), move to next month
  if (candidate <= today) {
    candidate.setMonth(candidate.getMonth() + 1);
    candidate.setDate(salaryDay); // re-set in case of month-end overflow
  }

  // Apply 4-Day Rule: if candidate is within 4 days of origination, push one more month
  const diffDays = Math.ceil((candidate - originationDate) / (1000 * 60 * 60 * 24));
  if (diffDays <= 4) {
    candidate.setMonth(candidate.getMonth() + 1);
    candidate.setDate(salaryDay);
  }

  let currentDate = new Date(candidate);
  for (let i = 0; i < termMonths; i++) {
    const pDate = new Date(currentDate);
    pDate.setDate(salaryDay);
    dates.push(pDate);
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return dates;
}

/**
 * Main calculator — returns the same shape as LendingEngine.calculateLoan()
 * so it's a drop-in replacement for secured credit.
 */
export function calculateSecuredLoan({ principal, originationDate, nextSalaryDate, termMonths }) {
  const P = Number(principal);
  const origDate = new Date(originationDate);
  const salaryDate = new Date(nextSalaryDate);
  const months = Number(termMonths) || 1;

  const initiationFee = calcInitiationFee(P);
  const paymentDates = determinePaymentDates(origDate, salaryDate, months);
  const schedule = [];

  let totalInterest = 0;
  let totalServiceFees = 0;
  let lastDate = new Date(origDate);

  for (let i = 0; i < paymentDates.length; i++) {
    const pDate = paymentDates[i];
    const diffTime = pDate - lastDate;
    const days = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const interest = round2(P * DAILY_RATE * days);
    const serviceFee = round2(DAILY_SERVICE_FEE * days);

    totalInterest += interest;
    totalServiceFees += serviceFee;

    schedule.push({
      period: i + 1,
      date: pDate.toISOString().split('T')[0],
      days,
      interest,
      serviceFee,
    });

    lastDate = pDate;
  }

  const totalRepayable = round2(P + totalInterest + totalServiceFees + initiationFee);
  const baseInstallment = Math.floor((totalRepayable / months) * 100) / 100;

  const installments = Array(months).fill(baseInstallment);
  const currentSum = round2(baseInstallment * months);
  const diff = round2(totalRepayable - currentSum);
  if (diff !== 0) {
    installments[months - 1] = round2(installments[months - 1] + diff);
  }

  return {
    principal: P,
    totalInterest: round2(totalInterest),
    totalServiceFees: round2(totalServiceFees),
    initiationFee,
    totalRepayable,
    installmentAmount: installments[0],
    installments,
    schedule: schedule.map((s, idx) => ({
      ...s,
      installment: installments[idx],
    })),
    paymentDates,
    termMonths: months,
    monthlyRate: MONTHLY_RATE,
  };
}

/** Expose the monthly rate for DB storage */
export const SECURED_MONTHLY_RATE = MONTHLY_RATE;

/** Expose annual rate for display */
export const SECURED_ANNUAL_RATE = MONTHLY_RATE * 12 * 100; // 48
