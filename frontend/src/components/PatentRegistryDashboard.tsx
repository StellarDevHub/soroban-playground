"use client";

import {
  Activity,
  BadgeCheck,
  BookKey,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  FileBadge2,
  Fingerprint,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";

import patentRegistryService, {
  type HistoryItem,
  type LicenseOffer,
  type PatentDashboardResponse,
  type PatentItem,
} from "../services/patentRegistryService";

type HealthState = "checking" | "online" | "offline";

type PatentFormState = {
  owner: string;
  title: string;
  description: string;
  contentHash: string;
  metadataUri: string;
};

type OfferFormState = {
  patentId: string;
  owner: string;
  terms: string;
  paymentAmount: string;
  paymentToken: string;
};

const emptyPatentForm: PatentFormState = {
  owner: "",
  title: "",
  description: "",
  contentHash: "",
  metadataUri: "",
};

const emptyOfferForm: OfferFormState = {
  patentId: "",
  owner: "",
  terms: "",
  paymentAmount: "",
  paymentToken: "USDC",
};

function shortAddress(value: string) {
  if (!value) {
    return "n/a";
  }

  if (value.length < 14) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatMoney(amount: number, token: string) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(amount) + ` ${token}`;
}

function statusTone(status: PatentItem["verificationStatus"] | LicenseOffer["status"]) {
  return status === "verified" || status === "accepted"
    ? "bg-emerald-400/12 text-emerald-200 border-emerald-400/25"
    : "bg-amber-400/12 text-amber-100 border-amber-400/25";
}

export default function PatentRegistryDashboard() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [message, setMessage] = useState("Connecting to patent registry backend...");
  const [isBusy, setIsBusy] = useState(false);
  const [patents, setPatents] = useState<PatentItem[]>([]);
  const [offers, setOffers] = useState<LicenseOffer[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [config, setConfig] = useState<PatentDashboardResponse["config"]>({
    adminAddress: "",
    verifierAddress: "",
  });
  const [selectedPatentId, setSelectedPatentId] = useState<number | null>(null);
  const [patentForm, setPatentForm] = useState<PatentFormState>(emptyPatentForm);
  const [offerForm, setOfferForm] = useState<OfferFormState>(emptyOfferForm);
  const [feedback, setFeedback] = useState("");

  const selectedPatent =
    patents.find((item) => item.id === selectedPatentId) || patents[0] || null;

  const openOffers = offers.filter((offer) => offer.status === "open");
  const verifiedPatents = patents.filter(
    (patent) => patent.verificationStatus === "verified"
  ).length;

  const loadDashboard = useEffectEvent(async () => {
    const data = await patentRegistryService.getDashboard();
    startTransition(() => {
      setPatents(data.patents);
      setOffers(data.offers);
      setHistory(data.history);
      setConfig(data.config);
      if (!selectedPatentId && data.patents[0]) {
        setSelectedPatentId(data.patents[0].id);
      }
    });
  });

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await patentRegistryService.getHealth();
        if (cancelled) {
          return;
        }
        setHealth("online");
        setMessage("Backend online. Patent registry, verification, and licensing are live.");
        await loadDashboard();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setHealth("offline");
        setMessage(
          error instanceof Error
            ? error.message
            : "Backend unavailable. Start the backend to use this dashboard."
        );
      }
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, []);

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setIsBusy(true);
    setFeedback("");

    try {
      await action();
      await loadDashboard();
      setFeedback(successMessage);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePatentSubmit() {
    if (!patentForm.owner || !patentForm.title || !patentForm.description) {
      setFeedback("Owner, title, and description are required.");
      return;
    }

    await runAction(async () => {
      await patentRegistryService.registerPatent({
        owner: patentForm.owner.trim(),
        title: patentForm.title.trim(),
        description: patentForm.description.trim(),
        contentHash: patentForm.contentHash.trim(),
        metadataUri: patentForm.metadataUri.trim(),
      });
      setPatentForm(emptyPatentForm);
    }, "Patent registered successfully.");
  }

  async function handlePatentUpdate() {
    if (!selectedPatent) {
      setFeedback("Choose a patent before updating it.");
      return;
    }

    await runAction(async () => {
      await patentRegistryService.updatePatent(selectedPatent.id, selectedPatent.owner, {
        title: patentForm.title || selectedPatent.title,
        description: patentForm.description || selectedPatent.description,
        contentHash: patentForm.contentHash || selectedPatent.contentHash,
        metadataUri: patentForm.metadataUri || selectedPatent.metadataUri,
      });
    }, "Patent updated and reset to pending verification.");
  }

  async function handleVerifyPatent(patentId: number) {
    await runAction(async () => {
      await patentRegistryService.verifyPatent(patentId, config.verifierAddress);
    }, "Patent verified by configured verifier.");
  }

  async function handleCreateOffer() {
    const patentId = Number(offerForm.patentId || selectedPatent?.id || 0);
    const paymentAmount = Number(offerForm.paymentAmount);
    if (!patentId || !offerForm.owner || !offerForm.terms || paymentAmount <= 0) {
      setFeedback("Choose a patent, owner, terms, and payment amount.");
      return;
    }

    await runAction(async () => {
      await patentRegistryService.createLicenseOffer({
        patentId,
        owner: offerForm.owner.trim(),
        terms: offerForm.terms.trim(),
        paymentAmount,
        paymentToken: offerForm.paymentToken.trim() || "USDC",
      });
      setOfferForm(emptyOfferForm);
    }, "License offer created successfully.");
  }

  async function handleAcceptOffer(offerId: number) {
    await runAction(async () => {
      await patentRegistryService.acceptLicenseOffer(
        offerId,
        "GLICENSEE-PATENT-MARKETPLACE-USER"
      );
    }, "License offer accepted.");
  }

  return (
    <div className="min-h-screen bg-transparent px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="rounded-[30px] border border-white/10 bg-slate-950/75 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.4)]">
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <div>
              <p className="text-[11px] uppercase tracking-[0.34em] text-cyan-200/80">
                Decentralized IP Infrastructure
              </p>
              <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-tight text-white sm:text-5xl">
                Patent registration, invention verification, and licensing in one Soroban-ready flow.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                This smallest complete version keeps the flow grounded in the repo’s playground style:
                register an invention, verify it with a designated verifier, list licensing terms,
                and track marketplace activity through a backend transaction timeline.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Service Status</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {health === "online" ? "Connected" : health === "checking" ? "Checking" : "Offline"}
                  </p>
                </div>
                <div
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    health === "online"
                      ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-200"
                      : health === "checking"
                        ? "border-amber-400/30 bg-amber-400/12 text-amber-100"
                        : "border-rose-400/30 bg-rose-400/12 text-rose-200"
                  }`}
                >
                  {health}
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{message}</p>
              <div className="mt-4 grid gap-3 text-xs text-slate-300">
                <InfoCell label="Verifier" value={shortAddress(config.verifierAddress)} />
                <InfoCell label="Admin" value={shortAddress(config.adminAddress)} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<FileBadge2 size={18} />}
            label="Patents"
            value={String(patents.length)}
            helper="Registered invention records"
          />
          <MetricCard
            icon={<BadgeCheck size={18} />}
            label="Verified"
            value={String(verifiedPatents)}
            helper="Approved by verifier or admin"
          />
          <MetricCard
            icon={<BookKey size={18} />}
            label="Open Offers"
            value={String(openOffers.length)}
            helper="Licensing offers still available"
          />
          <MetricCard
            icon={<Activity size={18} />}
            label="History"
            value={String(history.length)}
            helper="Mutations recorded by backend timeline"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="space-y-6">
            <Panel
              title="Patent Registry"
              eyebrow="Owner actions"
              action={
                feedback ? (
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                    {feedback}
                  </span>
                ) : undefined
              }
            >
              <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                <div className="space-y-4">
                  <InputField
                    label="Owner Address"
                    value={patentForm.owner}
                    onChange={(value) =>
                      setPatentForm((prev) => ({ ...prev, owner: value }))
                    }
                    placeholder="G..."
                  />
                  <InputField
                    label="Patent Title"
                    value={patentForm.title}
                    onChange={(value) =>
                      setPatentForm((prev) => ({ ...prev, title: value }))
                    }
                    placeholder="Adaptive cooling mesh"
                  />
                  <TextAreaField
                    label="Description"
                    value={patentForm.description}
                    onChange={(value) =>
                      setPatentForm((prev) => ({ ...prev, description: value }))
                    }
                    placeholder="What makes the invention novel and licensable?"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InputField
                      label="Content Hash"
                      value={patentForm.contentHash}
                      onChange={(value) =>
                        setPatentForm((prev) => ({ ...prev, contentHash: value }))
                      }
                      placeholder="Qm..."
                    />
                    <InputField
                      label="Metadata URI"
                      value={patentForm.metadataUri}
                      onChange={(value) =>
                        setPatentForm((prev) => ({ ...prev, metadataUri: value }))
                      }
                      placeholder="ipfs://..."
                    />
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <ActionButton
                      onClick={() => void handlePatentSubmit()}
                      disabled={isBusy || health !== "online"}
                    >
                      {isBusy ? <LoaderCircle size={16} className="animate-spin" /> : <Fingerprint size={16} />}
                      Register Patent
                    </ActionButton>
                    <ActionButton
                      tone="secondary"
                      onClick={() => void handlePatentUpdate()}
                      disabled={isBusy || !selectedPatent || health !== "online"}
                    >
                      <Building2 size={16} />
                      Update Selected Patent
                    </ActionButton>
                  </div>
                </div>

                <div className="space-y-3">
                  {patents.length === 0 ? (
                    <EmptyState label="No patents registered yet." />
                  ) : (
                    patents.map((patent) => (
                      <button
                        key={patent.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatentId(patent.id);
                          setPatentForm({
                            owner: patent.owner,
                            title: patent.title,
                            description: patent.description,
                            contentHash: patent.contentHash,
                            metadataUri: patent.metadataUri,
                          });
                        }}
                        className={`w-full rounded-[22px] border p-4 text-left transition ${
                          selectedPatent?.id === patent.id
                            ? "border-cyan-400/40 bg-cyan-400/10"
                            : "border-white/10 bg-white/[0.03] hover:border-cyan-400/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{patent.title}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              Owner {shortAddress(patent.owner)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(
                              patent.verificationStatus
                            )}`}
                          >
                            {patent.verificationStatus}
                          </span>
                        </div>
                        <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">
                          {patent.description}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span>#{patent.id}</span>
                          <span>{patent.metadataUri || "No metadata URI"}</span>
                        </div>
                        <button
                          type="button"
                          className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleVerifyPatent(patent.id);
                          }}
                          disabled={isBusy || health !== "online"}
                        >
                          <ShieldCheck size={14} />
                          Verify
                        </button>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </Panel>

            <Panel title="Licensing Marketplace" eyebrow="Commercialization">
              <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-4">
                  <InputField
                    label="Patent ID"
                    value={offerForm.patentId}
                    onChange={(value) =>
                      setOfferForm((prev) => ({ ...prev, patentId: value }))
                    }
                    placeholder={selectedPatent ? String(selectedPatent.id) : "1"}
                  />
                  <InputField
                    label="Owner Address"
                    value={offerForm.owner}
                    onChange={(value) =>
                      setOfferForm((prev) => ({ ...prev, owner: value }))
                    }
                    placeholder={selectedPatent?.owner || "G..."}
                  />
                  <TextAreaField
                    label="License Terms"
                    value={offerForm.terms}
                    onChange={(value) =>
                      setOfferForm((prev) => ({ ...prev, terms: value }))
                    }
                    placeholder="Non-exclusive diagnostics use for 24 months in West Africa."
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InputField
                      label="Payment Amount"
                      value={offerForm.paymentAmount}
                      onChange={(value) =>
                        setOfferForm((prev) => ({ ...prev, paymentAmount: value }))
                      }
                      placeholder="2500"
                    />
                    <InputField
                      label="Payment Token"
                      value={offerForm.paymentToken}
                      onChange={(value) =>
                        setOfferForm((prev) => ({ ...prev, paymentToken: value }))
                      }
                      placeholder="USDC"
                    />
                  </div>
                  <ActionButton
                    onClick={() => void handleCreateOffer()}
                    disabled={isBusy || health !== "online"}
                  >
                    {isBusy ? <LoaderCircle size={16} className="animate-spin" /> : <BriefcaseBusiness size={16} />}
                    Create License Offer
                  </ActionButton>
                </div>

                <div className="space-y-3">
                  {offers.length === 0 ? (
                    <EmptyState label="No license offers created yet." />
                  ) : (
                    offers.map((offer) => (
                      <div
                        key={offer.id}
                        className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{offer.patentTitle}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              Patent #{offer.patentId} by {shortAddress(offer.owner)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(
                              offer.status
                            )}`}
                          >
                            {offer.status}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-300">{offer.terms}</p>
                        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
                          <span>{formatMoney(offer.paymentAmount, offer.paymentToken)}</span>
                          <span>
                            {offer.licensee
                              ? `Licensee ${shortAddress(offer.licensee)}`
                              : "Awaiting buyer"}
                          </span>
                        </div>
                        {offer.status === "open" ? (
                          <ActionButton
                            tone="secondary"
                            onClick={() => void handleAcceptOffer(offer.id)}
                            disabled={isBusy || health !== "online"}
                          >
                            <CheckCircle2 size={16} />
                            Accept Offer
                          </ActionButton>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel title="Selected Patent" eyebrow="Detail">
              {selectedPatent ? (
                <div className="space-y-4">
                  <InfoCell label="Title" value={selectedPatent.title} />
                  <InfoCell label="Owner" value={selectedPatent.owner} />
                  <InfoCell label="Hash" value={selectedPatent.contentHash} />
                  <InfoCell label="Metadata" value={selectedPatent.metadataUri} />
                  <InfoCell
                    label="Verifier"
                    value={selectedPatent.verifier || "Pending verification"}
                  />
                  <p className="rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-4 text-sm leading-6 text-slate-300">
                    {selectedPatent.description}
                  </p>
                </div>
              ) : (
                <EmptyState label="Select a patent to inspect its full metadata." />
              )}
            </Panel>

            <Panel title="Transaction History" eyebrow="Timeline">
              <div className="space-y-3">
                {history.length === 0 ? (
                  <EmptyState label="History will appear after the first mutation." />
                ) : (
                  history.slice(0, 12).map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{entry.action}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            Actor {shortAddress(entry.actor)}
                          </p>
                        </div>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                        {entry.patentId ? <span>Patent #{entry.patentId}</span> : null}
                        {entry.offerId ? <span>Offer #{entry.offerId}</span> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </div>
  );
}

function Panel({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-slate-950/72 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.38)]">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</p>
        <div className="rounded-2xl bg-white/[0.04] p-2 text-cyan-200">{icon}</div>
      </div>
      <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{helper}</p>
    </div>
  );
}

function ActionButton({
  children,
  tone = "primary",
  disabled,
  onClick,
}: {
  children: ReactNode;
  tone?: "primary" | "secondary";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
        tone === "primary"
          ? "bg-gradient-to-r from-cyan-300 to-amber-300 text-slate-950 hover:brightness-105"
          : "border border-white/12 bg-white/[0.04] text-slate-100 hover:border-cyan-400/30"
      }`}
    >
      {children}
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/45"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={5}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/45"
      />
    </label>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm text-white">{value}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-center text-sm text-slate-400">
      {label}
    </div>
  );
}
