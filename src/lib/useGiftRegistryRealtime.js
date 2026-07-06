import { useEffect } from "react";
import { supabaseReady } from "./supabase.js";

/**
 * Subscribe to live updates for gift_registry_items belonging to an event.
 * When any item updates (filled / reserved quantity changes), onItemUpdate
 * is called with the new row so the UI can update progress bars without
 * a full page refresh.
 *
 * Decision 5: does NOT cancel HELD reservations when event expires —
 * sweeper handles that on its own 10-minute TTL.
 */
export function useGiftRegistryRealtime(eventId, onItemUpdate) {
  useEffect(() => {
    if (!eventId) return;

    let channel;
    let cancelled = false;

    supabaseReady.then((supabase) => {
      if (cancelled) return;
      channel = supabase
        .channel(`registry:${eventId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "gift_registry_items",
            filter: `gift_event_id=eq.${eventId}`,
          },
          (payload) => {
            if (typeof onItemUpdate === "function") {
              onItemUpdate(payload.new);
            }
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      supabaseReady.then((supabase) => {
        if (channel) supabase.removeChannel(channel);
      });
    };
  }, [eventId, onItemUpdate]);
}
