"use client";

import { useEffect, useState } from "react";

import patentRegistryService, {
  type Patent,
  type LicenseOffer,
  type PatentRegistryDashboard,
} from "@/services/patentRegistryService";

function formatDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString() + " " + date.toLocaleTimeString();
}

function truncateAddress(addr: string) {
  if (!addr || addr.length < 20) return addr;
  return addr.slice(0, 6) + "..." + addr.slice(-6);
}

export default function PatentRegistryDashboard() {
  const [dashboard, setDashboard] = useState<PatentRegistryDashboard | null>(null);
  const [selectedPatentId, setSelectedPatentId] = useState<number | null>(null);
  const [selectedLicenseId, setSelectedLicenseId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"patents" | "licenses">("patents");

  const [patentForm, setPatentForm] = useState({
    actor: "GPATENTOWNER0000000000000000000000000000000000",
    title: "AI-Powered Agricultural Sensor",
    metadata_uri: "ipfs://patent-metadata-v1",
    metadata_hash: "0xabc123def456",
  });

  const [updateForm, setUpdateForm] = useState({
    title: "",
    metadata_uri: "",
    metadata_hash: "",
  });

  const [licenseForm, setLicenseForm] = useState({
    licensee: "GLICENSEE00000000000000000000000000000000000000",
    terms: "Exclusive 24-month license",
    payment_amount: "50000",
    payment_currency: "XLM",
  });

  const [acceptForm, setAcceptForm] = useState({
    payment_reference: "txn-001",
  });

  const selectedPatent =
    dashboard?.patents.find((p) => p.id === selectedPatentId) ||
    dashboard?.patents[0] ||
    null;

  const selectedLicense =
    dashboard?.licenses.find((l) => l.id === selectedLicenseId) ||
    dashboard?.licenses[0] ||
    null;

  const patentLicenses = selectedPatent
    ? dashboard?.licenses.filter((l) => l.patent_id === selectedPatent.id) || []
    : [];

  async function refreshDashboard() {
    const data = await patentRegistryService.getDashboard();
    setDashboard(data);
    const fallbackPatent = selectedPatentId ?? data.patents[0]?.id ?? null;
    setSelectedPatentId(fallbackPatent);

    const fallbackLicense = selectedLicenseId ?? data.licenses[0]?.id ?? null;
    setSelectedLicenseId(fallbackLicense);

    const selected = data.patents.find((p) => p.id === fallbackPatent);
    if (selected) {
      setUpdateForm({
        title: selected.title,
        metadata_uri: selected.metadata_uri,
        metadata_hash: selected.metadata_hash,
      });
    }
  }

  useEffect(() => {
    async function boot() {
      try {
        await patentRegistryService.getHealth();
        await refreshDashboard();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to connect to backend.");
      } finally {
        setLoading(false);
      }
    }

    void boot();
  }, []);

  async function runAction(action: () => Promise<void>, successText: string) {
    setBusy(true);
    setFeedback("");

    try {
      await action();
      await refreshDashboard();
      setFeedback(successText);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-purple-300">Patent Registry</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Invention Verification & Licensing</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Register patents, verify inventions, and manage decentralized licensing with smart contract validation.
              </p>
            </div>
            <a
              href="/"
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-purple-400"
            >
              Back to IDE
            </a>
          </div>
          {feedback ? (
            <p
              className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
                feedback.includes("Error") || feedback.includes("Failed")
                  ? "border-red-500/25 bg-red-500/10 text-red-100"
                  : "border-purple-500/25 bg-purple-500/10 text-purple-100"
              }`}
            >
              {feedback}
            </p>
          ) : null}
        </header>

        {/* Metrics */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Patents" value={String(dashboard?.metrics.patentCount || 0)} />
          <Metric label="Verified" value={String(dashboard?.metrics.verifiedCount || 0)} />
          <Metric label="Licenses" value={String(dashboard?.metrics.licenseCount || 0)} />
          <Metric label="Active Offers" value={String(dashboard?.metrics.activeOffers || 0)} />
          <Metric label="Total Payments" value={`${dashboard?.metrics.totalPayments || 0} XLM`} />
        </section>

        {/* Tab Navigation */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("patents")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === "patents"
                ? "bg-purple-500 text-white"
                : "border border-slate-700 text-slate-200 hover:border-purple-400"
            }`}
          >
            Patents
          </button>
          <button
            onClick={() => setActiveTab("licenses")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === "licenses"
                ? "bg-purple-500 text-white"
                : "border border-slate-700 text-slate-200 hover:border-purple-400"
            }`}
          >
            Licenses
          </button>
        </div>

        {/* Patents Tab */}
        {activeTab === "patents" && (
          <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              <Card title="Register New Patent">
                <div className="grid gap-3">
                  <Field
                    label="Owner Address"
                    value={patentForm.actor}
                    onChange={(value) => setPatentForm((p) => ({ ...p, actor: value }))}
                  />
                  <Field
                    label="Patent Title"
                    value={patentForm.title}
                    onChange={(value) => setPatentForm((p) => ({ ...p, title: value }))}
                  />
                  <Field
                    label="Metadata URI"
                    value={patentForm.metadata_uri}
                    onChange={(value) => setPatentForm((p) => ({ ...p, metadata_uri: value }))}
                  />
                  <Field
                    label="Metadata Hash"
                    value={patentForm.metadata_hash}
                    onChange={(value) => setPatentForm((p) => ({ ...p, metadata_hash: value }))}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || loading || !dashboard}
                  className="mt-4 rounded-xl bg-purple-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    void runAction(async () => {
                      const patent = await patentRegistryService.registerPatent({
                        actor: patentForm.actor.trim(),
                        title: patentForm.title.trim(),
                        metadata_uri: patentForm.metadata_uri.trim(),
                        metadata_hash: patentForm.metadata_hash.trim(),
                      });
                      setSelectedPatentId(patent.id);
                    }, "Patent registered successfully")
                  }
                >
                  Register Patent
                </button>
              </Card>

              {selectedPatent && (
                <>
                  <Card title="Update Patent">
                    <div className="grid gap-3">
                      <Field
                        label="Title"
                        value={updateForm.title}
                        onChange={(value) => setUpdateForm((p) => ({ ...p, title: value }))}
                      />
                      <Field
                        label="Metadata URI"
                        value={updateForm.metadata_uri}
                        onChange={(value) => setUpdateForm((p) => ({ ...p, metadata_uri: value }))}
                      />
                      <Field
                        label="Metadata Hash"
                        value={updateForm.metadata_hash}
                        onChange={(value) => setUpdateForm((p) => ({ ...p, metadata_hash: value }))}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busy || !selectedPatent || !dashboard}
                      className="mt-4 rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() =>
                        void runAction(async () => {
                          if (!selectedPatent || !dashboard) return;
                          await patentRegistryService.updatePatent(
                            selectedPatent.id,
                            selectedPatent.owner,
                            {
                              title: updateForm.title.trim(),
                              metadata_uri: updateForm.metadata_uri.trim(),
                              metadata_hash: updateForm.metadata_hash.trim(),
                            }
                          );
                        }, "Patent updated successfully")
                      }
                    >
                      Update Patent
                    </button>
                  </Card>

                  <Card title="Verify Patent">
                    <p className="text-sm text-slate-300">
                      {selectedPatent.status === "Verified"
                        ? "✓ Patent is verified"
                        : "Patent pending verification"}
                    </p>
                    <button
                      type="button"
                      disabled={busy || selectedPatent.status === "Verified" || !dashboard}
                      className="mt-4 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() =>
                        void runAction(async () => {
                          if (!selectedPatent || !dashboard) return;
                          await patentRegistryService.verifyPatent(
                            selectedPatent.id,
                            dashboard.config.verifierAddress
                          );
                        }, "Patent verified successfully")
                      }
                    >
                      Verify Patent
                    </button>
                  </Card>
                </>
              )}
            </div>

            {/* Patents List */}
            <Card title="Patents List">
              {dashboard?.patents.length === 0 ? (
                <p className="text-sm text-slate-400">No patents registered yet</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {dashboard?.patents.map((patent) => (
                    <button
                      key={patent.id}
                      onClick={() => {
                        setSelectedPatentId(patent.id);
                        setUpdateForm({
                          title: patent.title,
                          metadata_uri: patent.metadata_uri,
                          metadata_hash: patent.metadata_hash,
                        });
                      }}
                      className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                        selectedPatentId === patent.id
                          ? "border-purple-500 bg-purple-500/10"
                          : "border-slate-700 hover:border-purple-400"
                      }`}
                    >
                      <div className="font-semibold">{patent.title}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        ID: {patent.id} • {patent.status}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Owner: {truncateAddress(patent.owner)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </section>
        )}

        {/* Licenses Tab */}
        {activeTab === "licenses" && (
          <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              {selectedPatent && selectedPatent.status === "Verified" && (
                <Card title="Create License Offer">
                  <p className="text-sm text-slate-300 mb-3">
                    Creating license for: <span className="font-semibold">{selectedPatent.title}</span>
                  </p>
                  <div className="grid gap-3">
                    <Field
                      label="Licensee Address"
                      value={licenseForm.licensee}
                      onChange={(value) => setLicenseForm((p) => ({ ...p, licensee: value }))}
                    />
                    <Field
                      label="License Terms"
                      value={licenseForm.terms}
                      onChange={(value) => setLicenseForm((p) => ({ ...p, terms: value }))}
                    />
                    <Field
                      label="Payment Amount"
                      value={licenseForm.payment_amount}
                      onChange={(value) => setLicenseForm((p) => ({ ...p, payment_amount: value }))}
                    />
                    <Field
                      label="Payment Currency"
                      value={licenseForm.payment_currency}
                      onChange={(value) => setLicenseForm((p) => ({ ...p, payment_currency: value }))}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || !selectedPatent || !dashboard}
                    className="mt-4 rounded-xl bg-purple-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      void runAction(async () => {
                        if (!selectedPatent || !dashboard) return;
                        const license = await patentRegistryService.createLicenseOffer(
                          selectedPatent.id,
                          selectedPatent.owner,
                          {
                            licensee: licenseForm.licensee.trim(),
                            terms: licenseForm.terms.trim(),
                            payment_amount: Number(licenseForm.payment_amount),
                            payment_currency: licenseForm.payment_currency.trim(),
                          }
                        );
                        setSelectedLicenseId(license.id);
                      }, "License offer created successfully")
                    }
                  >
                    Create License
                  </button>
                </Card>
              )}

              {selectedLicense && selectedLicense.status === "Open" && (
                <Card title="Accept License">
                  <p className="text-sm text-slate-300 mb-3">
                    Accepting license from: <span className="font-semibold">{truncateAddress(selectedLicense.licensor)}</span>
                  </p>
                  <Field
                    label="Payment Reference"
                    value={acceptForm.payment_reference}
                    onChange={(value) => setAcceptForm((p) => ({ ...p, payment_reference: value }))}
                  />
                  <button
                    type="button"
                    disabled={busy || !selectedLicense || !dashboard}
                    className="mt-4 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      void runAction(async () => {
                        if (!selectedLicense || !dashboard) return;
                        await patentRegistryService.acceptLicense(
                          selectedLicense.patent_id,
                          selectedLicense.id,
                          selectedLicense.licensee,
                          {
                            payment_reference: acceptForm.payment_reference.trim(),
                          }
                        );
                      }, "License accepted successfully")
                    }
                  >
                    Accept License
                  </button>
                </Card>
              )}
            </div>

            {/* Licenses List */}
            <Card title="Licenses List">
              {dashboard?.licenses.length === 0 ? (
                <p className="text-sm text-slate-400">No licenses created yet</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {dashboard?.licenses.map((license) => (
                    <button
                      key={license.id}
                      onClick={() => setSelectedLicenseId(license.id)}
                      className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                        selectedLicenseId === license.id
                          ? "border-purple-500 bg-purple-500/10"
                          : "border-slate-700 hover:border-purple-400"
                      }`}
                    >
                      <div className="font-semibold">License #{license.id}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Patent #{license.patent_id} • {license.status}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {license.payment_amount} {license.payment_currency}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="text-slate-300">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-purple-400 focus:outline-none"
      />
    </label>
  );
}
