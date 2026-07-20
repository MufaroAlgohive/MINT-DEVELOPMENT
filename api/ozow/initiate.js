import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { amount, strategyName, strategyId, userId, userEmail, successUrl, cancelUrl, errorUrl, notifyUrl, optional4, optional5 } = req.body;

    const siteCode = process.env.OZOW_SITE_CODE;
    const privateKey = process.env.OZOW_PRIVATE_KEY;

    if (!siteCode || !privateKey) {
      return res.status(500).json({ success: false, error: "Ozow not configured. Please add OZOW_SITE_CODE and OZOW_PRIVATE_KEY." });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "Invalid payment amount." });
    }

    const countryCode = "ZA";
    const currencyCode = "ZAR";
    const amountStr = Number(amount).toFixed(2);
    const transactionRef = `MINT-${userId ? userId.substr(0, 8) : "USER"}-${Date.now()}`;
    const bankReference = "Mint Payment";
    const customer = userEmail || "";
    const optional1 = strategyId || "";
    const optional2 = userEmail || "";
    const optional3 = userId || "";
    const optional4Str = optional4 || "";
    const optional5Str = optional5 || "";
    const isTest = process.env.OZOW_IS_TEST === "true" ? "true" : "false";

    const baseUrl = process.env.APP_URL || "https://app.mymint.co.za";
    const resolvedSuccessUrl = successUrl || `${baseUrl}/?ozow=success`;
    const resolvedCancelUrl = cancelUrl || `${baseUrl}/?ozow=cancel`;
    const resolvedErrorUrl = errorUrl || `${baseUrl}/?ozow=error`;
    const resolvedNotifyUrl = notifyUrl || `${baseUrl}/api/ozow/notify`;

    // Hash order per Ozow spec:
    // SiteCode, CountryCode, CurrencyCode, Amount, TransactionReference, BankReference,
    // [Optional1-5 only if non-empty], Customer, CancelUrl, ErrorUrl, SuccessUrl, NotifyUrl, IsTest, PrivateKey
    const hashParts = [
      siteCode,
      countryCode,
      currencyCode,
      amountStr,
      transactionRef,
      bankReference,
    ];
    if (optional1) hashParts.push(optional1);
    if (optional2) hashParts.push(optional2);
    if (optional3) hashParts.push(optional3);
    if (optional4Str) hashParts.push(optional4Str);
    if (optional5Str) hashParts.push(optional5Str);
    hashParts.push(
      customer,
      resolvedCancelUrl,
      resolvedErrorUrl,
      resolvedSuccessUrl,
      resolvedNotifyUrl,
      isTest,
      privateKey,
    );

    const hashCheck = crypto.createHash("sha512").update(hashParts.join("").toLowerCase(), "utf8").digest("hex");

    console.log(`[ozow/initiate] ref=${transactionRef} amount=${amountStr} strategy=${strategyName} userId=${userId}`);

    const responsePayload = {
      success: true,
      action_url: "https://pay.ozow.com",
      SiteCode: siteCode,
      CountryCode: countryCode,
      CurrencyCode: currencyCode,
      Amount: amountStr,
      TransactionReference: transactionRef,
      BankReference: bankReference,
      Optional1: optional1,
      Optional2: optional2,
      Optional3: optional3,
      Customer: customer,
      CancelUrl: resolvedCancelUrl,
      ErrorUrl: resolvedErrorUrl,
      SuccessUrl: resolvedSuccessUrl,
      NotifyUrl: resolvedNotifyUrl,
      IsTest: isTest,
      HashCheck: hashCheck,
    };
    if (optional4Str) responsePayload.Optional4 = optional4Str;
    if (optional5Str) responsePayload.Optional5 = optional5Str;
    return res.json(responsePayload);
  } catch (err) {
    console.error("[ozow/initiate] error:", err);
    return res.status(500).json({ success: false, error: "Failed to initiate Ozow payment." });
  }
}
