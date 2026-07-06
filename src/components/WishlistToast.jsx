import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart } from "lucide-react";

export default function WishlistToast({ message, visible, onHide }) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onHide, 3000);
    return () => clearTimeout(t);
  }, [visible, message]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-[72px] left-0 right-0 z-[70] flex justify-center px-4 pointer-events-none"
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
        >
          <div className="flex items-center gap-2.5 rounded-2xl bg-slate-900/95 px-5 py-3 shadow-xl backdrop-blur-sm">
            <Heart size={14} className="fill-red-400 text-red-400 flex-shrink-0" />
            <span className="text-sm font-medium text-white whitespace-nowrap">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
