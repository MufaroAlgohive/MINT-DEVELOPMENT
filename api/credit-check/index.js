import { createClient } from "@supabase/supabase-js";
import { performCreditCheck } from "../../services/creditCheckService.js";
import {
  TOTAL_LOAN_ENGINE_WEIGHT,
  extractClientDeviceMetadata,
  computeCreditScoreContribution,
  computeAdverseListingsContribution,
  computeCreditUtilizationContribution,
  computeDTIContribution,
  computeEmploymentTenureContribution,
  computeContractTypeContribution,
  computeEmploymentCategoryContribution,
  computeIncomeStabilityContribution,
  summarizeTruidSummaryData,
  computeBankStatementCashflowsContribution,
  computeAlgoHiveBehaviouralContribution
} from "../../services/loanEngine.js";

function normalizeDobForExperian(dob) {
  if (!dob) return dob;
  return String(dob).replace(/-/g, '');
}

function buildUserData(overrides = {}) {
  const base = {
    reference: 'mintcheck',
    identity_number: '',
    passport_number: '',
    surname: '',
    forename: '',
    middle_name: '',
    gender: '',
    date_of_birth: '',
    address1: '',
    address2: '',
    address3: '',
    address4: '',
    postal_code: '',
    cell_tel_no: '',
    work_tel_no: '',
    home_tel_no: '',
    email: '',
    user_id: '',
    client_ref: `MINT-${Date.now()}`
  };

  const merged = { ...base, ...(overrides || {}) };
  if (merged.date_of_birth) {
    merged.date_of_birth = normalizeDobForExperian(merged.date_of_birth);
  }
  merged.client_ref = String(merged.client_ref || `MINT${Date.now()}`).trim().slice(0, 20);

  return merged;
}

