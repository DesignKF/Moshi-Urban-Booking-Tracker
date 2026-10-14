import React from 'react';
import {
  Shield,
  KeyRound,
  AlertCircle,
  CalendarCheck2,
  Database
} from 'lucide-react';

interface LoginScreenProps {
  onSignIn: () => Promise<void>;
  isSigningIn: boolean;
  error?: string | null;
  onClearError?: () => void;
  firestoreConnected?: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignIn,
  isSigningIn,
  error,
  onClearError,
  firestoreConnected = true
}) => {
  return (
    <div className="min-h-screen w-full bg-[#0a111c] text-slate-100 flex flex-col justify-between selection:bg-[#fdbe4e] selection:text-[#0d1726] relative overflow-x-hidden">
      {/* Background Ambience / Subtle Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(253,190,78,0.12),rgba(13,23,38,0)_70%)] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#1a2d4b]/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 left-0 w-80 h-80 bg-[#fdbe4e]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Bar / Brand Header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between border-b border-[#1b2a41]/60">
        <div className="flex items-center space-x-3">
          <img
            src="/moshi_urban_logo_horizontal_white.svg"
            alt="Moshi Urban Hostel"
            className="h-9 sm:h-10 w-auto object-contain"
          />
          <div className="hidden sm:flex items-center space-x-1.5 bg-[#fdbe4e]/15 border border-[#fdbe4e]/40 px-2 py-0.5 rounded-md">
            <span className="w-1.5 h-1.5 rounded-full bg-[#fdbe4e] animate-pulse" />
            <span className="text-[10px] font-bold tracking-wider text-[#fdbe4e] uppercase">
              PMS Portal
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-400">
          <div className="flex items-center space-x-1.5 bg-[#142032] border border-[#1e2d44] px-2.5 py-1 rounded-lg">
            <span
              className={`w-2 h-2 rounded-full ${
                firestoreConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-amber-400'
              }`}
            />
            <span className="text-[11px] font-medium text-slate-300">
              {firestoreConnected ? 'Cloud DB Active' : 'Connecting DB...'}
            </span>
          </div>
          <span className="hidden md:inline-block text-[11px] text-slate-500 font-mono">
            v2.5
          </span>
        </div>
      </header>

      {/* Main Login Content Area */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 md:p-10 my-4 sm:my-8">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Column: Welcome & Value Narrative */}
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <div className="space-y-3">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
                Property Management <br className="hidden sm:inline" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#fdbe4e] to-amber-200">
                  &amp; Booking Engine
                </span>
              </h1>
              <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl mx-auto lg:mx-0">
                Centralized reservations, room availability, guest check-ins, and direct Google Sheets two-way synchronization for Moshi Urban Hostel &amp; Backpackers.
              </p>
            </div>

            {/* Feature Highlights Grid (hidden on mobile and tablet, visible on desktop) */}
            <div className="hidden lg:grid grid-cols-3 gap-3 pt-2 text-left">
              <div className="bg-[#121d2f]/80 border border-[#1d2e49] p-3.5 rounded-xl">
                <CalendarCheck2 className="w-5 h-5 text-[#fdbe4e] mb-2" />
                <h4 className="text-xs font-bold text-white mb-0.5">Real-Time Availability</h4>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Instant room updates with live conflict detection.
                </p>
              </div>

              <div className="bg-[#121d2f]/80 border border-[#1d2e49] p-3.5 rounded-xl">
                <Database className="w-5 h-5 text-emerald-400 mb-2" />
                <h4 className="text-xs font-bold text-white mb-0.5">Two-Way Sheets</h4>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Seamless bidirectional sync with Google Sheets workbook.
                </p>
              </div>

              <div className="bg-[#121d2f]/80 border border-[#1d2e49] p-3.5 rounded-xl">
                <Shield className="w-5 h-5 text-amber-400 mb-2" />
                <h4 className="text-xs font-bold text-white mb-0.5">Role Security</h4>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Admin, Property Manager, and Staff RBAC permissions.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Login Card Panel */}
          <div className="lg:col-span-5 w-full">
            <div className="bg-[#0f1b2b]/95 border border-[#1e2f49] shadow-2xl rounded-2xl p-6 sm:p-8 backdrop-blur-md relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#fdbe4e] via-amber-300 to-amber-500" />

              <div className="text-center space-y-2 mb-6">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-[#17253b] border border-[#233857] flex items-center justify-center text-[#fdbe4e] shadow-inner mb-3">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  Staff &amp; Admin Sign In
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Authenticate with your authorized Google account to enter the property management portal.
                </p>
              </div>

              {/* Error Alert Display */}
              {error && (
                <div className="mb-5 p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs flex items-start justify-between gap-2.5 animate-in fade-in duration-200">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{error}</span>
                  </div>
                  {onClearError && (
                    <button
                      type="button"
                      onClick={onClearError}
                      className="text-rose-400 hover:text-white text-sm font-bold leading-none p-0.5 cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              {/* Primary Sign-in Action Button */}
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={isSigningIn}
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-slate-900 bg-white hover:bg-slate-100 active:scale-[0.99] shadow-lg hover:shadow-xl transition-all duration-150 flex items-center justify-center space-x-3 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed group border border-slate-200"
                >
                  {isSigningIn ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-slate-800 border-t-transparent rounded-full animate-spin" />
                      <span>Connecting with Google...</span>
                    </div>
                  ) : (
                    <>
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.87c2.27-2.09 3.67-5.17 3.67-9.15z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.05c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.25v3.15C3.25 21.36 7.35 24 12 24z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.56H1.25C.45 8.15 0 9.99 0 12s.45 3.85 1.25 5.44l4.02-3.15z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.25 2.64 1.25 6.56l4.02 3.15c.95-2.85 3.6-4.96 6.73-4.96z"
                        />
                      </svg>
                      <span className="font-semibold text-slate-800 group-hover:text-black">
                        Sign in with Google
                      </span>
                    </>
                  )}
                </button>

                <div className="flex items-center space-x-2 text-[11px] text-slate-400 justify-center">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Secure Google OAuth 2.0 &amp; Firebase</span>
                </div>
              </div>

              {/* Role Permissions Information Box */}
              <div className="mt-6 pt-5 border-t border-[#1b2a41] space-y-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Authorized Access Roles
                </span>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-start space-x-2 p-2 rounded-lg bg-[#142032] border border-[#1a2b42]">
                    <span className="text-[#fdbe4e] font-bold text-xs mt-0.5">👑</span>
                    <div className="text-[11px] leading-tight">
                      <strong className="text-white">Administrator:</strong>
                      <span className="text-slate-300 ml-1">
                        Full control, user accounts, sheets DB setup &amp; sync.
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2 p-2 rounded-lg bg-[#142032] border border-[#1a2b42]">
                    <span className="text-amber-400 font-bold text-xs mt-0.5">🛎️</span>
                    <div className="text-[11px] leading-tight">
                      <strong className="text-white">Property Manager:</strong>
                      <span className="text-slate-300 ml-1">
                        Create/edit bookings, conflict fixes &amp; audit undo.
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2 p-2 rounded-lg bg-[#142032] border border-[#1a2b42]">
                    <span className="text-sky-400 font-bold text-xs mt-0.5">📋</span>
                    <div className="text-[11px] leading-tight">
                      <strong className="text-white">Staff / Front Desk:</strong>
                      <span className="text-slate-300 ml-1">
                        Real-time room overview and availability calendar.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 border-t border-[#1b2a41]/60 gap-2">
        <div>
          &copy; {new Date().getFullYear()} Moshi Urban Hostel &amp; Backpackers. All rights reserved.
        </div>
        <div className="flex items-center space-x-4 text-[11px]">
          <span>Moshi, Tanzania</span>
          <span>•</span>
          <span>Property Management System</span>
        </div>
      </footer>
    </div>
  );
};
