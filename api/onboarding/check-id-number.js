import { supabaseAdmin, supabase } from "../_lib/supabase.js";
import crypto from "crypto";

const SUMSUB_APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SUMSUB_SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const SUMSUB_BASE_URL = "https://api.sumsub.com";
const SUMSUB_LEVEL_NAME = process.env.SUMSUB_LEVEL_NAME || "mint-advanced-kyc";

const createSignature = (ts, method, path, body = "") => {
  const data = ts + method.toUpperCase() + path + body;
  return crypto
    .createHmac("sha256", SUMSUB_SECRET_KEY)
    .update(data)
    .digest("hex");
};

const createApplicant = async (externalUserId, levelName) => {
  const path = `/resources/applicants?levelName=${encodeURIComponent(levelName)}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ externalUserId });
  const signature = createSignature(ts, "POST", path, body);

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
      "X-App-Token": SUMSUB_APP_TOKEN,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create applicant: ${errorText}`);
  }

  return response.json();
};

function hasMatchingPackIdNumber(value, idNumber) {
  if (value == null) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasMatchingPackIdNumber(item, idNumber));
  }

  if (typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === "number" && String(nestedValue) === idNumber) {
        return true;
      }
      if (hasMatchingPackIdNumber(nestedValue, idNumber)) {
        return true;
      }
    }
  }

  return false;
}

function maskEmailAddress(email) {
  const normalized = String(email || "").trim();
  const atIndex = normalized.indexOf("@");
  if (!normalized || atIndex <= 0) return "";

  const localPart = normalized.slice(0, atIndex);
  const domainPart = normalized.slice(atIndex);
  const visiblePrefix = localPart.slice(0, 4);
  const maskedCount = Math.max(localPart.length - visiblePrefix.length, 5);
  return `${visiblePrefix}${"*".repeat(maskedCount)}${domainPart}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = supabaseAdmin || supabase;
    if (!db) return res.status(500).json({ success: false, error: "Database not available" });

    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const idNumber = String(req.body?.id_number || "").replace(/\D/g, "");
    if (!/^\d{13}$/.test(idNumber)) {
      return res.status(400).json({ success: false, error: "A valid 13-digit id_number is required" });
    }

    const { data: rows, error } = await db
      .from("user_onboarding_pack_details")
      .select("user_id, pack_details");

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const matchedRow = (rows || []).find((row) => hasMatchingPackIdNumber(row?.pack_details, idNumber));

    // An ID match is only a CONFLICT when it belongs to a DIFFERENT user. The
    // user's own ID — e.g. captured during a prior invest onboarding — is theirs
    // to reuse: invest and credit share one identity, so a returning invest user
    // can proceed straight through. Three cases:
    //   • no match            → new ID, ask/create as before
    //   • match, same user    → their own ID, reuse (not a duplicate)
    //   • match, another user → real duplicate, block
    const ownsMatch = Boolean(matchedRow) && String(matchedRow.user_id) === String(user.id);
    const exists = Boolean(matchedRow) && !ownsMatch;

    let applicantId = null;
    let reused = false;

    if (!exists) {
      if (ownsMatch) {
        // Returning invest-onboarded user: reuse their existing Sumsub applicant
        // rather than creating a duplicate one.
        reused = true;
        try {
          const { data: ob } = await db
            .from("user_onboarding")
            .select("sumsub_applicant_id")
            .eq("user_id", user.id)
            .not("sumsub_applicant_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (ob?.sumsub_applicant_id) applicantId = ob.sumsub_applicant_id;
        } catch (err) {
          console.error("[Onboarding] Failed to look up existing applicant:", err.message);
        }
      }

      if (!applicantId) {
        try {
          const applicantData = await createApplicant(user.id, SUMSUB_LEVEL_NAME);
          applicantId = applicantData.id;
        } catch (err) {
          console.error("[Onboarding] Failed to create Sumsub applicant:", err.message);
        }
      }

      // Persist the ID to the profile now, so later steps (the mandate step reads
      // profiles.id_number) don't make the user re-enter it.
      try {
        await db.from("profiles").update({ id_number: idNumber }).eq("id", user.id);
      } catch (err) {
        console.error("[Onboarding] Failed to save id_number to profile:", err.message);
      }
    }

    return res.status(200).json({ success: true, exists, reused, applicantId });
  } catch (error) {
    console.error("[Onboarding] ID precheck error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
