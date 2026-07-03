import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

async function resolveUserEmail(profileId, profileEmail) {
  if (profileEmail) return profileEmail;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(profileId);
      if (authUser?.user?.email) {
        return authUser.user.email;
      }
      if (error) console.warn(`[lookup-by-id] admin.getUserById attempt ${attempt} error:`, error.message);
    } catch (e) {
      console.warn(`[lookup-by-id] admin.getUserById attempt ${attempt} threw:`, e.message);
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

    const idNumber = (req.query.id_number || "").replace(/\D/g, "").trim();
    if (!/^\d{13}$/.test(idNumber)) {
      return res.status(400).json({ error: "Please enter a valid 13-digit SA ID number" });
    }

    const { data: idProfiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, mint_number, email, id_number")
      .eq("id_number", idNumber)
      .limit(1);

    if (profileError) {
      console.error("[lookup-by-id] profile error:", profileError.message);
      return res.status(500).json({ error: "Lookup failed" });
    }

    const profile = idProfiles?.[0] || null;
    if (!profile) {
      return res.status(404).json({ error: "No user found with that ID number" });
    }
    if (profile.id === user.id) {
      return res.status(400).json({ error: "You cannot gift to yourself" });
    }

    const email = await resolveUserEmail(profile.id, profile.email);
    if (!email) {
      console.error("[lookup-by-id] profile found but email unresolvable for", profile.id);
      return res.status(503).json({ error: "Could not retrieve user details — please try again" });
    }

    return res.json({
      user: {
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        email,
        mint_number: profile.mint_number || null,
      },
    });
  } catch (e) {
    console.error("[lookup-by-id] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
