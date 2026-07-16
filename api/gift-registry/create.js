import crypto from 'crypto';
import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { occasion, customOccasion, beneficiaryType, beneficiaryDisplayName, title, eventDate, expiryAt, message, familyMemberId } = req.body;
    if (!occasion || !beneficiaryType || !beneficiaryDisplayName || !title || !eventDate || !expiryAt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: registry, error } = await supabaseAdmin
      .from('gift_events')
      .insert({
        creator_user_id: user.id,
        occasion,
        custom_occasion: customOccasion || null,
        beneficiary_type: beneficiaryType,
        beneficiary_display_name: beneficiaryDisplayName,
        beneficiary_ref: familyMemberId || null,
        title,
        event_date: eventDate,
        expiry_at: expiryAt,
        message: message || null,
        status: 'ACTIVE',
        share_token: crypto.randomBytes(24).toString('base64url'),
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(200).json({ success: true, registry });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
