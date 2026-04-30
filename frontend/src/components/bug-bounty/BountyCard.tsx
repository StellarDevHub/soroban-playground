import React from 'react';

interface BountyCardProps {
  title: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  reward: string;
  status: string;
}

const severityColors = {
  Critical: 'text-red-500 border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.3)]',
  High: 'text-orange-500 border-orange-500 shadow-[0_0_10px_rgba(255,165,0,0.3)]',
  Medium: 'text-yellow-500 border-yellow-500 shadow-[0_0_8px_rgba(255,255,0,0.2)]',
  Low: 'text-cyan-500 border-cyan-500 shadow-[0_0_8px_rgba(0,255,255,0.2)]',
};

export default function BountyCard({ title, severity, reward, status }: BountyCardProps) {
  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between p-6 bg-[#1c1b1c]/60 backdrop-blur-md border border-white/10 rounded-lg hover:bg-[#201f20]/80 transition-all duration-300">
      <div className="flex flex-col gap-2">
        <h4 className="font-space-grotesk text-xl font-medium text-[#e5e2e3]">{title}</h4>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${severityColors[severity]} bg-black/40 font-inter tracking-widest uppercase`}>
            {severity}
          </span>
          <span className="flex items-center gap-2 text-[#00FFFF] text-sm font-space-grotesk">
            <span className="w-2 h-2 rounded-full bg-[#00FFFF] animate-pulse"></span>
            {status}
          </span>
        </div>
      </div>
      <div className="flex flex-col md:items-end mt-4 md:mt-0 gap-3">
        <span className="font-space-grotesk font-bold text-2xl text-[#0070FF] drop-shadow-[0_0_10px_rgba(0,112,255,0.4)]">
          {reward}
        </span>
        <button className="px-6 py-2 rounded-md bg-[#0070FF]/10 text-[#00FFFF] border border-[#00FFFF]/50 hover:bg-[#0070FF]/20 hover:shadow-[0_0_15px_rgba(0,255,255,0.3)] transition-all font-inter text-sm font-semibold tracking-wider uppercase">
          View Details
        </button>
      </div>
    </div>
  );
}
