"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFreighterWallet } from "@/hooks/useFreighterWallet";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import {
  Menu,
  X,
  Compass,
  ChevronDown,
  Code2,
  BookOpen,
  Coins,
  Boxes,
  Waves,
  TrendingUp,
  Activity,
  Users,
  Fingerprint,
  Wallet,
  Shield,
  AlertTriangle,
  Sliders,
  Send,
  Building2,
  FileText,
  Music,
  Database,
  Globe,
  Trophy,
  Target,
  Orbit,
  Zap,
  LayoutGrid,
  Search,
  FileCode2,
  Gauge,
  FlaskConical,
  Landmark,
  KeyRound,
  CloudOff,
} from "lucide-react";
import {
  NAVIGATION as NAVIGATION_SOURCE,
  type NavigationIconKey,
} from "@/lib/navigation";

/** Resolves the icon keys held in `@/lib/navigation` to lucide components. */
const ICONS: Record<
  NavigationIconKey,
  React.ComponentType<{ className?: string; size?: number }>
> = {
  code: Code2,
  zap: Zap,
  "layout-grid": LayoutGrid,
  book: BookOpen,
  shield: Shield,
  database: Database,
  search: Search,
  send: Send,
  "file-code": FileCode2,
  sliders: Sliders,
  coins: Coins,
  boxes: Boxes,
  waves: Waves,
  "trending-up": TrendingUp,
  activity: Activity,
  users: Users,
  fingerprint: Fingerprint,
  wallet: Wallet,
  "alert-triangle": AlertTriangle,
  building: Building2,
  "file-text": FileText,
  music: Music,
  globe: Globe,
  trophy: Trophy,
  target: Target,
  orbit: Orbit,
  compass: Compass,
  gauge: Gauge,
  flask: FlaskConical,
  landmark: Landmark,
  key: KeyRound,
  "cloud-off": CloudOff,
};

/**
 * Drawer-visible routes, with icons bound. The shared model in
 * `@/lib/navigation` also carries sub-pages that are reachable by drilling
 * down; those stay out of the drawer but remain searchable in the palette.
 */
const NAVIGATION = NAVIGATION_SOURCE.map((group) => ({
  groupName: group.groupName,
  items: group.items
    .filter((item) => !item.hiddenInSidebar)
    .map((item) => ({ ...item, icon: ICONS[item.icon] })),
}));

const formatAddress = (addr: string | null) => {
  if (!addr) return "";
  return `${addr.slice(0, 5)}...${addr.slice(-4)}`;
};

