"use client";

import React, { useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  BarChart3,
  BriefcaseBusiness,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
} from "lucide-react";

export interface FreelancerProfileData {
  owner: string;
  handle: string;
  bio: string;
  portfolioUrl: string;
  skills: number[];
  verifiedProjects: number;
  endorsementCount: number;
  reputation: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FreelancerIdentityAnalytics {
  profileCount: number;
  activeProfiles: number;
  verificationCount: number;
  endorsementCount: number;
  averageReputation: number;
  recentActivity: Array<{ type: string; timestamp: string }>;
}

interface Props {
  profiles: FreelancerProfileData[];
  analytics?: FreelancerIdentityAnalytics;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onCreateProfile: (input: {
    owner: string;
    handle: string;
    bio: string;
    portfolioUrl: string;
    skills: string[];
  }) => Promise<void>;
  onVerifyPortfolio: (input: {
    owner: string;
    verifier: string;
    projectUrl: string;
    evidenceUrl: string;
    score: number;
  }) => Promise<void>;
  onEndorseSkill: (input: {
    owner: string;
    endorser: string;
    skill: string;
    evidenceUrl: string;
    weight: number;
  }) => Promise<void>;
}

export default function FreelancerIdentityDashboard({
  profiles,
  analytics,
  isLoading,
  onRefresh,
  onCreateProfile,
  onVerifyPortfolio,
  onEndorseSkill,
}: Props) {
  const [query, setQuery] = useState("");
  const [profileForm, setProfileForm] = useState({
    owner: "",
    handle: "",
    bio: "",
    portfolioUrl: "",
    skills: "",
  });
  const [verificationForm, setVerificationForm] = useState({
    owner: "",
    verifier: "",
    projectUrl: "",
    evidenceUrl: "",
    score: "85",
  });
  const [endorsementForm, setEndorsementForm] = useState({
    owner: "",
    endorser: "",
    skill: "",
    evidenceUrl: "",
    weight: "5",
  });

  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter((profile) =>
      [profile.handle, profile.owner, profile.bio, profile.portfolioUrl]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [profiles, query]);

  const topReputation = Math.max(1, ...profiles.map((profile) => profile.reputation));

  return (
    <section className="space-y-4 p-5 bg-gray-950 border border-gray-800 rounded-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-widest flex items-center gap-2">
            <BriefcaseBusiness size={16} className="text-cyan-300" />
            Freelancer Identity
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Portfolio verification, skill endorsements, and live reputation metrics.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh freelancer identities"
          className="h-9 w-9 grid place-items-center rounded-md border border-gray-700 text-gray-300 hover:text-white hover:border-cyan-500 disabled:opacity-50"
        >
          <RefreshCcw size={15} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric icon={<ShieldCheck size={14} />} label="Active" value={analytics?.activeProfiles ?? 0} />
        <Metric icon={<BadgeCheck size={14} />} label="Verified" value={analytics?.verificationCount ?? 0} />
        <Metric icon={<Award size={14} />} label="Endorsed" value={analytics?.endorsementCount ?? 0} />
        <Metric icon={<BarChart3 size={14} />} label="Avg Rep" value={analytics?.averageReputation ?? 0} />
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search profiles"
          aria-label="Search freelancer profiles"
          className="w-full rounded-md border border-gray-800 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-100 outline-none focus:border-cyan-500"
        />
      </div>

      <div className="grid gap-3">
        {filteredProfiles.length === 0 ? (
          <div className="border border-dashed border-gray-800 rounded-md p-4 text-center text-xs text-gray-500">
            No freelancer profiles match the current filter.
          </div>
        ) : (
          filteredProfiles.map((profile) => (
            <article key={profile.owner} className="border border-gray-800 rounded-md p-3 bg-gray-900/70">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-100 truncate">{profile.handle}</p>
                    {profile.verifiedProjects > 0 && <BadgeCheck size={14} className="text-emerald-300" />}
                  </div>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{profile.owner}</p>
                </div>
                <span className="text-xs text-cyan-200 font-semibold">{profile.reputation} rep</span>
              </div>
              <p className="mt-2 text-xs text-gray-400 line-clamp-2">{profile.bio || profile.portfolioUrl}</p>
              <div className="mt-3 h-2 rounded-full bg-gray-800 overflow-hidden" aria-label="Reputation bar">
                <div
                  className="h-full bg-cyan-400"
                  style={{ width: `${Math.max(6, (profile.reputation / topReputation) * 100)}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-400">
                <span>{profile.verifiedProjects} verified projects</span>
                <span>{profile.endorsementCount} endorsements</span>
                <span>{profile.skills.length} skills</span>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Create" icon={<UserRoundPlus size={14} />}>
          <Field label="Owner">
            <input className={inputClass} value={profileForm.owner} onChange={(e) => setProfileForm({ ...profileForm, owner: e.target.value })} />
          </Field>
          <Field label="Handle">
            <input className={inputClass} value={profileForm.handle} onChange={(e) => setProfileForm({ ...profileForm, handle: e.target.value })} />
          </Field>
          <Field label="Portfolio URL">
            <input className={inputClass} value={profileForm.portfolioUrl} onChange={(e) => setProfileForm({ ...profileForm, portfolioUrl: e.target.value })} />
          </Field>
          <Field label="Skills">
            <input className={inputClass} value={profileForm.skills} onChange={(e) => setProfileForm({ ...profileForm, skills: e.target.value })} placeholder="Rust, Soroban, React" />
          </Field>
          <Field label="Bio">
            <textarea className={`${inputClass} min-h-16 resize-none`} value={profileForm.bio} onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })} />
          </Field>
          <Action
            label="Create profile"
            disabled={isLoading || !profileForm.owner || !profileForm.handle || !profileForm.portfolioUrl}
            onClick={() =>
              onCreateProfile({
                ...profileForm,
                skills: profileForm.skills.split(",").map((skill) => skill.trim()).filter(Boolean),
              })
            }
          />
        </Panel>

        <Panel title="Verify" icon={<BadgeCheck size={14} />}>
          <Field label="Owner">
            <input className={inputClass} value={verificationForm.owner} onChange={(e) => setVerificationForm({ ...verificationForm, owner: e.target.value })} />
          </Field>
          <Field label="Verifier">
            <input className={inputClass} value={verificationForm.verifier} onChange={(e) => setVerificationForm({ ...verificationForm, verifier: e.target.value })} />
          </Field>
          <Field label="Project URL">
            <input className={inputClass} value={verificationForm.projectUrl} onChange={(e) => setVerificationForm({ ...verificationForm, projectUrl: e.target.value })} />
          </Field>
          <Field label="Evidence URL">
            <input className={inputClass} value={verificationForm.evidenceUrl} onChange={(e) => setVerificationForm({ ...verificationForm, evidenceUrl: e.target.value })} />
          </Field>
          <Field label="Score">
            <input type="number" min={1} max={100} className={inputClass} value={verificationForm.score} onChange={(e) => setVerificationForm({ ...verificationForm, score: e.target.value })} />
          </Field>
          <Action
            label="Verify portfolio"
            disabled={isLoading || !verificationForm.owner || !verificationForm.verifier}
            onClick={() => onVerifyPortfolio({ ...verificationForm, score: Number(verificationForm.score) })}
          />
        </Panel>

        <Panel title="Endorse" icon={<Sparkles size={14} />}>
          <Field label="Owner">
            <input className={inputClass} value={endorsementForm.owner} onChange={(e) => setEndorsementForm({ ...endorsementForm, owner: e.target.value })} />
          </Field>
          <Field label="Endorser">
            <input className={inputClass} value={endorsementForm.endorser} onChange={(e) => setEndorsementForm({ ...endorsementForm, endorser: e.target.value })} />
          </Field>
          <Field label="Skill">
            <input className={inputClass} value={endorsementForm.skill} onChange={(e) => setEndorsementForm({ ...endorsementForm, skill: e.target.value })} />
          </Field>
          <Field label="Evidence URL">
            <input className={inputClass} value={endorsementForm.evidenceUrl} onChange={(e) => setEndorsementForm({ ...endorsementForm, evidenceUrl: e.target.value })} />
          </Field>
          <Field label="Weight">
            <input type="number" min={1} max={10} className={inputClass} value={endorsementForm.weight} onChange={(e) => setEndorsementForm({ ...endorsementForm, weight: e.target.value })} />
          </Field>
          <Action
            label="Endorse skill"
            disabled={isLoading || !endorsementForm.owner || !endorsementForm.endorser || !endorsementForm.skill}
            onClick={() => onEndorseSkill({ ...endorsementForm, weight: Number(endorsementForm.weight) })}
          />
        </Panel>
      </div>
    </section>
  );
}

const inputClass =
  "w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-cyan-500";

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-gray-100">{value}</p>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900 p-3 space-y-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-300">
        {icon}
        {title}
      </h4>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[10px] uppercase tracking-wider text-gray-500">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Action({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-600"
    >
      {label}
    </button>
  );
}
