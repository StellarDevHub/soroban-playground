"use client";

import React, { useState } from "react";
import { 
  Leaf, 
  ShieldCheck, 
  Plus, 
  ArrowRightLeft, 
  Flame, 
  TrendingDown, 
  Building2,
  CheckCircle2,
  Clock
} from "lucide-react";

export type IssuerData = {
  address: string;
  name: string;
  verified: boolean;
  totalMinted: number;
};

export type CarbonAssetData = {
  balance: number;
  totalRetired: number;
  totalOwned: number;
};

interface CarbonCreditDashboardProps {
  issuer?: IssuerData;
  assets?: CarbonAssetData;
  onRegisterIssuer: (name: string) => Promise<void>;
  onVerifyIssuer: (address: string) => Promise<void>;
  onMint: (to: string, amount: number) => Promise<void>;
  onTransfer: (to: string, amount: number) => Promise<void>;
  onRetire: (amount: number) => Promise<void>;
  isLoading?: boolean;
}

const CarbonCreditDashboard: React.FC<CarbonCreditDashboardProps> = ({
  issuer,
  assets = { balance: 0, totalRetired: 0, totalOwned: 0 },
  onRegisterIssuer,
  onVerifyIssuer,
  onMint,
  onTransfer,
  onRetire,
  isLoading = false,
}) => {
  const [registerName, setRegisterName] = useState("");
  const [verifyAddress, setVerifyAddress] = useState("");
  const [mintAddress, setMintAddress] = useState("");
  const [mintAmount, setMintAmount] = useState(0);
  const [transferAddress, setTransferAddress] = useState("");
  const [transferAmount, setTransferAmount] = useState(0);
  const [retireAmount, setRetireAmount] = useState(0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900/50 border border-emerald-500/30 rounded-2xl p-6 backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
              <Leaf size={24} />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">Carbon Portfolio</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-sm text-slate-400">Current Balance</span>
              <span className="text-2xl font-bold text-emerald-400">{assets.balance} MT</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" 
                style={{ width: assets.totalOwned > 0 ? `${(assets.balance / assets.totalOwned) * 100}%` : '0%' }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Verified Offsets</span>
              <span>Total Owned: {assets.totalOwned} MT</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/50 border border-orange-500/30 rounded-2xl p-6 backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-orange-500/20 rounded-lg text-orange-400">
              <Flame size={24} />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">Retired Credits</h3>
          </div>
          <div className="space-y-1">
            <span className="text-2xl font-bold text-orange-400">{assets.totalRetired} MT</span>
            <p className="text-sm text-slate-400">Carbon footprint neutralized</p>
            <div className="flex items-center gap-1.5 text-xs text-orange-400/70 mt-2">
              <TrendingDown size={14} />
              <span>Reduced impact this period</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/50 border border-blue-500/30 rounded-2xl p-6 backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
              <ShieldCheck size={24} />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">Verification Status</h3>
          </div>
          {issuer ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-slate-400" />
                <span className="text-sm text-slate-200">{issuer.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {issuer.verified ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center gap-1 border border-emerald-500/30">
                    <CheckCircle2 size={12} /> Verified Issuer
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center gap-1 border border-amber-500/30">
                    <Clock size={12} /> Pending Verification
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">Minted: {issuer.totalMinted} MT</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Not registered as a carbon credit issuer yet.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
          <h4 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Building2 size={18} className="text-blue-400" />
            Registry & Verification
          </h4>
          <div className="space-y-4">
            {!issuer && (
              <div className="space-y-2">
                <label className="text-xs text-slate-500 uppercase font-medium">Register as Issuer</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Organization Name"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/50 transition-colors"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                  />
                  <button
                    onClick={() => onRegisterIssuer(registerName)}
                    disabled={isLoading || !registerName}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20"
                  >
                    <Plus size={16} /> Register
                  </button>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <label className="text-xs text-slate-500 uppercase font-medium">Verify Issuer (Admin Only)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Issuer Address"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500/50 transition-colors"
                  value={verifyAddress}
                  onChange={(e) => setVerifyAddress(e.target.value)}
                />
                <button
                  onClick={() => onVerifyIssuer(verifyAddress)}
                  disabled={isLoading || !verifyAddress}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/20"
                >
                  <ShieldCheck size={16} /> Verify
                </button>
              </div>
            </div>

            {issuer?.verified && (
              <div className="space-y-2 pt-2 border-t border-slate-800/50">
                <label className="text-xs text-slate-500 uppercase font-medium">Mint Credits</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Recipient"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/50 transition-colors"
                    value={mintAddress}
                    onChange={(e) => setMintAddress(e.target.value)}
                  />
                  <input
                    type="number"
                    placeholder="Amount (MT)"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/50 transition-colors"
                    value={mintAmount || ""}
                    onChange={(e) => setMintAmount(Number(e.target.value))}
                  />
                </div>
                <button
                  onClick={() => onMint(mintAddress, mintAmount)}
                  disabled={isLoading || !mintAddress || mintAmount <= 0}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                >
                  <Plus size={18} /> Mint Carbon Credits
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
          <h4 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <ArrowRightLeft size={18} className="text-blue-400" />
            Trading & Retirement
          </h4>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs text-slate-500 uppercase font-medium">Transfer Credits</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Recipient"
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/50 transition-colors"
                  value={transferAddress}
                  onChange={(e) => setTransferAddress(e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Amount (MT)"
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/50 transition-colors"
                  value={transferAmount || ""}
                  onChange={(e) => setTransferAmount(Number(e.target.value))}
                />
              </div>
              <button
                onClick={() => onTransfer(transferAddress, transferAmount)}
                disabled={isLoading || !transferAddress || transferAmount <= 0}
                className="w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
              >
                <ArrowRightLeft size={18} /> Transfer Credits
              </button>
            </div>

            <div className="space-y-2 pt-4 border-t border-slate-800/50 text-center">
              <label className="text-xs text-slate-500 uppercase font-medium block text-left">Offset Carbon Footprint</label>
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0"
                    className="bg-transparent text-4xl font-bold text-center text-orange-400 w-32 outline-none"
                    value={retireAmount || ""}
                    onChange={(e) => setRetireAmount(Number(e.target.value))}
                  />
                  <span className="absolute bottom-0 right-0 transform translate-x-3 translate-y-1 text-xs text-slate-500">MT</span>
                </div>
                <p className="text-xs text-slate-500 italic max-w-[200px]">
                  Retiring credits permanently removes them from circulation and claims the carbon offset.
                </p>
                <button
                  onClick={() => onRetire(retireAmount)}
                  disabled={isLoading || retireAmount <= 0 || retireAmount > assets.balance}
                  className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-900/30"
                >
                  <Flame size={20} /> Retire Carbon Credits
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CarbonCreditDashboard;