export default function SidebarShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const wallet = useFreighterWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {
      "Core IDE & Ops": true,
      "DeFi Suite": true,
      "Governance & Trust": true,
      "Real World Assets": false,
      "Gaming & Sports": false,
    },
  );

  const drawerRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    hamburgerRef.current?.focus();
  }, []);

  useEffect(() => {
    // Feature-detect: `matchMedia` is missing in older browsers and in the
    // jsdom test environment, and the sidebar must not throw on mount when the
    // motion preference cannot be read. Skeletons degrade via CSS
    // `prefers-reduced-motion` anyway, so a false default is harmless.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, closeDrawer]);

  // Touch: swipe left on the drawer to dismiss it.
  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  };

  const handleDrawerTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Date.now() - start.at < 600 && deltaX < -60 && Math.abs(deltaY) < 50) {
      closeDrawer();
    }
  };

  // Touch: swipe right from the left screen edge to open the drawer.
  const handleSurfaceTouchEnd = (event: React.TouchEvent) => {
    if (isOpen) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (
      start.x <= 28 &&
      Date.now() - start.at < 600 &&
      deltaX > 60 &&
      Math.abs(deltaY) < 60
    ) {
      setIsOpen(true);
      window.requestAnimationFrame(() => drawerRef.current?.focus());
    }
  };

  const toggleGroup = useCallback((groupName: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);

  const activeItemName = useMemo(() => {
    for (const group of NAVIGATION) {
      const active = group.items.find((item) => item.href === pathname);
      if (active) return active.name;
    }
    if (pathname.startsWith("/bug-bounty")) return "Bug Bounty Program";
    if (pathname.startsWith("/music-licensing")) return "Music Licensing";
    if (pathname.startsWith("/governance")) return "Governance Portal";
    return "Stellar Playground";
  }, [pathname]);

  const isActive = useCallback(
    (href: string) => {
      if (href === "/") {
        return pathname === "/";
      }
      return pathname.startsWith(href);
    },
    [pathname],
  );

  return (
    <div
      className="flex min-h-screen bg-background text-foreground font-sans antialiased selection:bg-teal-500/30 selection:text-teal-200"
      suppressHydrationWarning
      onTouchStart={handleTouchStart}
      onTouchEnd={handleSurfaceTouchEnd}
    >
      {/* Background Gradients */}
      <div
        className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
        suppressHydrationWarning
      >
        <div
          className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-teal-500/10 blur-[120px]"
          suppressHydrationWarning
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-500/10 blur-[120px]"
          suppressHydrationWarning
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(120, 140, 180, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(120, 140, 180, 0.15) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
          suppressHydrationWarning
        />
      </div>

      {/* Desktop Sidebar */}
      <aside
        data-tour="sidebar"
        className={`fixed inset-y-0 left-0 z-20 hidden md:flex flex-col bg-slate-950/80 border-r border-slate-800/60 backdrop-blur-xl transition-all duration-300 ${
          collapsed ? "w-20" : "w-64"
        }`}
        suppressHydrationWarning
      >
        {/* Brand header */}
        <div
          className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60"
          suppressHydrationWarning
        >
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <div
              className="p-1.5 rounded-xl bg-gradient-to-tr from-teal-400 to-orange-400 text-slate-950 shadow-[0_0_20px_rgba(45,212,191,0.3)] animate-pulse"
              suppressHydrationWarning
            >
              <Orbit size={18} className="animate-spin-[duration:12s]" />
            </div>
            {!collapsed && (
              <span className="font-semibold text-sm tracking-widest uppercase bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Soroban Play
              </span>
            )}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <LayoutGrid size={16} />
          </button>
        </div>

        {/* Navigation list */}
        <div
          className="flex-1 overflow-y-auto py-4 px-3 space-y-5 scrollbar-thin scrollbar-thumb-slate-800"
          suppressHydrationWarning
        >
          {NAVIGATION.map((group) => (
            <div
              key={group.groupName}
              className="space-y-1"
              suppressHydrationWarning
            >
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(group.groupName)}
                  className="w-full flex items-center justify-between px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-400 uppercase tracking-[0.2em] transition-colors"
                >
                  <span>{group.groupName}</span>
                  <ChevronDown
                    size={10}
                    className={`transition-transform duration-200 ${
                      expandedGroups[group.groupName] ? "" : "-rotate-90"
                    }`}
                  />
                </button>
              )}

              {(!collapsed && expandedGroups[group.groupName]) || collapsed ? (
                <div className="space-y-0.5" suppressHydrationWarning>
                  {group.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={`group flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                          active
                            ? "bg-gradient-to-r from-teal-500/10 to-transparent border border-teal-500/20 text-teal-300 shadow-[0_0_15px_rgba(45,212,191,0.05)]"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border border-transparent"
                        }`}
                        title={collapsed ? item.name : undefined}
                      >
                        <item.icon
                          className={`shrink-0 transition-transform group-hover:scale-105 ${
                            active
                              ? "text-teal-400"
                              : "text-slate-400 group-hover:text-slate-200"
                          }`}
                          size={16}
                        />
                        {!collapsed && (
                          <span className="truncate">{item.name}</span>
                        )}
                        {!collapsed && item.badge && (
                          <span className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-teal-500/20 border border-teal-500/30 text-teal-300 font-semibold font-mono">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Wallet footer connection */}
        {!collapsed && (
          <div
            className="p-3 border-t border-slate-800/60 bg-slate-950/40"
            suppressHydrationWarning
          >
            <div
              className="rounded-xl bg-slate-900/60 border border-slate-800/40 p-2.5"
              suppressHydrationWarning
            >
              <div
                className="flex items-center justify-between gap-2 mb-2"
                suppressHydrationWarning
              >
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Freighter Connected
                </span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    wallet.status === "connected"
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-slate-600"
                  }`}
                />
              </div>

              {wallet.status === "connected" && wallet.address ? (
                <div suppressHydrationWarning>
                  <p className="font-mono text-xs text-emerald-400 truncate mb-1">
                    {formatAddress(wallet.address)}
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Network:{" "}
                    <span className="text-slate-300 uppercase">
                      {wallet.network}
                    </span>
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => wallet.connect()}
                  disabled={wallet.status === "connecting"}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 hover:border-teal-500/40 text-teal-300 text-[10px] font-semibold tracking-wider uppercase transition-colors"
                >
                  <Zap size={11} />
                  {wallet.status === "connecting" ? "Linking..." : "Connect"}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          suppressHydrationWarning
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <aside
        ref={drawerRef}
        id="mobile-navigation-drawer"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleDrawerTouchEnd}
        className={`fixed inset-y-0 left-0 z-40 w-[min(18rem,85vw)] bg-slate-950/95 border-r border-slate-800/60 backdrop-blur-2xl flex flex-col outline-none md:hidden ${
          reducedMotion
            ? isOpen
              ? "translate-x-0"
              : "-translate-x-full"
            : `transition-transform duration-300 ${
                isOpen ? "translate-x-0" : "-translate-x-full"
              }`
        }`}
        suppressHydrationWarning
      >
        <div
          className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60"
          suppressHydrationWarning
        >
          <Link href="/" className="flex items-center gap-2">
            <Orbit
              size={18}
              className="text-teal-400 animate-spin-[duration:12s]"
            />
            <span className="font-semibold text-sm tracking-wider uppercase text-white">
              Soroban Playground
            </span>
          </Link>
          <button
            onClick={closeDrawer}
            className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-slate-400 hover:bg-white/5"
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto py-4 px-3 space-y-4"
          suppressHydrationWarning
        >
          {NAVIGATION.map((group) => (
            <div
              key={group.groupName}
              className="space-y-1"
              suppressHydrationWarning
            >
              <p className="px-3 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-widest">
                {group.groupName}
              </p>
              <div className="space-y-0.5" suppressHydrationWarning>
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={closeDrawer}
                      className={`flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium border border-transparent transition-all ${
                        active
                          ? "bg-teal-500/10 border-teal-500/20 text-teal-300"
                          : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                      }`}
                    >
                      <item.icon
                        size={16}
                        className={active ? "text-teal-400" : "text-slate-400"}
                      />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div
          className="p-4 border-t border-slate-800/60 bg-slate-950/40"
          suppressHydrationWarning
        >
          <div
            className="rounded-xl bg-slate-900 border border-slate-800 p-3"
            suppressHydrationWarning
          >
            <div
              className="flex items-center justify-between mb-2"
              suppressHydrationWarning
            >
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Wallet Status
              </span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  wallet.status === "connected"
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-slate-600"
                }`}
              />
            </div>

            {wallet.status === "connected" && wallet.address ? (
              <p className="font-mono text-xs text-emerald-400 truncate">
                {formatAddress(wallet.address)}
              </p>
            ) : (
              <button
                onClick={() => wallet.connect()}
                className="w-full flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-slate-950 text-[10px] font-semibold py-1.5 rounded-lg transition-colors"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 z-10 ${
          collapsed ? "md:pl-20" : "md:pl-64"
        }`}
        suppressHydrationWarning
      >
        {/* Top Navigation Header */}
        <header
          className="h-16 flex items-center justify-between px-4 sm:px-6 bg-slate-950/40 border-b border-slate-800/60 backdrop-blur-md sticky top-0 z-20"
          suppressHydrationWarning
        >
          <div className="flex items-center gap-3" suppressHydrationWarning>
            <button
              ref={hamburgerRef}
              onClick={() => setIsOpen(true)}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2 rounded-lg text-slate-400 hover:bg-white/5 md:hidden"
              aria-label="Open navigation menu"
              aria-expanded={isOpen}
              aria-controls="mobile-navigation-drawer"
              data-tour="hamburger"
            >
              <Menu size={20} />
            </button>

            {/* Page title / breadcrumb */}
            <div className="flex items-center gap-2" suppressHydrationWarning>
              <span className="hidden sm:inline-flex text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400 transition-colors">
                Soroban Play
              </span>
              <span className="hidden sm:inline text-slate-600 font-light">
                /
              </span>
              <h1 className="text-xs sm:text-sm font-semibold tracking-wider text-white uppercase bg-slate-800/60 border border-slate-700/40 px-2.5 py-1 rounded-lg">
                {activeItemName}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3" data-tour="wallet" suppressHydrationWarning>
            {/*
              #1527 — the palette has no button of its own, so the shortcut has
              to be advertised. `⌘K` on Apple platforms, `Ctrl K` elsewhere; the
              provider binds both and toggles on the same gesture.
            */}
            <span
              data-testid="command-palette-hint"
              className="hidden items-center gap-1 rounded-lg border border-slate-700/40 bg-slate-800/60 px-1.5 py-1 text-[10px] font-semibold tracking-wider text-slate-500"
            >
              <Search size={10} />
              <kbd className="font-sans">K</kbd>
            </span>

            {/* Light / dark / system theme control */}
            <ThemeSwitcher />

            {/* Network indicator */}
            {wallet.status === "connected" && wallet.network && (
              <span className="hidden xs:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-semibold tracking-wider uppercase">
                <Compass size={11} />
                {wallet.network}
              </span>
            )}

            {/* Main Action Wallet Button */}
            {wallet.status === "connected" && wallet.address ? (
              <button
                onClick={wallet.disconnect}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-xs font-medium transition-all hover:bg-slate-800 hover:border-slate-700 shadow-sm"
              >
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-xs">
                  {formatAddress(wallet.address)}
                </span>
              </button>
            ) : (
              <button
                onClick={() => wallet.connect()}
                disabled={wallet.status === "connecting"}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-teal-400 to-teal-500 hover:from-teal-300 hover:to-teal-400 text-slate-950 font-semibold text-xs transition-all shadow-[0_0_15px_rgba(45,212,191,0.2)] hover:shadow-[0_0_20px_rgba(45,212,191,0.3)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Zap
                  size={13}
                  className={
                    wallet.status === "connecting" ? "animate-pulse" : ""
                  }
                />
                {wallet.status === "connecting"
                  ? "Connecting..."
                  : "Link Wallet"}
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Children Panel */}
        <main className="flex-1" data-tour="main">
          {children}
        </main>
      </div>
    </div>
  );
}
