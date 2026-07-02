// Credit Check Service - Experian Integration
import axios from "axios";
import xml2js from "xml2js";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Use the ephemeral /tmp volume so this works on serverless (no repo writes allowed).
const TMP_DIR = process.env.TMPDIR || '/tmp';
const DATA_DIR = path.join(TMP_DIR, 'credit-checks');
const DATA_FILE = path.join(DATA_DIR, 'credit-checks.json');

// Experian API Configuration
const EXPERIAN_CONFIG = {
    url: process.env.EXPERIAN_URL || 'https://apis.experian.co.za/NormalSearchService',
    username: process.env.EXPERIAN_USERNAME,
    password: process.env.EXPERIAN_PASSWORD,
    version: process.env.EXPERIAN_VERSION || '1.0',
    origin: process.env.EXPERIAN_ORIGIN || 'Zwane',
    origin_version: process.env.EXPERIAN_ORIGIN_VERSION || '0.0.1',
    mockMode: process.env.EXPERIAN_MOCK === 'true'
};

/* ── Experian payload helpers (ported from reference) ── */

function toYyyyMmDdCompact(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (/^\d{8}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replace(/-/g, '');
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10).replace(/-/g, '');
    }
    return '';
}

/**
 * Normalise all consumer fields to exact Experian spec before building SOAP.
 * - gender → single uppercase char (M / F)
 * - date_of_birth → YYYYMMDD compact
 * - address, phone, name fallbacks unified
 */
function normalizeExperianPayload(userData = {}) {
    const normalizedGender = String(userData.gender || '').toUpperCase();
    const gender = normalizedGender.startsWith('F') ? 'F' : (normalizedGender.startsWith('M') ? 'M' : '');

    return {
        ...userData,
        identity_number: userData.identity_number || userData.id_number || '',
        surname: userData.surname || userData.last_name || '',
        forename: userData.forename || userData.first_name || '',
        gender,
        date_of_birth: toYyyyMmDdCompact(userData.date_of_birth),
        address1: userData.address1 || userData.street_address || userData.address || '',
        address2: userData.address2 || userData.suburb_area || userData.suburb || '',
        postal_code: userData.postal_code || userData.postalCode || userData.postcode || userData.zip || userData.zip_code || '',
        cell_tel_no: userData.cell_tel_no || userData.cell_phone || userData.contact_number || '',
        passport_flag: userData.passport_flag || 'N'
    };
}

/**
 * Throw with a descriptive message listing any of the 7 fields Experian requires.
 */
function assertRequiredExperianFields(userData = {}) {
    const requiredFields = [
        ['identity_number', 'ID Number'],
        ['surname', 'Surname'],
        ['forename', 'First Name'],
        ['gender', 'Gender'],
        ['date_of_birth', 'Date of Birth'],
        ['address1', 'Street Address'],
        ['postal_code', 'Postal Code']
    ];

    const missing = requiredFields
        .filter(([key]) => !userData[key] || !String(userData[key]).trim())
        .map(([, label]) => label);

    if (missing.length > 0) {
        throw new Error(`Missing required Experian fields: ${missing.join(', ')}`);
    }
}

