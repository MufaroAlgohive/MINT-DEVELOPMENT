import { supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });
  const { user, error } = await authenticateUser(req);
  if (error || !user) return res.status(401).json({ success: false, error: error || "Unauthorized" });
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Approved returns service is not configured" });

  const familyMemberId = String(req.query?.family_member_id || "").trim() || null;
  const { data: runs, error: runError } = await supabaseAdmin
    .from("return_repair_runs_c")
    .select("id,repair_key,status,methodology_version,promoted_at")
    .eq("status", "PROMOTED")
    .order("promoted_at", { ascending: false })
    .limit(1);
  if (runError) return res.status(500).json({ success: false, error: runError.message });
  const run = runs?.[0];
  if (!run) return res.status(200).json({ success: true, run: null, strategy_returns: [], client_returns: [] });

  let clientQuery = supabaseAdmin
    .from("client_strategy_returns_shadow_c")
    .select("strategy_id,as_of_date,securities_value_cents,residual_cash_cents,unused_reserve_cents,accrued_liability_cents,complete_nav_cents,gross_strategy_twr_pct,net_cash_pnl_cents,source_evidence")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .order("as_of_date", { ascending: true });
  clientQuery = familyMemberId
    ? clientQuery.eq("family_member_id", familyMemberId)
    : clientQuery.is("family_member_id", null);

  const [strategyResult, clientResult] = await Promise.all([
    supabaseAdmin.from("strategy_returns_shadow_c")
      .select('strategy_id,as_of_date,chain_nav_cents,complete_value_cents,"1d_pct","5d_pct",mtd_pct,ytd_pct')
      .eq("run_id", run.id)
      .order("as_of_date", { ascending: true }),
    clientQuery,
  ]);
  if (strategyResult.error || clientResult.error) {
    return res.status(500).json({ success: false, error: strategyResult.error?.message || clientResult.error?.message });
  }
  const clientReturns = (clientResult.data || []).map((row) => {
    const opening = Number(row.source_evidence?.opening_performance_nav_cents || 0);
    const twr = Number(row.gross_strategy_twr_pct || 0);
    return { ...row, opening_performance_nav_cents: opening, strategy_pnl_cents: Math.round(opening * twr / 100) };
  });
  return res.status(200).json({ success: true, run, strategy_returns: strategyResult.data || [], client_returns: clientReturns });
}
