import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const q = (req.query.q || '').trim();
    const type = (req.query.type || '').toUpperCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    let query = supabaseAdmin
      .from('securities_c')
      .select('id, isin, symbol, name, logo_url, last_price, instrument_type')
      .limit(limit);

    if (q) {
      query = query.or(`name.ilike.%${q}%,symbol.ilike.%${q}%,isin.ilike.%${q}%`);
    } else {
      // Default ordering by market cap / popularity proxy — order by last_price desc as approximation
      query = query.order('last_price', { ascending: false });
    }

    if (type && type !== 'ALL') {
      query = query.eq('instrument_type', type);
    }

    const { data, error } = await query;
    if (error) {
      // If instrument_type column doesn't exist, retry without that filter
      if (error.message?.includes('instrument_type') || error.code === '42703') {
        let fallbackQuery = supabaseAdmin
          .from('securities_c')
          .select('id, isin, symbol, name, logo_url, last_price')
          .limit(limit);
        if (q) {
          fallbackQuery = fallbackQuery.or(`name.ilike.%${q}%,symbol.ilike.%${q}%,isin.ilike.%${q}%`);
        } else {
          fallbackQuery = fallbackQuery.order('last_price', { ascending: false });
        }
        const { data: fallback, error: fbErr } = await fallbackQuery;
        if (fbErr) throw fbErr;
        return res.status(200).json({ results: fallback || [] });
      }
      throw error;
    }

    const results = (data || []).map(s => ({
      ...s,
      ticker: s.symbol,
      type: s.instrument_type || 'SHARE',
    }));

    return res.status(200).json({ results });
  } catch (e) {
    console.error('[markets/search]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