function toArray(value) {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function parseAmount(rawValue) {
    if (rawValue === null || rawValue === undefined) {
        return 0;
    }

    if (typeof rawValue === 'number') {
        return Number.isFinite(rawValue) ? rawValue : 0;
    }

    const sanitized = String(rawValue).replace(/[,\s]/g, '');
    const parsed = parseFloat(sanitized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function deriveCreditLimit(row = {}) {
    const limitFields = [
        row.CREDIT_LIMIT,
        row.CURRENT_LIMIT,
        row.LIMIT,
        row.HIGH_CREDIT,
        row.HIGH_BAL,
        row.OPEN_BAL
    ];

    for (const candidate of limitFields) {
        const value = parseAmount(candidate);
        if (value > 0) {
            return value;
        }
    }

    return 0;
}

function categorizeAccount(row = {}) {
    const typeCode = String(row.ACCOUNT_TYPE || '').trim().toUpperCase();
    const typeDesc = String(row.ACCOUNT_TYPE_DESC || '').trim().toLowerCase();

    if (['C', 'R'].includes(typeCode) || /credit card|revolving|overdraft/.test(typeDesc)) {
        return 'revolving';
    }

    if (['P', 'T', 'I', '2', '3'].includes(typeCode) || /loan|installment|instalment|term/.test(typeDesc)) {
        return 'installment';
    }

    return 'other';
}

function normalizeAccountRow(row = {}, source = 'CPA') {
    const category = categorizeAccount(row);
    const statusCode = (row.STATUS_CODE || '').trim().toUpperCase();
    const statusDesc = (row.STATUS_CODE_DESC || row.STATUS_DESC || '').trim();
    const isClosed = statusCode === 'C' || /closed/i.test(statusDesc);
    const isInArrears = parseAmount(row.ARREARS_PERIOD) > 0 || parseAmount(row.OVERDUE_AMOUNT) > 0;

    return {
        source,
        subscriberCode: row.SUBSCRIBER_CODE || '',
        subscriberName: row.SUBSCRIBER_NAME || '',
        accountNumber: row.ACCOUNT_NO || '',
        subAccountNumber: row.SUB_ACCOUNT_NO || '',
        accountType: row.ACCOUNT_TYPE || '',
        accountTypeDesc: row.ACCOUNT_TYPE_DESC || '',
        category,
        reason: row.REASON_DESC || row.REASON || '',
        paymentType: row.PAYMENT_TYPE_DESC || row.PAYMENT_TYPE || '',
        openDate: row.OPEN_DATE || '',
        lastPaymentDate: row.LAST_PAYMENT_DATE || '',
        statusCode,
        statusDesc,
        isClosed,
        isInArrears,
        repaymentFrequency: row.REPAYMENT_FREQ_DESC || row.REPAYMENT_FREQ || '',
        terms: parseInt(row.TERMS, 10) || 0,
        installmentAmount: parseAmount(row.INSTALMENT_AMOUNT),
        creditLimit: deriveCreditLimit(row),
        openingBalance: parseAmount(row.OPEN_BAL),
        currentBalance: parseAmount(row.CURRENT_BAL),
        overdueAmount: parseAmount(row.OVERDUE_AMOUNT),
        arrearsPeriod: parseInt(row.ARREARS_PERIOD, 10) || 0,
        paymentHistory: row.PAYMENT_HISTORY_STATUS || row.PAYMENT_HISTORY || '',
        monthEndDate: row.MONTH_END_DATE || '',
        dateCreated: row.DATE_CREATED || ''
    };
}

function normalizeAccountCollection(section = {}, sourceLabel = 'CPA') {
    const rows = toArray(section?.ROW);
    return rows.map(row => normalizeAccountRow(row, sourceLabel));
}

function buildExposureSummary(accountList = []) {
    return accountList.reduce((summary, account) => {
        summary.totalAccounts += 1;
        if (!account.isClosed) {
            summary.openAccounts += 1;
        } else {
            summary.closedAccounts += 1;
        }

        summary.totalBalance += account.currentBalance;
        summary.totalLimits += account.creditLimit;

        if (account.category === 'revolving') {
            summary.revolvingAccounts += 1;
            summary.revolvingBalance += account.currentBalance;
            summary.revolvingLimits += account.creditLimit;
        } else if (account.category === 'installment') {
            summary.installmentAccounts += 1;
            summary.installmentBalance += account.currentBalance;
        } else {
            summary.otherAccounts += 1;
        }

        if (account.isInArrears) {
            summary.delinquentAccounts += 1;
        }

        if (account.installmentAmount > 0) {
            summary.totalMonthlyInstallments += account.installmentAmount;
        }

        return summary;
    }, {
        totalAccounts: 0,
        openAccounts: 0,
        closedAccounts: 0,
        delinquentAccounts: 0,
        totalBalance: 0,
        totalLimits: 0,
        totalMonthlyInstallments: 0,
        revolvingAccounts: 0,
        revolvingBalance: 0,
        revolvingLimits: 0,
        installmentAccounts: 0,
        installmentBalance: 0,
        otherAccounts: 0
    });
}

function calculateExposureMetrics(accountList = []) {
    const summary = buildExposureSummary(accountList);
    const ratio = summary.revolvingLimits > 0
        ? summary.revolvingBalance / summary.revolvingLimits
        : null;

    return {
        ...summary,
        revolvingUtilizationRatio: ratio,
        revolvingUtilizationPercent: ratio === null ? null : ratio * 100
    };
}

function normalizeEmployerRow(row = {}) {
    return {
        employerName: row.EMP_NAME || row.EMPLOYER_NAME || '',
        occupation: row.OCCUPATION || '',
        employerType: row.EMP_TYPE || row.EMPLOYER_TYPE || '',
        salaryFrequency: row.SALARY_FREQ || '',
        payslipReference: row.PAYSLIP_REF || '',
        employeeNumber: row.EMPLOYEE_NO || '',
        activeDate: row.EMP_DATE || row.ACTIVE_DATE || '',
        dateCreated: row.DATE_CREATED || '',
        source: row.SOURCE || ''
    };
}

function normalizeEmployerCollection(section = {}) {
    return toArray(section?.ROW).map(normalizeEmployerRow);
}

function normalizeDeclineReason(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') {
        return null;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
        return null;
    }

    const separatorMatch = trimmed.match(/^([A-Za-z0-9]+)\s*[-:]\s*(.+)$/);
    if (separatorMatch) {
        return {
            code: separatorMatch[1].toUpperCase(),
            description: separatorMatch[2].trim(),
            raw: trimmed
        };
    }

    const fallbackCode = trimmed.split(/\s+/)[0].toUpperCase();
    return {
        code: fallbackCode,
        description: trimmed,
        raw: trimmed
    };
}

function extractDeclineReasons(compuScoreRow = {}) {
    const candidateFields = [
        'DECLINE_R_1',
        'DECLINE_R_2',
        'DECLINE_R_3',
        'DECLINE_R_4',
        'DECLINE_R_5',
        'REASON_1',
        'REASON_2',
        'REASON_3',
        'REASON_4',
        'REASON_5'
    ];

    return candidateFields
        .map(field => normalizeDeclineReason(compuScoreRow[field]))
        .filter(Boolean);
}

/**
 * Build SOAP XML request for Experian credit check
 */
function buildCreditCheckXML(userData) {
    const {
        identity_number,
        surname,
        forename,
        forename2 = '',
        forename3 = '',
        gender,
        date_of_birth, // Format: YYYYMMDD
        address1,
        address2 = '',
        address3 = '',
        address4 = '',
        postal_code,
        home_tel_code = '',
        home_tel_no = '',
        work_tel_code = '',
        work_tel_no = '',
        cell_tel_no = '',
        client_ref,
        passport_flag = 'N'
    } = userData;

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webServices/">
   <soapenv:Header/>
   <soapenv:Body>
      <web:DoNormalEnquiry>
         <request>
            <pUsrnme>${EXPERIAN_CONFIG.username}</pUsrnme>
            <pPasswrd>${EXPERIAN_CONFIG.password}</pPasswrd>
            <pVersion>${EXPERIAN_CONFIG.version}</pVersion>
            <pOrigin>${EXPERIAN_CONFIG.origin}</pOrigin>
            <pOrigin_Version>${EXPERIAN_CONFIG.origin_version}</pOrigin_Version>
            <pInput_Format>XML</pInput_Format>
            <pTransaction>
<![CDATA[
<Transactions>
<Search_Criteria>
<CS_Data>Y</CS_Data>
<CPA_Plus_NLR_Data>Y</CPA_Plus_NLR_Data>
<Deeds_Data>N</Deeds_Data>
<Directors_Data>N</Directors_Data>
<Identity_number>${identity_number}</Identity_number>
<Surname>${surname}</Surname>
<Forename>${forename}</Forename>
<Forename2>${forename2}</Forename2>
<Forename3>${forename3}</Forename3>
<Gender>${gender}</Gender>
<Passport_flag>${passport_flag}</Passport_flag>
<DateOfBirth>${date_of_birth}</DateOfBirth>
<Address1>${address1}</Address1>
<Address2>${address2}</Address2>
<Address3>${address3}</Address3>
<Address4>${address4}</Address4>
<PostalCode>${postal_code}</PostalCode>
<HomeTelCode>${home_tel_code}</HomeTelCode>
<HomeTelNo>${home_tel_no}</HomeTelNo>
<WorkTelCode>${work_tel_code}</WorkTelCode>
<WorkTelNo>${work_tel_no}</WorkTelNo>
<CellTelNo>${cell_tel_no}</CellTelNo>
<ResultType>XPDF2</ResultType>
<RunCodix>N</RunCodix>
<CodixParams>
<PARAMS>
<PARAM_NAME></PARAM_NAME>
<PARAM_VALUE></PARAM_VALUE>
</PARAMS>
</CodixParams>
<PinPointParams>
<PARAMS>
<PARAM_NAME></PARAM_NAME>
<PARAM_VALUE></PARAM_VALUE>
</PARAMS>
</PinPointParams>
<Adrs_Mandatory>Y</Adrs_Mandatory>
<Enq_Purpose>12</Enq_Purpose>
<Run_CompuScore>Y</Run_CompuScore>
<ClientConsent>Y</ClientConsent>
<ClientRef>${client_ref}</ClientRef>
</Search_Criteria>
</Transactions>]]></pTransaction>
         </request>
      </web:DoNormalEnquiry>
   </soapenv:Body>
</soapenv:Envelope>`;
}

function sanitizeClientRef(value) {
    const raw = String(value ?? '').trim();
    const fallback = `MINT${Date.now()}`;
    const base = raw || fallback;
    return base.slice(0, 20);
}

/**
 * Parse Experian SOAP response and extract retdata
 */
async function parseExperianResponse(soapResponse) {
    const parser = new xml2js.Parser({ explicitArray: false });
    
    try {
        const result = await parser.parseStringPromise(soapResponse);
        
        // Navigate through SOAP envelope to find retdata
        // Handle different namespace prefixes (soapenv: or S:)
        const envelope = result['soapenv:Envelope'] || result['S:Envelope'] || result['Envelope'];
        if (!envelope) {
            throw new Error('No SOAP envelope found in response');
        }
        
        const body = envelope['soapenv:Body'] || envelope['S:Body'] || envelope['Body'];
        if (!body) {
            throw new Error('No SOAP body found in response');
        }
        
        const response = body['ns2:DoNormalEnquiryResponse'] || 
                        body['web:DoNormalEnquiryResponse'] || 
                        body['DoNormalEnquiryResponse'];
        
        if (!response) {
            throw new Error('No DoNormalEnquiryResponse found in response');
        }
        
        const transReply = response['TransReplyClass'] || response['return'];
        const retdata = transReply?.retData || transReply?.retdata;
        
        if (!retdata) {
            // Dump TransReply so we can diagnose Experian error codes
            const trKeys = transReply ? Object.keys(transReply) : [];
            console.error('[experian] ⚠️  No retdata in TransReply. Keys present:', trKeys);
            if (transReply?.errorCode || transReply?.errorString) {
                console.error('[experian]    errorCode:', transReply.errorCode);
                console.error('[experian]    errorString:', transReply.errorString);
            }
            if (transReply?.transactionCompleted !== undefined) {
                console.error('[experian]    transactionCompleted:', transReply.transactionCompleted);
            }
            // Print full TransReply for debugging
            console.error('[experian]    full TransReply:', JSON.stringify(transReply, null, 2));
            throw new Error(
                transReply?.errorString
                    ? `Experian error ${transReply.errorCode}: ${transReply.errorString}`
                    : 'No retdata found in Experian response'
            );
        }
        
        return retdata;
    } catch (error) {
        console.error('[experian] Error parsing SOAP response:', error);
        throw error;
    }
}

/**
 * Decode base64 retdata and extract PDF/XML from ZIP
 */
async function decodeReportAssets(retdata) {
    try {
        // Decode base64 to buffer
        const decodedData = Buffer.from(retdata, 'base64');

        // Extract ZIP contents
        const zip = new AdmZip(decodedData);
        const zipEntries = zip.getEntries();
        
        let pdfBuffer = null;
        let pdfFilename = null;
        let xmlContent = null;
        let xmlFilename = null;
        
        console.log(`ZIP contains ${zipEntries.length} files`);
        
        for (const entry of zipEntries) {
            console.log(`  - ${entry.entryName}`);
            
            if (entry.entryName.endsWith('.pdf')) {
                pdfBuffer = entry.getData();
                pdfFilename = entry.entryName;
                console.log('PDF extracted in-memory');
            } else if (entry.entryName.endsWith('.xml')) {
                xmlContent = entry.getData().toString('utf-8');
                xmlFilename = entry.entryName;
                console.log('XML extracted in-memory');
            }
        }
        
        return {
            pdfBuffer,
            pdfFilename,
            xmlContent,
            xmlFilename,
            success: true
        };
    } catch (error) {
        console.error('Error decoding/extracting ZIP:', error);
        throw error;
    }
}

/**
 * Extract comprehensive credit data from XML response
 */
async function extractCreditScore(xmlData) {
    const parser = new xml2js.Parser({ explicitArray: false });
    
    try {
        const result = await parser.parseStringPromise(xmlData);
        const root = result?.ROOT;
        
        if (!root) {
            console.error('No ROOT element found in XML');
            return null;
        }
        
        // 1. CompuSCORE - Primary Credit Score
        const compuScore = root.EnqCC_CompuSCORE?.ROW || {};
        
        // 2. Identity Verification
        const identity = root.EnqCC_DMATCHES?.ROW || {};
        
        // 3. Activity Summary
        const activities = root.EnqCC_ACTIVITIES?.ROW || {};
        
        // 4. Statistics (Adverse Events by Time Period)
        const stats = root.EnqCC_STATS?.ROW || {};
        
        // 5. Enquiry Counts
        const enqCounts = root.EnqCC_ENQ_COUNTS?.ROW || {};
        
        // 6. Search Criteria (What was submitted)
        const searchCriteria = root.EnqCC_SRCHCRITERIA?.ROW || {};
        
        // 7. NLR Summary (National Loans Register)
        const nlrSummary = root.EnqCC_NLR_SUMMARY?.Summary || {};
        const nlr12 = nlrSummary.NLR_Past_12_Months || {};
        const nlr24 = nlrSummary.NLR_Past_24_Months || {};
        const cca12 = nlrSummary.CCA_Past_12_Months || {};
        
        // 8. Previous Enquiries (convert array or single object to array)
        let previousEnquiries = [];
        if (root.EnqCC_PREVENQ?.ROW) {
            previousEnquiries = Array.isArray(root.EnqCC_PREVENQ.ROW) 
                ? root.EnqCC_PREVENQ.ROW 
                : [root.EnqCC_PREVENQ.ROW];
        }

        const cpaAccounts = normalizeAccountCollection(root.EnqCC_CPA_ACCOUNTS, 'CPA');
        const nlrAccounts = normalizeAccountCollection(root.EnqCC_NLR_ACCOUNTS, 'NLR');
        const allAccounts = [...cpaAccounts, ...nlrAccounts];
        const creditExposure = calculateExposureMetrics(allAccounts);
        const employmentHistory = normalizeEmployerCollection(root.EnqCC_EMPLOYER);
        
        return {
            // Basic Score Info
            score: parseInt(compuScore.SCORE) || 0,
            riskType: compuScore.RISK_TYPE || 'UNKNOWN',
            declineReasons: extractDeclineReasons(compuScore),
            thinFileIndicator: compuScore.THIN_FILE_INDICATOR || 'N',
            version: compuScore.VERSION || '',
            scoreType: compuScore.SCORE_TYPE || '',
            
            // Reference Numbers
            enquiryId: root.Enquiry_ID || '',
            clientRef: root.Client_Ref || '',
            
            // Identity Verification
            identity: {
                idNumber: identity.ID_NUMBER || '',
                name: identity.NAME || '',
                surname: identity.SURNAME || '',
                status: identity.STATUS || 'Unknown',
                deceasedDate: identity.DECEASED_DATE || null,
                countryCode: identity.COUNTRY_CODE || ''
            },
            
            // Activity Summary
            activities: {
                enquiries: parseInt(activities.ENQUIRIES) || 0,
                loans: parseInt(activities.LOANS) || 0,
                judgements: parseInt(activities.JUDGEMENTS) || 0,
                notices: parseInt(activities.NOTICES) || 0,
                collections: parseInt(activities.COLLECTIONS) || 0,
                adminOrders: parseInt(activities.ADMINORDERS) || 0,
                balance: parseInt(activities.BALANCE) || 0,
                installment: parseInt(activities.INSTALLMENT) || 0
            },
            
            // Statistics - Adverse Events Over Time
            adverseStats: {
                judgements12M: parseInt(stats.CC_JUDGE_12_CNT) || 0,
                judgements24M: parseInt(stats.CC_JUDGE_24_CNT) || 0,
                judgements36M: parseInt(stats.CC_JUDGE_36_CNT) || 0,
                notices12M: parseInt(stats.CC_NOTICE_12_CNT) || 0,
                notices24M: parseInt(stats.CC_NOTICE_24_CNT) || 0,
                notices36M: parseInt(stats.CC_NOTICE_36_CNT) || 0,
                adverse12M: parseInt(stats.CC_ADVERSE_12_CNT) || 0,
                adverse24M: parseInt(stats.CC_ADVERSE_24_CNT) || 0,
                adverse36M: parseInt(stats.CC_ADVERSE_36_CNT) || 0,
                adverseTotal: parseInt(stats.CC_ADVERSE_TOT) || 0
            },
            
            // Enquiry Counts by Type
            enquiryCounts: {
                addresses: parseInt(enqCounts.ADDR) || 0,
                adminOrders: parseInt(enqCounts.ADMORDS) || 0,
                collections: parseInt(enqCounts.COLLECTIONS) || 0,
                directMatches: parseInt(enqCounts.DMATCHES) || 0,
                judgements: parseInt(enqCounts.JUDGE) || 0,
                notices: parseInt(enqCounts.NOTICES) || 0,
                possibleMatches: parseInt(enqCounts.PMATCHES) || 0,
                previousEnquiries: parseInt(enqCounts.PREV_ENQ) || 0,
                telephoneNumbers: parseInt(enqCounts.TPHONE) || 0,
                employers: parseInt(enqCounts.EMPLOYERS) || 0,
                fraudAlerts: parseInt(enqCounts.FRAUDALERT) || 0
            },
            
            // NLR (National Loans Register) Data
            nlr: {
                past12Months: {
                    enquiriesByClient: parseInt(nlr12.Enquiries_by_client) || 0,
                    enquiriesByOthers: parseInt(nlr12.Enquiries_by_other) || 0,
                    positiveLoans: parseInt(nlr12.Positive_loans) || 0,
                    highestMonthsArrears: parseInt(nlr12.Highest_months_in_arrears) || 0
                },
                past24Months: {
                    enquiriesByClient: parseInt(nlr24.Enquiries_by_client) || 0,
                    enquiriesByOthers: parseInt(nlr24.Enquiries_by_other) || 0,
                    positiveLoans: parseInt(nlr24.Positive_loans) || 0,
                    highestMonthsArrears: parseInt(nlr24.Highest_months_in_arrears) || 0
                },
                worstMonthsArrears: parseInt(nlrSummary.NLR_WorstMonthsArrears) || 0,
                activeAccounts: parseInt(nlrSummary.NLR_ActiveAccounts) || 0,
                balanceExposure: parseInt(nlrSummary.NLR_BalanceExposure) || 0,
                monthlyInstallment: parseInt(nlrSummary.NLR_MonthlyInstallment) || 0,
                cumulativeArrears: parseInt(nlrSummary.NLR_CumulativeArrears) || 0,
                closedAccounts: parseInt(nlrSummary.NLR_ClosedAccounts) || 0
            },
            
            // CCA (Credit Consumers Act) Data
            cca: {
                past12Months: {
                    enquiriesByClient: parseInt(cca12.Enquiries_by_client) || 0,
                    enquiriesByOthers: parseInt(cca12.Enquiries_by_other) || 0,
                    positiveLoans: parseInt(cca12.Positive_loans) || 0,
                    highestMonthsArrears: parseInt(cca12.Highest_months_in_arrears) || 0
                },
                worstMonthsArrears: parseInt(nlrSummary.CCA_WorstMonthsArrears) || 0,
                activeAccounts: parseInt(nlrSummary.CCA_ActiveAccounts) || 0,
                balanceExposure: parseInt(nlrSummary.CCA_BalanceExposure) || 0,
                monthlyInstallment: parseInt(nlrSummary.CCA_MonthlyInstallment) || 0,
                cumulativeArrears: parseInt(nlrSummary.CCA_CumulativeArrears) || 0,
                closedAccounts: parseInt(nlrSummary.CCA_ClosedAccounts) || 0
            },
            
            // Account Type Summaries
            accountSummary: {
                adverseAccounts: parseInt(nlrSummary.AdverseAccounts) || 0,
                revolvingAccounts: parseInt(nlrSummary.RevolvingAccounts) || 0,
                instalmentAccounts: parseInt(nlrSummary.InstalmentAccounts) || 0,
                openAccounts: parseInt(nlrSummary.OpenAccounts) || 0,
                highestJudgement: parseInt(nlrSummary.HighestJudgement) || 0,
                totalAccounts: creditExposure.totalAccounts,
                closedAccounts: creditExposure.closedAccounts,
                delinquentAccounts: creditExposure.delinquentAccounts,
                totalBalance: creditExposure.totalBalance,
                totalLimits: creditExposure.totalLimits,
                revolvingBalance: creditExposure.revolvingBalance,
                revolvingLimits: creditExposure.revolvingLimits,
                revolvingUtilizationRatio: creditExposure.revolvingUtilizationRatio,
                revolvingUtilizationPercent: creditExposure.revolvingUtilizationPercent,
                installmentBalance: creditExposure.installmentBalance
            },

            accounts: {
                cpa: cpaAccounts,
                nlr: nlrAccounts,
                exposure: creditExposure
            },

            employmentHistory,
            
            // Previous Credit Enquiries (last 5 only to avoid too much data)
            previousEnquiries: previousEnquiries.slice(0, 5).map(enq => ({
                date: enq.ENQUIRY_DATE || '',
                branch: enq.BRANCH_NAME || '',
                contactPerson: enq.CONTACT_PERSON || '',
                telephone: enq.TELEPHONE_NUMBER || ''
            })),
            
            // Search Criteria (for verification)
            searchInfo: {
                idNumber: searchCriteria.CRIT_IDNUMBER || '',
                name: searchCriteria.CRIT_NAME || '',
                surname: searchCriteria.CRIT_SURNAME || '',
                dob: searchCriteria.DOB || '',
                gender: searchCriteria.GENDER || '',
                address: searchCriteria.ADDRESS || '',
                enquiryPurpose: searchCriteria.ENQUIRY_PURPOSE || '',
                loanAmount: parseInt(searchCriteria.LOAN_AMOUNT) || 0,
                netIncome: parseInt(searchCriteria.NET_INCOME) || 0
            },
            
            // Legacy fields for backward compatibility
            totalEnquiries: parseInt(activities.ENQUIRIES) || 0,
            totalLoans: parseInt(activities.LOANS) || 0,
            totalJudgements: parseInt(activities.JUDGEMENTS) || 0,
            totalCollections: parseInt(activities.COLLECTIONS) || 0
        };
        
    } catch (error) {
        console.error('Error extracting credit score:', error);
        return null;
    }
}

/**
 * Main function: Perform credit check
 */
async function performCreditCheck(userData, applicationId, authToken = null) {
    try {
        console.log('[experian] Starting credit check for application:', applicationId);
        console.log('[experian] Endpoint:', EXPERIAN_CONFIG.url);
        console.log('[experian] Mock mode:', EXPERIAN_CONFIG.mockMode);
        console.log('[experian] Credentials present — username:', Boolean(EXPERIAN_CONFIG.username), 'password:', Boolean(EXPERIAN_CONFIG.password));

        if (EXPERIAN_CONFIG.mockMode) {
            console.log('Experian mock mode enabled - returning synthetic payload');
            const mockXml = buildMockXmlPayload(userData, applicationId);
            const creditScore = buildMockCreditScore(userData, applicationId);

            const savedRecord = await saveCreditCheckToDatabase(
                creditScore,
                userData.user_id,
                applicationId,
                mockXml,
                authToken
            );

            return {
                success: true,
                creditScore,
                zipData: Buffer.from(mockXml).toString('base64'),
                xmlContent: mockXml,
                databaseId: savedRecord.id,
                recommendation: savedRecord.recommendation,
                riskFlags: savedRecord.risk_flags,
                message: 'Mock credit check completed successfully',
                mockMode: true
            };
        }
        
        // Guard: throw early if credentials are missing (don't silently mock)
        if (!EXPERIAN_CONFIG.username || !EXPERIAN_CONFIG.password) {
            throw new Error('Experian credentials are missing. Set EXPERIAN_USERNAME and EXPERIAN_PASSWORD in environment variables.');
        }

        // Normalise all consumer fields to Experian spec before building SOAP
        const experianPayload = normalizeExperianPayload(userData);
        assertRequiredExperianFields(experianPayload);

        console.log('[experian] Payload — identity:', experianPayload.identity_number ? String(experianPayload.identity_number).slice(0, 6) + '...' : 'MISSING',
            '| gender:', experianPayload.gender || 'MISSING',
            '| dob:', experianPayload.date_of_birth || 'MISSING',
            '| postal_code:', experianPayload.postal_code || 'MISSING',
            '| address1:', experianPayload.address1 ? 'present' : 'MISSING');

        // Build SOAP XML request
        const soapRequest = buildCreditCheckXML({
            ...experianPayload,
            client_ref: sanitizeClientRef(applicationId)
        });

        console.log('[experian] Sending SOAP request to Experian...');
        console.log('[experian] SOAP Request:\n', soapRequest);
        
        // Send SOAP request to Experian
        const response = await axios.post(EXPERIAN_CONFIG.url, soapRequest, {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': 'DoNormalEnquiry'
            },
            timeout: 30000 // 30 second timeout
        });
        
        console.log('[experian] Received response — status:', response.status);
        console.log('[experian] Response headers:', JSON.stringify(response.headers, null, 2));
        console.log('[experian] SOAP Response Body:\n', response.data);
        
        // Parse response and extract retdata
        const retdata = await parseExperianResponse(response.data);
        const retdataLen = typeof retdata === 'string' ? retdata.length : 0;
        console.log('[experian] retdata length:', retdataLen);
        if (retdataLen > 0) {
            console.log('[experian] retdata preview (first 200):', String(retdata).slice(0, 200));
        }
        
        // Decode and extract ZIP contents
        const { pdfBuffer, pdfFilename, xmlContent } = await decodeReportAssets(retdata);
        console.log('[experian] Credit report assets extracted:', { pdfFilename });
        
        // Display the extracted XML
        if (xmlContent) {
            console.log('[experian] ========================================');
            console.log('[experian] DECODED XML FROM ZIP:');
            console.log('[experian] ========================================');
            console.log(xmlContent);
            console.log('[experian] ========================================');

            // Extract credit score from XML
            const creditScore = await extractCreditScore(xmlContent);
            console.log('[experian] Extracted creditScore object:', JSON.stringify(creditScore, null, 2));
            
            // Save to database (pass auth token if available)
            const savedRecord = await saveCreditCheckToDatabase(
                creditScore, 
                userData.user_id, 
                applicationId, 
                xmlContent,
                authToken
            );
            
            return {
                success: true,
                creditScore,
                zipData: retdata, // Include ZIP data as base64 for download
                zipDataLength: typeof retdata === 'string' ? retdata.length : 0,
                xmlContent,
                // The official Experian report PDF, pulled straight out of the
                // returned ZIP — surfaced so the client can download proof of the
                // exact bureau result (XPDF2 ResultType requests it).
                reportPdfBase64: pdfBuffer ? pdfBuffer.toString('base64') : null,
                reportPdfFilename: pdfFilename || 'experian-credit-report.pdf',
                databaseId: savedRecord.id,
                recommendation: savedRecord.recommendation,
                riskFlags: savedRecord.risk_flags,
                message: 'Credit check completed successfully',
                mockMode: false
            };
        } else {
            throw new Error('No XML content found in ZIP');
        }
        
    } catch (error) {
        console.error('[experian] ❌ Credit check failed:', error.message);
        console.error('[experian] Error details:', {
            code: error.code,
            message: error.message,
            responseData: error.response?.data || null,
            stack: error.stack
        });
        
        return {
            success: false,
            error: error.message,
            errorCode: error.code,
            message: 'Credit check failed',
            mockMode: EXPERIAN_CONFIG.mockMode
        };
    }
}

/**
 * Save credit check results to database
 */
async function saveCreditCheckToDatabase(creditScoreData = {}, userId, applicationId, xmlContent = '', authToken = null) {
    try {
        console.log('Persisting credit check result locally...');

        await fs.promises.mkdir(DATA_DIR, { recursive: true });

        let history = [];
        if (fs.existsSync(DATA_FILE)) {
            try {
                const existing = await fs.promises.readFile(DATA_FILE, 'utf-8');
                history = existing ? JSON.parse(existing) : [];
            } catch (parseError) {
                console.warn('Failed to parse existing credit check history, starting fresh.');
            }
        }

        const identity = creditScoreData.identity || {};
        const activities = creditScoreData.activities || {};
        const nlr = creditScoreData.nlr || {};
        const cca = creditScoreData.cca || {};
        const nlrPast12 = nlr.past12Months || {};
        const ccaPast12 = cca.past12Months || {};
        const accountSummary = creditScoreData.accountSummary || {};
        const accountExposure = creditScoreData.accounts?.exposure || {};
        const previousEnquiries = creditScoreData.previousEnquiries || [];

        const totalAccountsEstimate = accountSummary.totalAccounts ?? accountExposure.totalAccounts ?? activities.loans ?? 0;
        const openAccountsEstimate = accountSummary.openAccounts ?? accountExposure.openAccounts ?? ((nlr.activeAccounts || 0) + (cca.activeAccounts || 0));
        const closedAccountsEstimate = accountSummary.closedAccounts ?? accountExposure.closedAccounts ?? ((nlr.closedAccounts || 0) + (cca.closedAccounts || 0));
        const totalBalanceEstimate = accountSummary.totalBalance ?? accountExposure.totalBalance ?? ((nlr.balanceExposure || 0) + (cca.balanceExposure || 0));
        const totalMonthlyPaymentEstimate = accountExposure.totalMonthlyInstallments ?? accountSummary.totalMonthlyInstallments ?? ((nlr.monthlyInstallment || 0) + (cca.monthlyInstallment || 0));
        const delinquentAccountsEstimate = accountSummary.adverseAccounts ?? accountExposure.delinquentAccounts ?? 0;

        const recordId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

        const record = {
            id: recordId,
            user_id: userId,
            application_id: applicationId,
            report_reference: creditScoreData.enquiryId || `MOCK-${applicationId}`,
            report_date: new Date().toISOString(),
            bureau_name: 'Experian',
            first_name: identity.name || '',
            last_name: identity.surname || '',
            id_number: identity.idNumber || '',
            credit_score: creditScoreData.score || 0,
            score_band: creditScoreData.riskType || 'UNKNOWN',
            risk_category: calculateRiskCategory(creditScoreData.score || 0),
            total_accounts: totalAccountsEstimate,
            open_accounts: openAccountsEstimate,
            closed_accounts: closedAccountsEstimate,
            total_balance: totalBalanceEstimate,
            total_monthly_payment: totalMonthlyPaymentEstimate,
            total_arrears_amount: (nlr.cumulativeArrears || 0) + (cca.cumulativeArrears || 0),
            accounts_in_good_standing: Math.max(openAccountsEstimate - delinquentAccountsEstimate, 0),
            accounts_with_arrears: delinquentAccountsEstimate,
            accounts_in_default: 0,
            total_enquiries: activities.enquiries || 0,
            enquiries_last_3_months: nlrPast12.enquiriesByOthers || 0,
            enquiries_last_6_months: nlrPast12.enquiriesByOthers || 0,
            enquiries_last_12_months: (nlrPast12.enquiriesByOthers || 0) + (ccaPast12.enquiriesByOthers || 0),
            total_judgments: activities.judgements || 0,
            total_judgment_amount: accountSummary.highestJudgement || 0,
            raw_xml_data: xmlContent,
            parsed_accounts: creditScoreData,
            parsed_enquiries: previousEnquiries,
            score_reasons: creditScoreData.declineReasons || [],
            risk_flags: identifyRiskFlags(creditScoreData),
            recommendation: calculateRecommendation(creditScoreData),
            recommendation_reason: getRecommendationReason(creditScoreData),
            status: 'completed',
            checked_at: new Date().toISOString()
        };

        history.push(record);
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(history, null, 2), 'utf-8');

        console.log('Credit check saved to local history:', record.id);
        return record;

    } catch (error) {
        console.error('Failed to save credit check:', error);
        throw error;
    }
}

/**
 * Calculate risk category from score
 */
function calculateRiskCategory(score) {
    if (score >= 700) return 'Low Risk';
    if (score >= 600) return 'Medium Risk';
    if (score >= 500) return 'High Risk';
    return 'Very High Risk';
}

/**
 * Identify risk flags
 */
function identifyRiskFlags(creditData = {}) {
    const flags = [];
    const score = creditData.score || 0;
    const activities = creditData.activities || {};
    const nlr = creditData.nlr || {};
    const cca = creditData.cca || {};
    const accountSummary = creditData.accountSummary || {};
    const nlrPast12 = nlr.past12Months || {};
    
    if (score < 500) flags.push('Very Low Credit Score');
    if (score >= 500 && score < 600) flags.push('Low Credit Score');
    if ((activities.judgements || 0) > 0) flags.push(`${activities.judgements} Judgment(s)`);
    if ((nlr.cumulativeArrears || 0) > 5000) flags.push(`High NLR Arrears (R${nlr.cumulativeArrears})`);
    if ((cca.cumulativeArrears || 0) > 5000) flags.push(`High CCA Arrears (R${cca.cumulativeArrears})`);
    if ((accountSummary.adverseAccounts || 0) > 0) flags.push(`${accountSummary.adverseAccounts} Adverse Account(s)`);
    if ((nlrPast12.enquiriesByOthers || 0) > 3) flags.push('Multiple Recent Credit Enquiries');
    
    return flags;
}

/**
 * Calculate recommendation
 */
function calculateRecommendation(creditData = {}) {
    const score = creditData.score || 0;
    const activities = creditData.activities || {};
    const nlr = creditData.nlr || {};
    const cca = creditData.cca || {};
    const accountSummary = creditData.accountSummary || {};
    const nlrPast12 = nlr.past12Months || {};

    const judgements = activities.judgements || 0;
    const arrears = (nlr.cumulativeArrears || 0) + (cca.cumulativeArrears || 0);
    const adverseAccounts = accountSummary.adverseAccounts || 0;

    if (score < 500) return 'decline';
    if (judgements > 0) return 'decline';
    if (adverseAccounts > 2) return 'decline';
    if (arrears > 10000) return 'decline';

    if (score < 600) return 'review';
    if (arrears > 5000) return 'review';
    if (adverseAccounts > 0) return 'review';
    if ((nlrPast12.enquiriesByOthers || 0) > 3) return 'review';

    return 'approve';
}

/**
 * Get recommendation reason
 */
function getRecommendationReason(creditData = {}) {
    const recommendation = calculateRecommendation(creditData);
    const flags = identifyRiskFlags(creditData);
    const nlr = creditData.nlr || {};
    const cca = creditData.cca || {};
    const activeAccounts = (nlr.activeAccounts || 0) + (cca.activeAccounts || 0);

    if (recommendation === 'approve') {
        return `Good credit profile: Score ${creditData.score || 0}, ${activeAccounts} active accounts, no major adverse events.`;
    }

    const reasons = flags.length ? flags.join(', ') : 'Insufficient data';

    if (recommendation === 'decline') {
        return `High risk profile: ${reasons}`;
    }

    return `Manual review required: ${reasons}`;
}

function buildMockXmlPayload(userData = {}, applicationId) {
    const idNumber = userData.identity_number || '0000000000000';
    return `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <Enquiry_ID>MOCK-${applicationId}</Enquiry_ID>
  <Client_Ref>${applicationId}</Client_Ref>
  <Identity_Number>${idNumber}</Identity_Number>
  <Surname>${userData.surname || 'DOE'}</Surname>
  <Forename>${userData.forename || 'JOHN'}</Forename>
  <Generated>${new Date().toISOString()}</Generated>
</ROOT>`;
}

function buildMockCreditScore(userData = {}, applicationId) {
    const identityNumber = userData.identity_number || '0000000000000';
    const seed = parseInt(identityNumber.slice(-4), 10) || 0;
    const baseScore = 580 + (seed % 140);
    const score = Math.min(780, Math.max(480, baseScore));
    const riskType = score >= 700 ? 'LOW_RISK' : score >= 620 ? 'MEDIUM_RISK' : 'HIGH_RISK';
    const adverseAccounts = riskType === 'HIGH_RISK' ? 2 : riskType === 'MEDIUM_RISK' ? 1 : 0;
    const cumulativeArrears = riskType === 'HIGH_RISK' ? 12000 : riskType === 'MEDIUM_RISK' ? 3500 : 0;
    const enquiriesByOthers = riskType === 'HIGH_RISK' ? 6 : riskType === 'MEDIUM_RISK' ? 4 : 1;
    const judgements = riskType === 'HIGH_RISK' ? 1 : 0;

    return {
        score,
        riskType,
        thinFileIndicator: 'N',
        version: '1.0',
        scoreType: 'CompuScore',
        enquiryId: `MOCK-${applicationId}`,
        clientRef: applicationId.toString(),
        identity: {
            idNumber: identityNumber,
            name: userData.forename || 'John',
            surname: userData.surname || 'Doe',
            status: 'Match',
            deceasedDate: null,
            countryCode: 'ZA'
        },
        activities: {
            enquiries: enquiriesByOthers + 1,
            loans: 3,
            judgements,
            notices: 0,
            collections: adverseAccounts,
            adminOrders: 0,
            balance: 185000,
            installment: 4200
        },
        adverseStats: {
            judgements12M: judgements,
            judgements24M: judgements,
            judgements36M: judgements,
            notices12M: adverseAccounts,
            notices24M: adverseAccounts,
            notices36M: adverseAccounts,
            adverse12M: adverseAccounts,
            adverse24M: adverseAccounts,
            adverse36M: adverseAccounts,
            adverseTotal: adverseAccounts
        },
        enquiryCounts: {
            addresses: 1,
            adminOrders: 0,
            collections: adverseAccounts,
            directMatches: 1,
            judgements,
            notices: adverseAccounts,
            possibleMatches: 0,
            previousEnquiries: enquiriesByOthers + 1,
            telephoneNumbers: 1,
            employers: 1,
            fraudAlerts: 0
        },
        nlr: {
            past12Months: {
                enquiriesByClient: 1,
                enquiriesByOthers,
                positiveLoans: 2,
                highestMonthsArrears: adverseAccounts ? 2 : 0
            },
            past24Months: {
                enquiriesByClient: 2,
                enquiriesByOthers: enquiriesByOthers + 1,
                positiveLoans: 3,
                highestMonthsArrears: adverseAccounts ? 3 : 0
            },
            worstMonthsArrears: adverseAccounts ? 3 : 0,
            activeAccounts: 4 - adverseAccounts,
            balanceExposure: 125000,
            monthlyInstallment: 3800,
            cumulativeArrears,
            closedAccounts: adverseAccounts,
            NLR_WorstMonthsArrears: adverseAccounts ? 3 : 0,
            NLR_ActiveAccounts: 4 - adverseAccounts,
            NLR_BalanceExposure: 125000,
            NLR_MonthlyInstallment: 3800,
            NLR_CumulativeArrears: cumulativeArrears,
            NLR_ClosedAccounts: adverseAccounts
        },
        cca: {
            past12Months: {
                enquiriesByClient: 0,
                enquiriesByOthers: Math.max(0, enquiriesByOthers - 1),
                positiveLoans: 1,
                highestMonthsArrears: adverseAccounts ? 1 : 0
            },
            worstMonthsArrears: adverseAccounts ? 2 : 0,
            activeAccounts: 1,
            balanceExposure: 18000,
            monthlyInstallment: 950,
            cumulativeArrears: Math.max(0, cumulativeArrears - 1500),
            closedAccounts: 1
        },
        accountSummary: {
            adverseAccounts,
            revolvingAccounts: 1,
            instalmentAccounts: 2,
            openAccounts: 3,
            highestJudgement: judgements ? 25000 : 0
        },
        previousEnquiries: [
            {
                date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10),
                branch: 'Mock Finance',
                contactPerson: 'Agent Smith',
                telephone: '0105551234'
            }
        ],
        searchInfo: {
            idNumber: identityNumber,
            name: userData.forename || 'John',
            surname: userData.surname || 'Doe',
            dob: userData.date_of_birth || '19900101',
            gender: userData.gender || 'U',
            address: userData.address1 || 'Unknown',
            enquiryPurpose: '12',
            loanAmount: 50000,
            netIncome: 28000
        },
        totalEnquiries: enquiriesByOthers + 1,
        totalLoans: 3,
        totalJudgements: judgements,
        totalCollections: adverseAccounts
    };
}

export {
    performCreditCheck,
    buildCreditCheckXML,
    parseExperianResponse,
    decodeReportAssets,
    extractCreditScore,
    saveCreditCheckToDatabase
};
