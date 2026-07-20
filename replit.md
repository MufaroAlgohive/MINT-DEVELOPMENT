# Mint — Investment & Wealth Platform

## How to Run on Replit

- **Workflow**: `Start application` — runs `npm run dev`, which starts the Express backend (port 3001) and the Vite dev server (port 5000) concurrently.
- **Preview**: Open port 5000 in the Replit preview pane.
- **Required secrets** (set via Replit Secrets):
  - `VITE_SUPABASE_URL` — Supabase project URL ✅ configured
  - `VITE_SUPABASE_ANON_KEY` — Supabase public anon key (frontend) ✅ configured
  - `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (backend admin) ✅ configured
  - `SESSION_SECRET` — Express session secret ✅ configured
- **Optional secrets** (features degrade gracefully without them): `RESEND_API_KEY`, `PAYSTACK_SECRET_KEY`, `OZOW_PRIVATE_KEY`, `OZOW_SITE_CODE`, `ANTHROPIC_API_KEY`, `BROKER_API_KEY`, `TRUID_WEBHOOK_SECRET`, `CRON_SECRET`
- `EXPERIAN_MOCK=true` is already set — KYC runs in mock mode for development.
- Dependencies: installed automatically by the workflow via `pnpm install` before `npm run dev`.

## Setup Status (last verified 2026-07-20)

The app was imported from GitHub and set up on Replit. Verified working:

- ✅ `npm install` completes cleanly (452 packages)
- ✅ Express backend starts on port 3001 (`TruID API server running on port 3001`)
- ✅ Vite dev server starts on port 5000
- ✅ Login/welcome screen renders correctly in preview
- ⚠️ `VITE_SUPABASE_ANON_KEY` secret needs to be re-added — Supabase frontend client won't initialise without it
- ⚠️ `SUPABASE_SERVICE_ROLE_KEY` secret needs to be re-added — backend admin client requires it for DB operations

**Note on `@capacitor/cli`**: Removed from `devDependencies` because it depends on the `tar` npm package, which is blocked by Replit's security firewall (Critical CVE). The CLI is only needed for mobile builds (`npx cap sync`, `npx cap open ios/android`) — web development is unaffected. Re-add it outside Replit if you need to build for iOS/Android.

**Workflow command**: Changed from `pnpm install && npm run dev` to `npm install && npm run dev` — pnpm also hit the same `tar` CVE block.

**Database**: All data lives in Supabase (hosted Postgres). There is no local PostgreSQL dependency — the `postgresql-16` Replit module was removed because it is unused and would waste resources. `pgPool` in `server/index.cjs` is optional and falls back gracefully when `SUPABASE_DB_URL` is absent.

## Overview
Mint Auth is a React authentication application built with Vite, Tailwind CSS, and Framer Motion. It provides a secure user authentication experience, featuring a complete signup flow with robust password validation, OTP email verification, and advanced security measures like biometric authentication and PIN lock screens. The application integrates with various third-party services for KYC, bank linking, and real-time market data, aiming to deliver a seamless and feature-rich financial management platform for managing personal finances and investments.

## User Preferences
- **Communication Style**: I prefer clear and concise communication. Avoid overly technical jargon unless necessary, and provide explanations that are easy to understand.
- **Coding Style**: I prefer clean, readable, and modular code. Favor functional components in React and maintain a consistent coding style throughout the project.
- **Workflow Preferences**: I prefer an iterative development approach. Break down tasks into smaller, manageable chunks and seek feedback regularly.
- **Interaction Preferences**: Ask before making any major architectural changes or introducing new dependencies. Provide a brief explanation for proposed changes.
- **General Working Preferences**: Do not make changes to the `server/` directory without explicit instruction, as this contains critical backend logic and third-party API integrations.

## System Architecture

### UI/UX Decisions
- **Design Language**: iOS-style UI with a "glassmorphism" design approach.
- **Animations**: Smooth transitions and animations using Framer Motion.
- **Theming**: Tailwind CSS for rapid and consistent UI development.
- **Navigation**: iOS-style "swipe-back" navigation with previous page preview, scaling, and haptic feedback. Browser history is synced with the app's internal navigation stack.

### Technical Implementations
- **Frontend Framework**: React 18 with Vite.
- **Styling**: Tailwind CSS 3 and PostCSS.
- **State Management**: Context API for centralized state, especially notifications. Custom hooks for data fetching and logic encapsulation.
- **Authentication Flows**: Includes robust password validation, 6-digit OTP verification with progressive lockouts, and secure login attempts with cooldowns.
- **Biometric Authentication**: Integration with `capacitor-face-id` for native iOS/Android biometrics.
- **PIN Lock Screen**: 5-digit PIN setup with SHA-256 hashing for session security.
- **User Onboarding**: A 6-step identification process including employment details, Sumsub KYC, discretionary mandate, risk disclosure, source of funds, bank account details, and T&C agreements.
- **Minimum Investment Enforcement**: Calculates sums raw `shares × (last_price/100)`.
- **Notification System**: Centralized real-time notifications via Supabase subscriptions, grouped by date, with swipe-to-delete and "mark all as read" functionality.
- **Settlement Config**: `fullyIntegrated: true` from `/api/settlement/config.js`. Portfolio data based on `stock_holdings` records and strategy matching.
- **Filter Persistence**: `src/lib/usePersistedFilters.js` for localStorage-based filter save/restore across `marketsInvest`, `marketsStrategies`, and `openStrategies` contexts.
- **Portfolio Equity Curve Chart**: Displays P&L equity curve on the home page balance card (`SwipeableBalanceCard.jsx`) with various timeframes. Charts show gain/loss starting from R0 and can be anchored to the user's purchase date.
- **PDF Factsheet Generation**: Client-side PDF generation (`generateFactsheetPdf.js`) for strategy factsheets, including personalized investment details.
- **Order Email Notifications**: Confirmation and fill emails sent via Resend for investment transactions, logged to the `order_emails` table.
- **Vercel Serverless API Endpoints**: Endpoints for onboarding status, completion, ID number validation, mandate saving, and session management.
- **Family & Child Account Management**: 4-step modal for adding child accounts, including ID number, birth certificate upload, proof of address declaration, and responsibility agreement.
- **Onboarding Completion Checks**: `src/lib/checkOnboardingComplete.js` provides a shared utility for checking onboarding status, used for smart step navigation.

### Feature Specifications
- **Dashboard**: Investment portfolio dashboard with strategy selection and performance charts.
- **Statements**: Statements page with Strategy/Holdings/Financials tabs and PDF download.
- **Profile Management**: KYC verification status, editable profile details, and view-only profile page.
- **Settings**: Biometric toggles, change password, session timeout, and active session management.
- **Navigation Menu**: Comprehensive menu including Profile Details, Settings, Help & FAQs, Legal, Privacy, Subscriptions, and Logout.

## External Dependencies

- **Supabase**: Backend-as-a-Service for authentication, database, and real-time subscriptions.
- **Capacitor**: For deploying as a native mobile app and accessing device features.
- **capacitor-face-id**: Plugin for native biometric authentication.
- **Express.js**: Backend API server for secure server-side logic and third-party API proxying.
- **Axios**: HTTP client for API requests.
- **TruID Connect**: Identity verification and bank linking service.
- **Sumsub**: KYC (Know Your Customer) verification service.
- **Yahoo Finance (via custom proxy)**: For fetching live stock market data.
- **Resend**: Email service for transactional emails (order notifications).
- **jsPDF + jspdf-autotable**: For client-side PDF generation (factsheets).