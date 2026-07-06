import { supabaseAdmin, authenticateUser } from './_lib/supabase.js';

/**
 * GET  /api/wishlists  — fetch the signed-in user's wishlists
 * POST /api/wishlists  — overwrite the signed-in user's wishlists
 *
 * Wishlists are stored in auth.users.user_metadata so no extra table is needed.
 * The service-role admin API is used server-side, so the client never holds the
 * service-role key and RLS is not an obstacle.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({
      wishlists: data.user.user_metadata?.wishlists || [],
    });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { wishlists } = req.body || {};
    if (!Array.isArray(wishlists)) {
      return res.status(400).json({ error: 'wishlists must be an array' });
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: { wishlists },
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