function normalizeCreditScore(result) {
  const candidates = [
    result?.extracted?.extractedCreditScore,
    typeof result?.creditScore === 'number' ? result.creditScore : result?.creditScore?.score,
    typeof result?.creditScoreData === 'number' ? result.creditScoreData : result?.creditScoreData?.score,
    result?.creditScoreData?.creditScore
  ];
  for (const c of candidates) {
    const s = Number(c);
    if (Number.isFinite(s) && s > 0) return s;
  }
  return 0;
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured on server' });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user?.id) {
    return res.status(401).json({ error: 'Invalid or expired session', details: userError?.message });
  }

  const userId = userData.user.id;

  // ── Retry cooldown: max 1 live Experian run per 30 minutes per user ──
  {
    const cooldownMs = 30 * 60 * 1000;
    const cutoff = new Date(Date.now() - cooldownMs).toISOString();
    const { data: recentRun } = await supabase
      .from('loan_engine_score')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRun?.created_at) {
      const nextEligibleAt = new Date(new Date(recentRun.created_at).getTime() + cooldownMs);
      const minsRemaining = Math.max(1, Math.ceil((nextEligibleAt - Date.now()) / 60000));
      return res.status(200).json({
        success: false,
        ok: false,
        errorCode: 'COOLDOWN_ACTIVE',
        error: `You already ran an assessment recently. Please wait ${minsRemaining} more minute${minsRemaining !== 1 ? 's' : ''} before trying again.`,
        nextEligibleAt: nextEligibleAt.toISOString(),
      });
    }
  }

  let loanApplicationId = body.loanApplicationId || body.loan_application_id || null;
  const applicationId = body.applicationId || loanApplicationId || `app_${Date.now()}`;
  const overrides = body.userData || body;
  const normalizedOverrides = {
    ...overrides,
    identity_number: overrides?.identity_number || overrides?.id_number || overrides?.identityNumber,
    surname: overrides?.surname || overrides?.last_name || overrides?.lastName,
    forename: overrides?.forename || overrides?.first_name || overrides?.firstName,
    date_of_birth: overrides?.date_of_birth || overrides?.dateOfBirth,
    address1: overrides?.address1 || overrides?.address,
    postal_code: overrides?.postal_code || overrides?.postalCode || overrides?.postcode || overrides?.zip || overrides?.zip_code,
    contract_type: overrides?.contract_type || overrides?.contractType
  };

  const mockModeEnv = process.env.EXPERIAN_MOCK === 'true';
  const maskedIdentity = normalizedOverrides?.identity_number
    ? String(normalizedOverrides.identity_number).slice(0, 6).padEnd(String(normalizedOverrides.identity_number).length, '*')
    : null;
  console.log('[credit-check/api] incoming request', {
    applicationId,
    userId,
    mockModeEnv,
    hasPostalCode: Boolean(normalizedOverrides?.postal_code),
    postalCode: normalizedOverrides?.postal_code || null,
    hasAddress1: Boolean(normalizedOverrides?.address1),
    identity: maskedIdentity
  });

  if (normalizedOverrides?.annual_income && !normalizedOverrides?.gross_monthly_income) {
    const annualIncome = Number(normalizedOverrides.annual_income);
    if (Number.isFinite(annualIncome)) {
      normalizedOverrides.gross_monthly_income = annualIncome / 12;
    }
  }

  if (normalizedOverrides?.years_in_current_job && !normalizedOverrides?.months_in_current_job) {
    const yearsValue = Number(normalizedOverrides.years_in_current_job);
    if (Number.isFinite(yearsValue)) {
      normalizedOverrides.months_in_current_job = yearsValue * 12;
    }
  }

  let truidSnapshot = null;
  if (supabase && userId) {
    try {
      const dbClient = accessToken
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
          })
        : supabase;

      const { data: snapshotData } = await dbClient
        .from('truid_bank_snapshots')
        .select('months_captured,main_salary,avg_monthly_income,avg_monthly_expenses,net_monthly_income,summary_data')
        .eq('user_id', userId)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      truidSnapshot = snapshotData || null;
      if (snapshotData) {
        const truidSummary = summarizeTruidSummaryData(snapshotData.summary_data || []);
        normalizedOverrides.truid_months_captured = snapshotData.months_captured;
        normalizedOverrides.truid_main_salary = snapshotData.main_salary;
        normalizedOverrides.truid_summary_data = snapshotData.summary_data;
        normalizedOverrides.truid_avg_monthly_income = truidSummary.monthCount
          ? truidSummary.averageMonthlyIncome
          : snapshotData.avg_monthly_income;
        normalizedOverrides.truid_avg_monthly_expenses = truidSummary.monthCount
          ? truidSummary.averageMonthlyExpenses
          : snapshotData.avg_monthly_expenses;
        normalizedOverrides.truid_net_monthly_income = truidSummary.monthCount
          ? truidSummary.averageMonthlyNetCashflow
          : snapshotData.net_monthly_income;
        normalizedOverrides.truid_average_monthly_debt_repayments = truidSummary.averageMonthlyDebtRepayments;

        if (truidSummary.monthCount) {
          normalizedOverrides.annual_income = truidSummary.averageMonthlyIncome * 12;
          normalizedOverrides.annual_expenses = truidSummary.averageMonthlyExpenses * 12;
          normalizedOverrides.gross_monthly_income = truidSummary.incomeForDti;
          normalizedOverrides.net_monthly_income = truidSummary.averageMonthlyNetCashflow;
        }
      }
    } catch (snapshotError) {
      console.warn('TruID snapshot lookup failed:', snapshotError?.message || snapshotError);
    }
  }

  // ── TruID gate: bank cashflow analysis is mandatory ──
  // Savings accounts hide real spending — only a transactional/cheque account
  // gives us the cashflow signals the engine needs.
  if (!truidSnapshot) {
    return res.status(200).json({
      success: false,
      ok: false,
      errorCode: 'TRUID_REQUIRED',
      error: 'Your primary bank account must be linked before we can run your credit assessment. Please connect a cheque or transactional account — savings accounts cannot be used for affordability scoring.',
    });
  }

  // ── PRIMARY ENRICHMENT: Sumsub pack_details (KYC-verified address/identity) ──
  if (supabase && userId) {
    try {
      const dbClient = accessToken
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
          })
        : supabase;

      const { data: packRow } = await dbClient
        .from('user_onboarding_pack_details')
        .select('pack_details')
        .eq('user_id', userId)
        .maybeSingle();

      console.log('[credit-check] pack_details row found:', !!packRow);

      const pack = packRow?.pack_details || {};
      const info = pack?.info || {};
      const review = pack?.review || pack?.reviewResult || pack?.inspectionResult || {};
      const addresses = Array.isArray(info?.addresses) ? info.addresses : [];
      const idDocs = Array.isArray(info?.idDocs) ? info.idDocs : [];

      const firstAddress = addresses.find(a => a && (a.postCode || a.street || a.town)) || null;
      const addressDoc = idDocs.find(d => d?.address?.postCode || d?.rawAddress || d?.address?.street) || null;
      const idCardDoc = idDocs.find(d => d?.number) || null;

      const packPostalCode = firstAddress?.postCode || addressDoc?.address?.postCode || null;
      const packStreet = firstAddress?.street || addressDoc?.address?.street || null;
      const packTown = firstAddress?.town || addressDoc?.address?.town || null;
      const packFormatted = firstAddress?.formattedAddress || addressDoc?.address?.formattedAddress || addressDoc?.rawAddress || null;
      const packDob = info?.dob || idCardDoc?.dob || null;
      const packIdentity = idCardDoc?.number || null;
      const packFirstName = info?.firstNameEn || info?.firstName || idCardDoc?.firstNameEn || idCardDoc?.firstName || null;
      const packLastName = info?.lastNameEn || info?.lastName || idCardDoc?.lastNameEn || idCardDoc?.lastName || null;
      const packPhone = pack?.phone || null;
      const kycResult = review?.reviewAnswer || review?.answer || review?.reviewResult || review?.status || null;

      console.log('[credit-check] pack_details extracted:', {
        packPostalCode,
        packStreet: packStreet ? packStreet.substring(0, 30) : null,
        packTown,
        packIdentity: packIdentity ? packIdentity.slice(0, 6) + '***' : null,
        packFirstName,
        packLastName,
        packDob,
        addressesCount: addresses.length,
        idDocsCount: idDocs.length
      });

      const deriveGenderFromSaId = (idValue) => {
        const raw = String(idValue || '').replace(/\D/g, '');
        if (raw.length !== 13) return null;
        const genderDigits = Number(raw.slice(6, 10));
        if (!Number.isFinite(genderDigits)) return null;
        return genderDigits >= 5000 ? 'M' : 'F';
      };
      const inferredGender = deriveGenderFromSaId(packIdentity || normalizedOverrides.identity_number);

      if (!normalizedOverrides.identity_number && packIdentity) normalizedOverrides.identity_number = packIdentity;
      if (!normalizedOverrides.forename && packFirstName) normalizedOverrides.forename = packFirstName;
      if (!normalizedOverrides.surname && packLastName) normalizedOverrides.surname = packLastName;
      if (!normalizedOverrides.date_of_birth && packDob) normalizedOverrides.date_of_birth = packDob;
      if (!normalizedOverrides.gender && inferredGender) normalizedOverrides.gender = inferredGender;
      if (!normalizedOverrides.address1 && packStreet) normalizedOverrides.address1 = packStreet;
      if (!normalizedOverrides.address2 && packTown) normalizedOverrides.address2 = packTown;
      if (!normalizedOverrides.address4 && packTown) normalizedOverrides.address4 = packTown;
      if (!normalizedOverrides.postal_code && packPostalCode) normalizedOverrides.postal_code = String(packPostalCode);
      if (!normalizedOverrides.cell_tel_no && packPhone) normalizedOverrides.cell_tel_no = packPhone;
      normalizedOverrides.kyc_has_pack_details = Boolean(packRow?.pack_details);
      normalizedOverrides.kyc_identity_verified = Boolean(packIdentity);
      normalizedOverrides.kyc_address_verified = Boolean(packPostalCode || packStreet || packFormatted);
      if (!normalizedOverrides.kyc_result && kycResult) normalizedOverrides.kyc_result = kycResult;

      if (!normalizedOverrides.address1 && packFormatted) {
        normalizedOverrides.address1 = packFormatted;
      }

      console.log('[credit-check] after pack_details enrichment, postal_code =', normalizedOverrides.postal_code || '[STILL EMPTY]');
    } catch (packError) {
      console.warn('Pack details lookup failed:', packError?.message || packError);
    }
  }

  // Profile enrichment — secondary source, fill only still-missing fields
  if (supabase && userId) {
    try {
      const dbClient = accessToken
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
          })
        : supabase;

      const { data: profile } = await dbClient
        .from('profiles')
        .select('id_number,first_name,last_name,date_of_birth,gender,phone_number,address')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        if (!normalizedOverrides.identity_number && profile.id_number) normalizedOverrides.identity_number = profile.id_number;
        if (!normalizedOverrides.surname && profile.last_name) normalizedOverrides.surname = profile.last_name;
        if (!normalizedOverrides.forename && profile.first_name) normalizedOverrides.forename = profile.first_name;
        if (!normalizedOverrides.date_of_birth && profile.date_of_birth) normalizedOverrides.date_of_birth = profile.date_of_birth;
        if (!normalizedOverrides.gender && profile.gender) normalizedOverrides.gender = profile.gender;
        if (!normalizedOverrides.cell_tel_no && profile.phone_number) normalizedOverrides.cell_tel_no = profile.phone_number;
        if (!normalizedOverrides.address1 && profile.address) normalizedOverrides.address1 = profile.address;
      }
    } catch (profileError) {
      console.warn('Profile lookup failed:', profileError?.message || profileError);
    }
  }

  // Investment activity — platform engagement signal for AlgoHive behavioural factor
  if (supabase && userId) {
    try {
      const dbClient = accessToken
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
          })
        : supabase;

      const [stockRes, strategyRes] = await Promise.all([
        dbClient
          .from('stock_holdings_c')
          .select('id')
          .eq('user_id', userId)
          .eq('Status', 'active')
          .limit(1)
          .maybeSingle(),
        dbClient
          .from('stock_holdings_c')
          .select('id')
          .eq('user_id', userId)
          .not('strategy_id', 'is', null)
          .eq('Status', 'active')
          .limit(1)
          .maybeSingle(),
      ]);

      normalizedOverrides.algohive_has_stock_holdings = Boolean(stockRes.data?.id);
      normalizedOverrides.algohive_has_strategy_investments = Boolean(strategyRes.data?.id);
    } catch (investError) {
      console.warn('Investment activity lookup failed:', investError?.message || investError);
      normalizedOverrides.algohive_has_stock_holdings = false;
      normalizedOverrides.algohive_has_strategy_investments = false;
    }
  }

  // Enrich from onboarding if employment fields missing
  if (supabase && userId) {
    try {
      const dbClient = accessToken
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
          })
        : supabase;

      const { data: onboarding } = await dbClient
        .from('user_onboarding')
        .select('employer_name,employment_type,employer_industry')
        .eq('user_id', userId)
        .maybeSingle();

      if (onboarding) {
        if (!normalizedOverrides.employment_employer_name && onboarding.employer_name) {
          normalizedOverrides.employment_employer_name = onboarding.employer_name;
        }
        if (!normalizedOverrides.contract_type && onboarding.employment_type) {
          normalizedOverrides.contract_type = onboarding.employment_type;
        }
        if (!normalizedOverrides.employment_sector_type && onboarding.employer_industry) {
          normalizedOverrides.employment_sector_type = onboarding.employer_industry;
        }
      }
    } catch (onboardingError) {
      console.warn('Onboarding lookup failed:', onboardingError?.message || onboardingError);
    }
  }

  const userPayload = buildUserData(normalizedOverrides);
  if (!userPayload.postal_code) {
    console.warn('[credit-check] postal_code missing after all enrichment — falling back to default 0152');
  }
  userPayload.postal_code = String(userPayload.postal_code || '0152').trim() || '0152';
  userPayload.user_id = overrides?.user_id || userId;

  if (!loanApplicationId && supabase && userId) {
    try {
      const dbClient = accessToken
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
          })
        : supabase;

      const { data: loanApp } = await dbClient
        .from('loan_application')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'in_progress')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (loanApp?.id) {
        loanApplicationId = loanApp.id;
      }
    } catch (lookupError) {
      console.warn('Loan application lookup failed:', lookupError?.message || lookupError);
    }
  }

  if (!userPayload.identity_number || !userPayload.surname || !userPayload.forename) {
    return res.status(400).json({ error: 'Missing required identity fields', required: ['identity_number', 'surname', 'forename'] });
  }

  try {
    const result = await performCreditCheck(userPayload, applicationId, accessToken);
    const zipDataLength = typeof result?.zipData === 'string' ? result.zipData.length : 0;
    console.log('[credit-check/api] experian response summary', {
      applicationId,
      success: result?.success === true,
      mockModeReturned: result?.mockMode,
      zipDataLength,
      message: result?.message || null,
      error: result?.error || null
    });
    if (zipDataLength > 0) {
      console.log('[credit-check/api] retdata preview:', String(result.zipData).slice(0, 120));
    }

    const creditScoreData = (result && typeof result.creditScore === 'object' && result.creditScore)
      ? result.creditScore
      : (result?.creditScoreData || result?.extracted?.creditScoreData || {});

    const creditScoreValue = normalizeCreditScore({
      ...result,
      creditScoreData,
      creditScore: creditScoreData
    });

    const accountExposure = creditScoreData?.accounts?.exposure || {};
    const accountSummary = creditScoreData?.accountSummary || {};
    const accountMetrics = {
      ...accountExposure,
      ...accountSummary,
      totalMonthlyInstallment: accountExposure.totalMonthlyInstallments ?? accountSummary.totalMonthlyInstallments ?? 0
    };

    const employmentHistory = creditScoreData?.employmentHistory || result?.employmentHistory || [];

    const deviceFingerprint = extractClientDeviceMetadata(req);

    const creditScoreBreakdown = computeCreditScoreContribution(creditScoreValue);
    const adverseListingsBreakdown = computeAdverseListingsContribution(creditScoreData);
    const creditUtilizationBreakdown = computeCreditUtilizationContribution(accountMetrics);

    const totalMonthlyDebt = accountMetrics.totalMonthlyInstallment || 0;
    const grossMonthlyIncome = Number(userPayload.gross_monthly_income || 0);
    const dtiBreakdown = computeDTIContribution(totalMonthlyDebt, grossMonthlyIncome, userPayload);

    const employmentTenureBreakdown = computeEmploymentTenureContribution(userPayload.months_in_current_job);
    const contractTypeBreakdown = computeContractTypeContribution(userPayload.contract_type);
    const employmentCategoryBreakdown = computeEmploymentCategoryContribution(userPayload);
    const incomeStabilityBreakdown = computeIncomeStabilityContribution(userPayload);
    const bankStatementCashflowsBreakdown = computeBankStatementCashflowsContribution(userPayload);
    const algoHiveBehaviouralBreakdown = computeAlgoHiveBehaviouralContribution(userPayload, deviceFingerprint);

    const breakdown = {
      creditScore: creditScoreBreakdown,
      creditUtilization: creditUtilizationBreakdown,
      adverseListings: adverseListingsBreakdown,
      incomeStability: incomeStabilityBreakdown,
      dti: dtiBreakdown,
      bankStatementCashflows: bankStatementCashflowsBreakdown,
      employmentTenure: employmentTenureBreakdown,
      employmentCategory: employmentCategoryBreakdown,
      contractType: contractTypeBreakdown,
      algoHiveBehavioural: algoHiveBehaviouralBreakdown
    };

    const experianSnapshot = {
      score: Number.isFinite(creditScoreValue) ? creditScoreValue : null,
      riskType: creditScoreData?.riskType || null,
      enquiryId: creditScoreData?.enquiryId || null,
      clientRef: creditScoreData?.clientRef || null,
      declineReasons: Array.isArray(creditScoreData?.declineReasons) ? creditScoreData.declineReasons : [],
      activities: creditScoreData?.activities || {},
      accountSummary: creditScoreData?.accountSummary || {},
      retdataLength: zipDataLength,
      xmlPreview: typeof result?.xmlContent === 'string' ? result.xmlContent.slice(0, 20000) : null,
      extractedAt: new Date().toISOString()
    };
    const engineResultPayload = {
      ...breakdown,
      experianReport: experianSnapshot
    };

    const loanEngineScore = Object.values(breakdown)
      .map(item => item?.contributionPercent)
      .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    const loanEngineScoreMax = TOTAL_LOAN_ENGINE_WEIGHT;
    const loanEngineScoreNormalized = loanEngineScoreMax > 0
      ? Math.min(100, (loanEngineScore / loanEngineScoreMax) * 100)
      : 0;

    const creditExposure = {
      totalBalance: accountMetrics.totalBalance || 0,
      totalLimits: accountMetrics.totalLimits || 0,
      revolvingBalance: accountMetrics.revolvingBalance || 0,
      revolvingLimits: accountMetrics.revolvingLimits || 0,
      totalMonthlyInstallment: accountMetrics.totalMonthlyInstallment || 0
    };

    const scoreReasons = [];

    // --- Credit bureau ---
    if (creditScoreValue < 580) scoreReasons.push('Low credit score');
    if (creditUtilizationBreakdown.ratioPercent !== null && creditUtilizationBreakdown.ratioPercent > 75) {
      scoreReasons.push('High credit utilization');
    }
    if ((adverseListingsBreakdown.totalAdverse || 0) > 0) scoreReasons.push('Adverse listings present');
    if (dtiBreakdown.dtiPercent !== null && dtiBreakdown.dtiPercent > 50) scoreReasons.push('High debt-to-income ratio');

    // --- Employment ---
    if ((employmentTenureBreakdown.monthsInCurrentJob || 0) < 6) scoreReasons.push('Short employment tenure');
    const ct = contractTypeBreakdown.contractType;
    if (ct === 'FIXED_TERM_LT_12') scoreReasons.push('Fixed-term contract under 12 months');
    else if (ct === 'PART_TIME') scoreReasons.push('Part-time employment');
    else if (ct === 'UNEMPLOYED_OR_UNKNOWN') scoreReasons.push('Employment status unverified');

    // --- Bank / income stability ---
    if (incomeStabilityBreakdown.valuePercent === 0) {
      scoreReasons.push('Bank statement not linked or insufficient income history');
    } else if (incomeStabilityBreakdown.valuePercent === 50) {
      scoreReasons.push('Partial bank history — less than 3 months captured');
    }
    if (bankStatementCashflowsBreakdown.netCashflowRatio !== null && bankStatementCashflowsBreakdown.netCashflowRatio < 0.05) {
      scoreReasons.push('Weak monthly cashflow margin');
    }
    if (bankStatementCashflowsBreakdown.volatilityRatio !== null && bankStatementCashflowsBreakdown.volatilityRatio > 0.75) {
      scoreReasons.push('High income volatility');
    }

    // --- Behavioural ---
    if (algoHiveBehaviouralBreakdown.isNewBorrower) scoreReasons.push('No prior credit history detected');
    if (!algoHiveBehaviouralBreakdown.hasAnyInvestment) scoreReasons.push('No investment activity on file');

    const success = result?.success === true;
    const ok = success;

    if (supabase && userId) {
      try {
        const dbClient = accessToken
          ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
              global: { headers: { Authorization: `Bearer ${accessToken}` } }
            })
          : supabase;

        const loanEngineInsert = {
          user_id: userId,
          loan_application_id: loanApplicationId,
          engine_score: Number.isFinite(loanEngineScoreNormalized)
            ? Math.round(loanEngineScoreNormalized)
            : null,
          score_band: creditScoreData?.riskType || 'UNKNOWN',
          experian_score: Number.isFinite(creditScoreValue) ? creditScoreValue : null,
          experian_weight: creditScoreBreakdown?.weightPercent ?? null,
          engine_total_contribution: Number.isFinite(loanEngineScore) ? loanEngineScore : null,
          annual_income: Number.isFinite(Number(normalizedOverrides?.annual_income))
            ? Number(normalizedOverrides.annual_income)
            : null,
          annual_expenses: Number.isFinite(Number(normalizedOverrides?.annual_expenses))
            ? Number(normalizedOverrides.annual_expenses)
            : null,
          years_current_employer: Number.isFinite(Number(normalizedOverrides?.years_in_current_job))
            ? Number(normalizedOverrides.years_in_current_job)
            : null,
          contract_type: normalizedOverrides?.contract_type || null,
          is_new_borrower: Boolean(normalizedOverrides?.algolend_is_new_borrower),
          employment_sector: normalizedOverrides?.employment_sector_type || null,
          employer_name: normalizedOverrides?.employment_employer_name || null,
          exposure_revolving_utilization: creditUtilizationBreakdown?.ratioPercent ?? null,
          exposure_revolving_balance: Number.isFinite(accountMetrics.revolvingBalance)
            ? accountMetrics.revolvingBalance
            : null,
          exposure_revolving_limit: Number.isFinite(accountMetrics.revolvingLimits)
            ? accountMetrics.revolvingLimits
            : null,
          exposure_total_balance: Number.isFinite(accountMetrics.totalBalance)
            ? accountMetrics.totalBalance
            : null,
          exposure_total_limit: Number.isFinite(accountMetrics.totalLimits)
            ? accountMetrics.totalLimits
            : null,
          exposure_open_accounts: Number.isFinite(accountMetrics.openAccounts)
            ? accountMetrics.openAccounts
            : null,
          score_reasons: scoreReasons,
          engine_result: engineResultPayload,
          created_at: new Date().toISOString()
        };

        const { error: insertError } = await dbClient
          .from('loan_engine_score')
          .insert(loanEngineInsert);

        if (insertError) {
          console.warn('Loan engine score insert failed:', insertError.message || insertError);
        }
      } catch (dbError) {
        console.warn('Loan engine score insert exception:', dbError?.message || dbError);
      }
    }

    return res.status(200).json({
      success,
      ok,
      applicationId,
      userId,
      creditScore: creditScoreValue,
      // Official Experian report PDF (base64) for the client-side download button.
      reportPdfBase64: result?.reportPdfBase64 || null,
      reportPdfFilename: result?.reportPdfFilename || 'experian-credit-report.pdf',
      recommendation: result?.recommendation,
      riskFlags: result?.riskFlags,
      breakdown: engineResultPayload,
      loanEngineScore,
      loanEngineScoreMax,
      loanEngineScoreNormalized,
      creditExposure,
      scoreReasons,
      employmentHistory,
      cpaAccounts: result?.cpaAccounts || [],
      deviceFingerprint,
      raw: result,
      ...(process.env.DEBUG_RESPONSES === 'true' ? {
        debug: {
          source: 'api/credit-check',
          mockModeEnv,
          mockModeReturned: result?.mockMode,
        }
      } : {})
    });
  } catch (error) {
    console.error('Credit check API error:', error);
    return res.status(500).json({ error: error.message || 'Credit check failed' });
  }
}
