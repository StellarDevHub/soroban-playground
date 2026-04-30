"use client";

import React, { useState } from "react";
import { 
  UserCircle2, 
  MessageSquarePlus, 
  Heart, 
  Coins, 
  Share2, 
  Clock,
  UserPlus,
  Verified,
  Image as ImageIcon
} from "lucide-react";

export type SocialProfile = {
  address: string;
  nickname: string;
  bio: string;
  followers: number;
};

export type SocialPost = {
  id: string;
  author: string;
  nickname?: string;
  content: string;
  timestamp: number;
  likes: number;
  tips: number;
};

interface SocialFeedInterfaceProps {
  profile?: SocialProfile;
  posts: SocialPost[];
  onRegisterProfile: (nickname: string, bio: string) => Promise<void>;
  onCreatePost: (content: string) => Promise<void>;
  onLikePost: (postId: string) => Promise<void>;
  onTipPost: (postId: string, amount: number) => Promise<void>;
  isLoading?: boolean;
}

const SocialFeedInterface: React.FC<SocialFeedInterfaceProps> = ({
  profile,
  posts,
  onRegisterProfile,
  onCreatePost,
  onLikePost,
  onTipPost,
  isLoading = false,
}) => {
  const [newPostContent, setNewPostContent] = useState("");
  const [regNickname, setRegNickname] = useState("");
  const [regBio, setRegBio] = useState("");
  const [showRegModal, setShowRegModal] = useState(!profile);

  const formatDistance = (timestamp: number) => {
    const seconds = Math.floor((Date.now() / 1000) - timestamp);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Profile Header */}
      {profile && (
        <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/20 rounded-3xl p-6 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-purple-500/20 flex items-center justify-center text-purple-400 border border-purple-500/30">
              <UserCircle2 size={40} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                {profile.nickname}
                <Verified size={16} className="text-blue-400" />
              </h3>
              <p className="text-sm text-slate-400">{profile.bio}</p>
              <div className="flex gap-4 mt-2">
                <span className="text-xs font-medium text-slate-500">
                  <span className="text-slate-200">{profile.followers}</span> Followers
                </span>
                <span className="text-xs font-medium text-slate-500">
                  <span className="text-slate-200">{posts.filter(p => p.author === profile.address).length}</span> Posts
                </span>
              </div>
            </div>
            <button className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-colors">
              Edit Profile
            </button>
          </div>
        </div>
      )}

      {!profile && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 text-center space-y-4">
          <div className="h-16 w-16 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center mx-auto">
            <UserPlus size={32} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Join the Network</h3>
            <p className="text-sm text-slate-400">Create a web3 profile to start sharing and tipping.</p>
          </div>
          <div className="max-w-xs mx-auto space-y-3">
            <input
              type="text"
              placeholder="Nickname"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
              value={regNickname}
              onChange={(e) => setRegNickname(e.target.value)}
            />
            <input
              type="text"
              placeholder="Short Bio"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
              value={regBio}
              onChange={(e) => setRegBio(e.target.value)}
            />
            <button
              onClick={() => onRegisterProfile(regNickname, regBio)}
              disabled={isLoading || !regNickname}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20"
            >
              Initialize Profile
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      {profile && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-4">
          <div className="flex gap-4">
            <div className="h-10 w-10 rounded-xl bg-slate-800 flex-shrink-0 flex items-center justify-center text-slate-500">
              <UserCircle2 size={24} />
            </div>
            <div className="flex-1 space-y-3">
              <textarea
                placeholder="What's happening in the decentralized world?"
                className="w-full bg-transparent border-none resize-none text-slate-200 placeholder:text-slate-600 focus:ring-0 text-lg min-h-[80px]"
                value={newPostContent}
                onChange={(e) => setNewPostContent(e.target.value)}
              />
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/50">
                <div className="flex gap-2">
                  <button className="p-2 text-slate-500 hover:text-blue-400 transition-colors">
                    <ImageIcon size={20} />
                  </button>
                  <button className="p-2 text-slate-500 hover:text-blue-400 transition-colors">
                    <Clock size={20} />
                  </button>
                </div>
                <button
                  onClick={() => {
                    onCreatePost(newPostContent);
                    setNewPostContent("");
                  }}
                  disabled={isLoading || !newPostContent.trim()}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-full font-bold transition-all flex items-center gap-2"
                >
                  <MessageSquarePlus size={18} /> Post
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feed */}
      <div className="space-y-4">
        {posts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-slate-500">No posts yet. Be the first to share!</p>
          </div>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="bg-slate-900/30 border border-slate-800/50 rounded-3xl p-6 hover:bg-slate-900/50 transition-all group">
              <div className="flex gap-4">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex-shrink-0 flex items-center justify-center text-slate-400 border border-white/5">
                  <UserCircle2 size={28} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-200">{post.nickname || `User...${post.author.slice(-4)}`}</span>
                      <span className="text-xs text-slate-500 font-mono">@{post.author.slice(0, 6)}...</span>
                      <span className="text-xs text-slate-600">• {formatDistance(post.timestamp)}</span>
                    </div>
                    <button className="text-slate-600 hover:text-slate-400">
                      <Share2 size={16} />
                    </button>
                  </div>
                  <p className="text-slate-300 leading-relaxed mb-4">{post.content}</p>
                  <div className="flex items-center gap-6">
                    <button 
                      onClick={() => onLikePost(post.id)}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-rose-400 transition-colors group/like"
                    >
                      <div className="p-2 rounded-full group-hover/like:bg-rose-500/10 transition-colors">
                        <Heart size={18} className={post.likes > 0 ? "fill-rose-500 text-rose-500" : ""} />
                      </div>
                      {post.likes}
                    </button>
                    <button 
                      onClick={() => onTipPost(post.id, 10)}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-amber-400 transition-colors group/tip"
                    >
                      <div className="p-2 rounded-full group-hover/tip:bg-amber-500/10 transition-colors">
                        <Coins size={18} className={post.tips > 0 ? "text-amber-400" : ""} />
                      </div>
                      {post.tips} Tips
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SocialFeedInterface;
