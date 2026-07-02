import { supabaseAdmin, supabase } from "../_lib/supabase.js";

/**
 * POST /api/onboarding/upload-bank-letter
 *
 * Accepts a base64-encoded file (PDF or Image) and uploads it to the
 * "signed-agreements" Supabase Storage bucket.
 *
 * Body: { fileBase64: string, fileType: string, accountNumber?: string, accountHolderName?: string, bankName?: string }
 * Returns: { success: true, verified: true, publicUrl: string }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = supabaseAdmin || supabase;
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    // ── Validate body ─────────────────────────────────────────────────────
    const { fileBase64, fileType } = req.body || {};
    if (!fileBase64 || typeof fileBase64 !== "string") {
      return res.status(400).json({ success: false, error: "Missing fileBase64 in request body" });
    }
    const normalizedBase64 = fileBase64.includes(",") ? fileBase64.split(",").pop() : fileBase64;
    if (!normalizedBase64) {
      return res.status(400).json({ success: false, error: "Invalid base64 data" });
    }

    // ── Decode base64 → Buffer ────────────────────────────────────────────
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(normalizedBase64, "base64");
    } catch (decodeErr) {
      return res.status(400).json({ success: false, error: "Invalid base64 data" });
    }

    if (fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "File buffer is empty" });
    }

    // ── Build storage path ────────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = fileType === "application/pdf" ? "pdf" : "png";
    const filePath = `${user.id}/bank-confirmation-${timestamp}.${extension}`;
    const bucketName = "signed-agreements";

    // ── Upload to Supabase Storage ────────────────────────────────────────
    const storageClient = supabaseAdmin || supabase;
    const { error: uploadError } = await storageClient.storage
      .from(bucketName)
      .upload(filePath, fileBuffer, {
        contentType: fileType || "application/octet-stream",
        upsert: true,
      });

    if (uploadError) {
      console.error("[upload-bank-letter] Storage upload error:", uploadError.message);
      // If bucket doesn't exist, try creating it or fall back to signed-agreements if it's more reliable
      // For now, we assume the bucket exists or should be created by the admin.
      return res.status(500).json({ success: false, error: `Storage upload failed: ${uploadError.message}` });
    }

    // ── Get public URL ────────────────────────────────────────────────────
    const { data: urlData } = storageClient.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    const publicUrl = urlData?.publicUrl || "";

    if (!publicUrl) {
      return res.status(500).json({ success: false, error: "Failed to get public URL after upload" });
    }

    // ── Update onboarding record ──────────────────────────────────────────
    const { data: onboardingRecord } = await db
      .from("user_onboarding")
      .select("id, sumsub_raw")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (onboardingRecord) {
      let raw = {};
      try {
        raw = typeof onboardingRecord.sumsub_raw === "string" 
          ? JSON.parse(onboardingRecord.sumsub_raw) 
          : (onboardingRecord.sumsub_raw || {});
      } catch {}
      
      raw.bank_letter_uploaded = true;
      raw.bank_letter_url = publicUrl;
      raw.bank_letter_uploaded_at = new Date().toISOString();
      raw.bank_letter_verified_at = new Date().toISOString();

      // Store the OBJECT, not JSON.stringify(...) — a stringified value in the
      // jsonb column becomes a string scalar that downstream merges mangle and
      // can drop sibling keys (e.g. the credit flow's).
      await db
        .from("user_onboarding")
        .update({ sumsub_raw: raw })
        .eq("id", onboardingRecord.id);
    }

    console.log(`[upload-bank-letter] Uploaded for user ${user.id}: ${publicUrl}`);
    return res.status(200).json({ success: true, verified: true, publicUrl });
  } catch (error) {
    console.error("[upload-bank-letter] Unexpected error:", error);
    return res.status(500).json({ success: false, error: error.message || "Unexpected server error" });
  }
}
