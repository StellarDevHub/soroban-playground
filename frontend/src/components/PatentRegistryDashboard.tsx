'use client';

import React, { useEffect, useState } from 'react';
import {
  FileText, ShieldCheck, Scale, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, ChevronRight,
} from 'lucide-react';
import { usePatentRegistry, Patent, License, Dispute, Stats } from '../hooks/usePatentRegistry';

// ── Shared UI primitives ──────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 ${className}`}>
      {children}
    </div>
  );
}

function Input({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <input
        {...props}
        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  );
}

function Btn({
  children, onClick, variant = 'primary', disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}) {
  const base = 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
  const styles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    ghost: 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300',
  };
  return (
    <button className={`${base} ${styles[variant]}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    Pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    Revoked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Expired: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    Open: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    Resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {msg}
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ stats, onRefresh, loading }: { stats: Stats | null; onRefresh: () => void; loading: boolean }) {
  const items = [
    { label: 'Patents', value: stats?.patentCount ?? '—', icon: <FileText className="w-5 h-5 text-blue-500" /> },
    { label: 'Licenses', value: stats?.licenseCount ?? '—', icon: <ShieldCheck className="w-5 h-5 text-green-500" /> },
    { label: 'Disputes', value: stats?.disputeCount ?? '—', icon: <Scale className="w-5 h-5 text-orange-500" /> },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {items.map(({ label, value, icon }) => (
        <Card key={label} className="flex items-center gap-3">
          {icon}
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        </Card>
      ))}
      <Card className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {stats?.paused
            ? <XCircle className="w-5 h-5 text-red-500" />
            : <CheckCircle2 className="w-5 h-5 text-green-500" />}
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {stats?.paused ? 'Paused' : 'Active'}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh stats"
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </Card>
    </div>
  );
}

// ── File patent form ──────────────────────────────────────────────────────────

function FilePatentForm({ onSuccess }: { onSuccess: (id: number) => void }) {
  const { filePatent, loading, error } = usePatentRegistry();
  const [form, setForm] = useState({ inventor: '', title: '', description: '', expiryDate: '' });
  const [result, setResult] = useState<number | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const id = await filePatent({
      inventor: form.inventor,
      title: form.title,
      description: form.description,
      expiryDate: Math.floor(new Date(form.expiryDate).getTime() / 1000),
    });
    if (id != null) { setResult(id); onSuccess(id); }
  };

  return (
    <Card>
      <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <FileText className="w-4 h-4 text-blue-500" /> File New Patent
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Inventor address" value={form.inventor} onChange={set('inventor')} placeholder="G..." />
        <Input label="Title" value={form.title} onChange={set('title')} placeholder="Patent title" />
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-slate-500 dark:text-slate-400">Description</span>
          <textarea
            value={form.description}
            onChange={set('description')}
            rows={2}
            placeholder="Describe the invention"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </label>
        <Input label="Expiry date" type="date" value={form.expiryDate} onChange={set('expiryDate')} />
      </div>
      {error && <div className="mt-3"><ErrorBanner msg={error} /></div>}
      {result != null && (
        <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4" /> Patent filed — ID: <strong>{result}</strong>
        </div>
      )}
      <div className="mt-4">
        <Btn onClick={submit} disabled={loading || !form.inventor || !form.title || !form.description || !form.expiryDate}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
          File Patent
        </Btn>
      </div>
    </Card>
  );
}

// ── Patent lookup ─────────────────────────────────────────────────────────────

function PatentLookup() {
  const { getPatent, loading, error } = usePatentRegistry();
  const [id, setId] = useState('');
  const [patent, setPatent] = useState<Patent | null>(null);

  const lookup = async () => {
    const p = await getPatent(Number(id));
    if (p) setPatent(p);
  };

  return (
    <Card>
      <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <FileText className="w-4 h-4 text-slate-500" /> Look Up Patent
      </h3>
      <div className="flex gap-2">
        <input
          type="number" min={1} value={id} onChange={e => setId(e.target.value)}
          placeholder="Patent ID"
          className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <Btn onClick={lookup} disabled={loading || !id} variant="ghost">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Fetch'}
        </Btn>
      </div>
      {error && <div className="mt-3"><ErrorBanner msg={error} /></div>}
      {patent && (
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-900 dark:text-white">{patent.title}</span>
            <StatusBadge status={patent.status} />
          </div>
          <p className="text-slate-500 dark:text-slate-400">{patent.description}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <span>Owner: <span className="font-mono">{patent.owner.slice(0, 12)}…</span></span>
            <span>Licenses: {patent.license_count}</span>
            <span>Filed: {new Date(patent.filing_date * 1000).toLocaleDateString()}</span>
            <span>Expires: {new Date(patent.expiry_date * 1000).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Admin actions ─────────────────────────────────────────────────────────────

function AdminActions() {
  const { activatePatent, revokePatent, loading, error } = usePatentRegistry();
  const [admin, setAdmin] = useState('');
  const [patentId, setPatentId] = useState('');
  const [msg, setMsg] = useState('');

  const act = async (fn: () => Promise<unknown>) => {
    setMsg('');
    const r = await fn();
    if (r !== null) setMsg('Done');
  };

  return (
    <Card>
      <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-purple-500" /> Admin Actions
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Admin address" value={admin} onChange={e => setAdmin(e.target.value)} placeholder="G..." />
        <Input label="Patent ID" type="number" value={patentId} onChange={e => setPatentId(e.target.value)} placeholder="1" />
      </div>
      {error && <div className="mt-3"><ErrorBanner msg={error} /></div>}
      {msg && <p className="mt-2 text-sm text-green-600 dark:text-green-400">{msg}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn onClick={() => act(() => activatePatent(Number(patentId), admin))} disabled={loading || !admin || !patentId}>
          Activate
        </Btn>
        <Btn variant="danger" onClick={() => act(() => revokePatent(Number(patentId), admin))} disabled={loading || !admin || !patentId}>
          Revoke
        </Btn>
      </div>
    </Card>
  );
}

// ── Grant license form ────────────────────────────────────────────────────────

function GrantLicenseForm() {
  const { grantLicense, loading, error } = usePatentRegistry();
  const [form, setForm] = useState({ owner: '', patentId: '', licensee: '', licenseType: 'NonExclusive', fee: '', expiryDate: '' });
  const [result, setResult] = useState<number | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const id = await grantLicense(Number(form.patentId), {
      owner: form.owner,
      licensee: form.licensee,
      licenseType: form.licenseType,
      fee: Number(form.fee),
      expiryDate: Math.floor(new Date(form.expiryDate).getTime() / 1000),
    });
    if (id != null) setResult(id);
  };

  return (
    <Card>
      <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-green-500" /> Grant License
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Owner address" value={form.owner} onChange={set('owner')} placeholder="G..." />
        <Input label="Patent ID" type="number" value={form.patentId} onChange={set('patentId')} placeholder="1" />
        <Input label="Licensee address" value={form.licensee} onChange={set('licensee')} placeholder="G..." />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-500 dark:text-slate-400">License type</span>
          <select value={form.licenseType} onChange={set('licenseType')}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="NonExclusive">Non-Exclusive</option>
            <option value="Exclusive">Exclusive</option>
          </select>
        </label>
        <Input label="Fee (stroops)" type="number" value={form.fee} onChange={set('fee')} placeholder="1000000" />
        <Input label="Expiry date" type="date" value={form.expiryDate} onChange={set('expiryDate')} />
      </div>
      {error && <div className="mt-3"><ErrorBanner msg={error} /></div>}
      {result != null && (
        <p className="mt-3 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="inline w-4 h-4 mr-1" />License granted — ID: <strong>{result}</strong>
        </p>
      )}
      <div className="mt-4">
        <Btn onClick={submit} disabled={loading || !form.owner || !form.patentId || !form.licensee || !form.fee || !form.expiryDate}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
          Grant License
        </Btn>
      </div>
    </Card>
  );
}

// ── Dispute panel ─────────────────────────────────────────────────────────────

function DisputePanel() {
  const { fileDispute, resolveDispute, getDispute, loading, error } = usePatentRegistry();
  const [tab, setTab] = useState<'file' | 'resolve' | 'lookup'>('file');
  const [msg, setMsg] = useState('');

  // file
  const [fForm, setFForm] = useState({ claimant: '', patentId: '', reason: '' });
  // resolve
  const [rForm, setRForm] = useState({ admin: '', disputeId: '', resolution: '' });
  // lookup
  const [lookupId, setLookupId] = useState('');
  const [dispute, setDispute] = useState<Dispute | null>(null);

  const submitFile = async () => {
    setMsg('');
    const id = await fileDispute({ claimant: fForm.claimant, patentId: Number(fForm.patentId), reason: fForm.reason });
    if (id != null) setMsg(`Dispute filed — ID: ${id}`);
  };

  const submitResolve = async () => {
    setMsg('');
    const r = await resolveDispute(Number(rForm.disputeId), rForm.admin, rForm.resolution);
    if (r !== null) setMsg('Dispute resolved');
  };

  const doLookup = async () => {
    const d = await getDispute(Number(lookupId));
    if (d) setDispute(d);
  };

  const tabs = [
    { key: 'file', label: 'File' },
    { key: 'resolve', label: 'Resolve' },
    { key: 'lookup', label: 'Lookup' },
  ] as const;

  return (
    <Card>
      <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <Scale className="w-4 h-4 text-orange-500" /> Disputes
      </h3>
      <div className="flex gap-1 mb-4 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setMsg(''); setDispute(null); }}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'file' && (
        <div className="space-y-3">
          <Input label="Claimant address" value={fForm.claimant} onChange={e => setFForm(f => ({ ...f, claimant: e.target.value }))} placeholder="G..." />
          <Input label="Patent ID" type="number" value={fForm.patentId} onChange={e => setFForm(f => ({ ...f, patentId: e.target.value }))} placeholder="1" />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Reason</span>
            <textarea value={fForm.reason} onChange={e => setFForm(f => ({ ...f, reason: e.target.value }))} rows={2}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </label>
          <Btn onClick={submitFile} disabled={loading || !fForm.claimant || !fForm.patentId || !fForm.reason}>
            File Dispute
          </Btn>
        </div>
      )}

      {tab === 'resolve' && (
        <div className="space-y-3">
          <Input label="Admin address" value={rForm.admin} onChange={e => setRForm(f => ({ ...f, admin: e.target.value }))} placeholder="G..." />
          <Input label="Dispute ID" type="number" value={rForm.disputeId} onChange={e => setRForm(f => ({ ...f, disputeId: e.target.value }))} placeholder="1" />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Resolution</span>
            <textarea value={rForm.resolution} onChange={e => setRForm(f => ({ ...f, resolution: e.target.value }))} rows={2}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </label>
          <Btn onClick={submitResolve} disabled={loading || !rForm.admin || !rForm.disputeId || !rForm.resolution}>
            Resolve
          </Btn>
        </div>
      )}

      {tab === 'lookup' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input type="number" min={1} value={lookupId} onChange={e => setLookupId(e.target.value)} placeholder="Dispute ID"
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <Btn onClick={doLookup} disabled={loading || !lookupId} variant="ghost">Fetch</Btn>
          </div>
          {dispute && (
            <div className="text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900 dark:text-white">Dispute #{lookupId}</span>
                <StatusBadge status={dispute.status} />
              </div>
              <p className="text-slate-500">{dispute.reason}</p>
              {dispute.resolution && <p className="text-slate-400 italic">Resolution: {dispute.resolution}</p>}
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-3"><ErrorBanner msg={error} /></div>}
      {msg && <p className="mt-3 text-sm text-green-600 dark:text-green-400">{msg}</p>}
    </Card>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function PatentRegistryDashboard() {
  const { getStats, loading } = usePatentRegistry();
  const [stats, setStats] = useState<Stats | null>(null);

  const refresh = async () => {
    const s = await getStats();
    if (s) setStats(s);
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
            <FileText className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Patent Registry</h1>
            <p className="text-sm text-slate-500">Soroban-powered IP management on Stellar Testnet</p>
          </div>
        </div>

        {/* Stats */}
        <StatsBar stats={stats} onRefresh={refresh} loading={loading} />

        {/* Two-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FilePatentForm onSuccess={refresh} />
          <PatentLookup />
          <AdminActions />
          <GrantLicenseForm />
        </div>

        {/* Full-width dispute panel */}
        <DisputePanel />
      </div>
    </div>
  );
}
