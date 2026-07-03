import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

async function resolveUserEmail(profileId, profileEmail) {
  if (profileEmail) return profileEmail;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(profileId);
      if (authUser?.user?.email) {
        return authUser.user.email;
      }
      if (error) console.warn(`[lookup-by-email] admin.getUserById attempt ${attempt} error:`, error.message);
    } catch (e) {
      console.warn(`[lookup-by-email] admin.getUserById attempt ${attempt} threw:`, e.message);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 200));
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase || !supabaseAdmin) {
      return res.status(500).json({ error: "Admin database client not configured" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const email = (req.query.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    if (email === (user.email || "").toLowerCase()) {
      return res.status(400).json({ error: "You cannot add yourself as a beneficiary" });
    }

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, mint_number, email")
      .ilike("email", email)
      .limit(1);

    if (profileError) {
      console.error("[lookup-by-email] profile error:", profileError.message);
      return res.status(500).json({ error: "Lookup failed" });
    }

    const profile = profiles?.[0] || null;
    if (!profile) {
      return res.json({ found: false });
    }
    if (profile.id === user.id) {
      return res.status(400).json({ error: "You cannot add yourself as a beneficiary" });
    }

    const resolvedEmail = await resolveUserEmail(profile.id, profile.email);
    return res.json({
      found: true,
      user: {
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        email: resolvedEmail || email,
        mint_number: profile.mint_number || null,
      },
    });
  } catch (e) {
    console.error("[lookup-by-email] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
