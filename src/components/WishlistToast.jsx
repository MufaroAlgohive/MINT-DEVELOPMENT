import React, { useEffect } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Heart } from "lucide-react";

export default function WishlistToast({ message, visible, onHide, actionLabel, onAction }) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onHide, 4000);
    return () => clearTimeout(t);
  }, [visible, message]);

  const toast = (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed left-0 right-0 flex justify-center px-4"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)", zIndex: 99998, pointerEvents: "auto" }}
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
        >
          <div className="flex items-center gap-2.5 rounded-2xl bg-slate-900/95 px-5 py-3.5 shadow-xl backdrop-blur-sm">
            <Heart size={15} className="fill-red-400 text-red-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-white whitespace-nowrap">{message}</span>
            {actionLabel && onAction && (
              <>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button
                  onClick={() => { onHide(); onAction(); }}
                  className="text-sm font-bold text-violet-300 whitespace-nowrap active:opacity-70"
                >
                  {actionLabel}
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return ReactDOM.createPortal(toast, document.body);
}
