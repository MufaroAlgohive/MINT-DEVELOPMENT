const cache = new Map();
const TTL_MS = 30_000;

export async function fetchApprovedReturns(session, familyMemberId = null) {
  if (!session?.access_token) return { run: null, strategy_returns: [], client_returns: [] };
  const key = `${session.user?.id || "user"}:${familyMemberId || "parent"}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < TTL_MS) return saved.value;
  const query = familyMemberId ? `?family_member_id=${encodeURIComponent(familyMemberId)}` : "";
  try {
    const response = await fetch(`/api/returns/approved${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) throw new Error(`Approved returns request failed (${response.status})`);
    const body = await response.json();
    const value = body?.success ? body : { run: null, strategy_returns: [], client_returns: [] };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn("[approvedReturns] legacy fallback:", error.message);
    return { run: null, strategy_returns: [], client_returns: [] };
  }
}

export function clearApprovedReturnsCache() { cache.clear(); }
