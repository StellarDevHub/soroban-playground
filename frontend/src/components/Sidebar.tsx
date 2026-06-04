"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFreighterWallet } from "@/hooks/useFreighterWallet";
import {
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
  Menu,
  X,
  Compass,
  Zap,
  ChevronDown,
  LayoutGrid,
  Search
} from "lucide-react";

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  badge?: string;
};

type NavGroup = {
  groupName: string;
  items: NavItem[];
};

export default function SidebarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wallet = useFreighterWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    "Core IDE & Ops": true,
    "DeFi Suite": true,
    "Governance & Trust": true,
    "Real World Assets": false,
    "Gaming & Sports": false
  });

  const navigation: NavGroup[] = [
    {
      groupName: "Core IDE & Ops",
      items: [
        { name: "IDE Playground", href: "/playground", icon: Code2 },
        { name: "Compile Dashboard", href: "/compile-dashboard", icon: Zap },
        { name: "Storage Browser", href: "/storage-browser", icon: Database },
        { name: "Docs & Reference", href: "/docs", icon: BookOpen },
        { name: "Audit Explorer", href: "/audit", icon: Shield },
        { name: "Search Utility", href: "/search", icon: Search },
        { name: "Ledger Migration", href: "/migration", icon: Send },
        { name: "Rate Limits", href: "/rate-limits", icon: Sliders }
      ]
    },
    {
      groupName: "DeFi Suite",
      items: [
        { name: "Synthetic Assets", href: "/", icon: Coins },
        { name: "Limit Order Book", href: "/orderbook", icon: Boxes },
        { name: "Stablecoin Peg", href: "/stablecoin", icon: Waves },
        { name: "Yield Optimizer", href: "/yield-optimizer", icon: TrendingUp },
        { name: "NFT AMM Pool", href: "/nft-amm", icon: Activity }
      ]
    },
    {
      groupName: "Governance & Trust",
      items: [
        { name: "Governance Portal", href: "/governance/history", icon: Users },
        { name: "Quadratic Voting", href: "/quadratic-voting", icon: Fingerprint },
        { name: "Treasury Panel", href: "/treasury", icon: Wallet },
        { name: "Bug Bounty Program", href: "/bug-bounty", icon: AlertTriangle }
      ]
    },
    {
      groupName: "Real World Assets",
      items: [
        { name: "Tokenized REIT", href: "/reit", icon: Building2 },
        { name: "Patent Registry", href: "/patents", icon: FileText },
        { name: "Music Licensing", href: "/music-licensing", icon: Music },
        { name: "Data Marketplace", href: "/data-marketplace", icon: Database },
        { name: "Content Publishing", href: "/content-publishing", icon: Globe }
      ]
    },
    {
      groupName: "Gaming & Sports",
      items: [
        { name: "Sports Dashboard", href: "/sports", icon: Trophy },
        { name: "Sports Prediction", href: "/sports-prediction", icon: Target }
      ]
    }
  ];

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const getActiveItemName = () => {
    for (const group of navigation) {
      const active = group.items.find(item => item.href === pathname);
      if (active) return active.name;
    }
    if (pathname.startsWith("/bug-bounty")) return "Bug Bounty Program";
    if (pathname.startsWith("/music-licensing")) return "Music Licensing";
    if (pathname.startsWith("/governance")) return "Governance Portal";
    return "Stellar Playground";
  };

  const formatAddress = (addr: string | null) => {
    if (!addr) return "";
    return `${addr.slice(0, 5)}...${addr.slice(-4)}`;
  };

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="flex min-h-screen bg-[#060c18] text-[#e6edf7] font-sans antialiased selection:bg-teal-500/30 selection:text-teal-200">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-teal-500/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-500/10 blur-[120px]" />
        <div 
          className="absolute inset-0 opacity-[0.03]" 
          style={{
            backgroundImage: "linear-gradient(rgba(120, 140, 180, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(120, 140, 180, 0.15) 1px, transparent 1px)",
            backgroundSize: "32px 32px"
          }}
        />
      </div>

      {/* Desktop Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-20 hidden md:flex flex-col bg-slate-950/80 border-r border-slate-800/60 backdrop-blur-xl transition-all duration-300 ${
          collapsed ? "w-20" : "w-64"
        }`}
      >
        {/* Brand header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="p-1.5 rounded-xl bg-gradient-to-tr from-teal-400 to-orange-400 text-slate-950 shadow-[0_0_20px_rgba(45,212,191,0.3)] animate-pulse">
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
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5 scrollbar-thin scrollbar-thumb-slate-800">
          {navigation.map((group) => (
            <div key={group.groupName} className="space-y-1">
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
                <div className="space-y-0.5">
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
                            active ? "text-teal-400" : "text-slate-400 group-hover:text-slate-200"
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
          <div className="p-3 border-t border-slate-800/60 bg-slate-950/40">
            <div className="rounded-xl bg-slate-900/60 border border-slate-800/40 p-2.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Freighter Connected
                </span>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  wallet.status === "connected" ? "bg-emerald-400 animate-pulse" : "bg-slate-600"
                }`} />
              </div>
              
              {wallet.status === "connected" && wallet.address ? (
                <div>
                  <p className="font-mono text-xs text-emerald-400 truncate mb-1">
                    {formatAddress(wallet.address)}
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Network: <span className="text-slate-300 uppercase">{wallet.network}</span>
                  </p>
                </div>
              ) : (
                <button
                  onClick={wallet.connect}
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
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <aside 
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-950/90 border-r border-slate-800/60 backdrop-blur-2xl flex flex-col md:hidden transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60">
          <Link href="/" className="flex items-center gap-2">
            <Orbit size={18} className="text-teal-400 animate-spin-[duration:12s]" />
            <span className="font-semibold text-sm tracking-wider uppercase text-white">
              Soroban Playground
            </span>
          </Link>
          <button 
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-4">
          {navigation.map((group) => (
            <div key={group.groupName} className="space-y-1">
              <p className="px-3 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-widest">
                {group.groupName}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium border border-transparent transition-all ${
                        active
                          ? "bg-teal-500/10 border-teal-500/20 text-teal-300"
                          : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                      }`}
                    >
                      <item.icon size={16} className={active ? "text-teal-400" : "text-slate-400"} />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-800/60 bg-slate-950/40">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Wallet Status
              </span>
              <span className={`h-1.5 w-1.5 rounded-full ${
                wallet.status === "connected" ? "bg-emerald-400 animate-pulse" : "bg-slate-600"
              }`} />
            </div>
            
            {wallet.status === "connected" && wallet.address ? (
              <p className="font-mono text-xs text-emerald-400 truncate">
                {formatAddress(wallet.address)}
              </p>
            ) : (
              <button
                onClick={wallet.connect}
                className="w-full flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-slate-950 text-[10px] font-semibold py-1.5 rounded-lg transition-colors"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 z-10 ${
        collapsed ? "md:pl-20" : "md:pl-64"
      }`}>
        {/* Top Navigation Header */}
        <header className="h-16 flex items-center justify-between px-4 sm:px-6 bg-slate-950/40 border-b border-slate-800/60 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsOpen(true)}
              className="p-2 -ml-2 rounded-lg text-slate-400 hover:bg-white/5 md:hidden"
              aria-label="Open sidebar menu"
            >
              <Menu size={20} />
            </button>
            
            {/* Page title / breadcrumb */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400 transition-colors">
                Soroban Play
              </span>
              <span className="hidden sm:inline text-slate-600 font-light">/</span>
              <h1 className="text-xs sm:text-sm font-semibold tracking-wider text-white uppercase bg-slate-800/60 border border-slate-700/40 px-2.5 py-1 rounded-lg">
                {getActiveItemName()}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
                <span className="font-mono text-xs">{formatAddress(wallet.address)}</span>
              </button>
            ) : (
              <button
                onClick={wallet.connect}
                disabled={wallet.status === "connecting"}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-teal-400 to-teal-500 hover:from-teal-300 hover:to-teal-400 text-slate-950 font-semibold text-xs transition-all shadow-[0_0_15px_rgba(45,212,191,0.2)] hover:shadow-[0_0_20px_rgba(45,212,191,0.3)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Zap size={13} className={wallet.status === "connecting" ? "animate-pulse" : ""} />
                {wallet.status === "connecting" ? "Connecting..." : "Link Wallet"}
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Children Panel */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
