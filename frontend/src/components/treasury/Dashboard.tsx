"use client";

import React, { useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export function Dashboard() {
  const [tvl, setTvl] = useState(0);

  // Mock data for the chart, in real life we fetch from the backend API
  const chartData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'Treasury TVL (XLM)',
        data: [12000, 15000, 14500, 18000, 22000, 21000, 25000],
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderWidth: 2,
        tension: 0.4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: { display: false },
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: 'rgba(255, 255, 255, 0.5)' }
      }
    }
  };

  useEffect(() => {
    // Animate TVL counter
    let start = 0;
    const target = 25000;
    const duration = 2000;
    const increment = target / (duration / 16);
    
    const interval = setInterval(() => {
      start += increment;
      if (start >= target) {
        setTvl(target);
        clearInterval(interval);
      } else {
        setTvl(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
      {/* Dynamic Background Glow */}
      <div className="absolute -inset-20 bg-blue-500/20 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      
      <div className="relative z-10">
        <h2 className="text-xl font-medium text-gray-400 mb-2">Total Value Locked</h2>
        <div className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex items-baseline gap-2">
          {tvl.toLocaleString()} <span className="text-2xl text-gray-500 font-medium">XLM</span>
        </div>
        
        <div className="mt-8 h-[200px] w-full">
          <Line data={chartData} options={chartOptions as any} />
        </div>
      </div>
    </div>
  );
}
