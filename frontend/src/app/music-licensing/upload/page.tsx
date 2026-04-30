"use client";

import React, { useState } from 'react';
import Link from 'next/link';

export default function MintLicense() {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('Electronic');
  const [bpm, setBpm] = useState('');
  const [price, setPrice] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log({ title, artist, genre, bpm, price });
  };

  return (
    <div className="min-h-screen bg-[#0A0A10] text-[#efddeb] font-inter p-6 md:p-12 relative overflow-hidden">
      {/* Abstract Background Glows */}
      <div className="absolute top-[0%] right-[-10%] w-[40%] h-[40%] bg-[#D946EF]/10 rounded-full blur-[150px] pointer-events-none"></div>

      <div className="max-w-4xl mx-auto relative z-10 pb-24">
        <Link href="/music-licensing" className="text-[#d6c0d3] hover:text-[#06B6D4] text-sm tracking-widest uppercase mb-8 inline-block transition-colors">
          ← Back to Marketplace
        </Link>
        
        <header className="mb-10 border-b border-white/10 pb-6">
          <h1 className="font-epilogue text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
            MINT NEW LICENSE
          </h1>
          <p className="text-[#d6c0d3] text-sm">Upload your track and set on-chain licensing terms for instant purchases.</p>
        </header>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          
          {/* Left Column: Form Fields */}
          <div className="space-y-6">
            <div className="bg-[#12121A]/80 backdrop-blur-md border border-white/10 rounded-xl p-6 shadow-xl">
              <div className="mb-5">
                <label className="block text-xs font-bold tracking-widest uppercase text-[#d6c0d3] mb-2">Track Title</label>
                <input 
                  type="text" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Midnight Drive"
                  className="w-full bg-[#0A0A10] border border-white/10 rounded-md p-4 text-white focus:outline-none focus:border-[#06B6D4] transition-all"
                  required
                />
              </div>

              <div className="mb-5">
                <label className="block text-xs font-bold tracking-widest uppercase text-[#d6c0d3] mb-2">Artist / Producer</label>
                <input 
                  type="text" 
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Your artist name"
                  className="w-full bg-[#0A0A10] border border-white/10 rounded-md p-4 text-white focus:outline-none focus:border-[#06B6D4] transition-all"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="block text-xs font-bold tracking-widest uppercase text-[#d6c0d3] mb-2">Genre</label>
                  <select 
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full bg-[#0A0A10] border border-white/10 rounded-md p-4 text-white focus:outline-none focus:border-[#06B6D4] transition-all appearance-none cursor-pointer"
                  >
                    <option value="Electronic">Electronic</option>
                    <option value="Hip Hop">Hip Hop</option>
                    <option value="Pop">Pop</option>
                    <option value="Lo-Fi">Lo-Fi</option>
                    <option value="Ambient">Ambient</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold tracking-widest uppercase text-[#d6c0d3] mb-2">BPM</label>
                  <input 
                    type="number" 
                    value={bpm}
                    onChange={(e) => setBpm(e.target.value)}
                    placeholder="e.g. 128"
                    className="w-full bg-[#0A0A10] border border-white/10 rounded-md p-4 text-white focus:outline-none focus:border-[#06B6D4] transition-all"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold tracking-widest uppercase text-[#D946EF] mb-2">License Price (USDC)</label>
                <input 
                  type="number" 
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Amount in USDC"
                  className="w-full bg-[#0A0A10] border border-[#D946EF]/50 rounded-md p-4 text-[#D946EF] font-bold text-lg focus:outline-none focus:border-[#D946EF] focus:shadow-[0_0_15px_rgba(217,70,239,0.2)] transition-all"
                  required
                />
              </div>
            </div>
          </div>

          {/* Right Column: File Upload Area & Submit */}
          <div className="flex flex-col gap-6">
            <div className="flex-1 bg-[#12121A]/80 backdrop-blur-md border border-white/10 rounded-xl p-6 flex flex-col items-center justify-center border-dashed hover:border-[#06B6D4] hover:bg-[#06B6D4]/5 transition-all cursor-pointer group">
              <div className="w-20 h-20 rounded-full bg-[#06B6D4]/10 text-[#06B6D4] flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              </div>
              <h3 className="font-epilogue text-xl font-bold mb-2 text-white">Drag & Drop Audio</h3>
              <p className="text-sm text-[#d6c0d3] text-center">Supports high-quality .WAV or .MP3 up to 50MB</p>
              <button type="button" className="mt-6 px-6 py-2 rounded-full border border-[#06B6D4] text-[#06B6D4] text-sm font-bold tracking-wider uppercase hover:bg-[#06B6D4] hover:text-[#0A0A10] transition-colors">
                Browse Files
              </button>
            </div>

            <button type="submit" className="w-full py-4 rounded-xl bg-[#D946EF] text-white font-extrabold tracking-widest uppercase text-lg shadow-[0_0_20px_rgba(217,70,239,0.4)] hover:shadow-[0_0_35px_rgba(217,70,239,0.7)] hover:-translate-y-1 transition-all flex justify-center items-center gap-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 22h20L12 2zm0 4.5l6.5 13h-13L12 6.5z"/></svg>
              Mint License on Chain
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
