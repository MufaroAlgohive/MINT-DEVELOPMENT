import React, { useState } from "react";
import { registryShareUrl } from "../lib/giftRegistryUtils.js";

/**
 * Share sheet for a published registry.
 * Shows WhatsApp, copy-link, and native share (if available).
 */
export default function GiftRegistryShareSheet({ token, title, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = registryShareUrl(token);
  const message = `🎁 ${title} — gift shares from my MINT registry!\n${url}`;

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleWhatsApp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  }

  async function handleNativeShare() {
    try {
      await navigator.share({ title, text: `Gift shares via my MINT registry!`, url });
    } catch {
      handleCopy();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-t-3xl px-6 pt-6 pb-10 shadow-2xl animate-slide-up">
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        <h3 className="text-base font-semibold text-gray-800 mb-1">Share your registry</h3>
        <p className="text-sm text-gray-500 mb-5">Anyone with the link can view and gift.</p>

        {/* URL pill */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mb-5">
          <span className="flex-1 text-xs text-gray-600 truncate">{url}</span>
          <button
            onClick={handleCopy}
            className="text-xs font-semibold text-[#6B21A8] shrink-0"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={handleWhatsApp}
            className="flex items-center justify-center gap-2 bg-[#25D366] text-white rounded-2xl py-3 font-semibold text-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            WhatsApp
          </button>

          <button
            onClick={handleNativeShare}
            className="flex items-center justify-center gap-2 bg-[#6B21A8] text-white rounded-2xl py-3 font-semibold text-sm"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium"
        >
          Done
        </button>
      </div>
    </div>
  );
}
