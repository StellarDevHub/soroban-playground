'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FileWarning,
  GitCompare,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  UploadCloud,
  Users,
} from 'lucide-react';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
  'http://localhost:5000';

const DEMO_EVENT = {
  eventType: 'pifp.payment',
  schemaVersion: '1.0.0',
  payload: {
    paymentId: 'pay-1001',
    payer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    payee: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    amount: 25,
    asset: 'XLM',
    createdAt: '2026-04-25T12:00:00.000Z',
    status: 'settled',
  },
};

const SCHEMA_DRAFT = {
  eventType: 'pifp.payment',
  version: '2.1.0',
  fields: {
    paymentId: { type: 'string', required: true },
    sourceAccount: { type: 'address', required: true },
    destinationAccount: { type: 'address', required: true },
    amount: { type: 'number', required: true, min: 0 },
    asset: { type: 'string', required: true },
    network: { type: 'string', required: true, default: 'testnet' },
    createdAt: { type: 'iso_datetime', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['pending', 'settled', 'failed'],
    },
    memo: { type: 'string', required: false, maxLength: 280 },
    channel: { type: 'string', required: false },
  },
  additionalProperties: false,
};

type Notification = {
  type: 'success' | 'error';
  message: string;
};

type EventMetrics = {
  validations?: {
    total: number;
    accepted: number;
    quarantined: number;
    rejected: number;
    successRate: number;
  };
  versionDistribution?: Record<string, Record<string, number>>;
  quarantine?: {
    total: number;
    open: number;
    reprocessed: number;
  };
  schemas?: {
    eventTypes: number;
    versions: number;
  };
  alerts?: {
    total: number;
    breaking: number;
  };
};

type RateLimitStat = {
  allowed?: string | number;
  blocked?: string | number;
};

type RateLimitAnalytics = {
  type?: string;
  fallback?: boolean;
  stats?: Record<string, RateLimitStat>;
  topIps?: string[];
};

type EventSchema = {
  eventType: string;
  version: string;
  required?: string[];
};

type ValidationIssue = {
  path?: string;
  code?: string;
  message?: string;
};

type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

type IngestResult = {
  accepted: boolean;
  validation: ValidationResult;
};

type ReprocessResult = {
  result: IngestResult;
};

type DetectionResult = {
  compatible?: boolean;
  alert?: unknown;
  [key: string]: unknown;
};

type QuarantineItem = {
  id: string;
  eventType: string;
  schemaVersion: string;
  errors?: ValidationIssue[];
};

type SchemaAlert = {
  id: string;
  eventType: string;
  severity: string;
  message: string;
};

type ApiPayload<T> = {
  success?: boolean;
  message?: string;
  error?: string;
  data?: T;
  config?: Record<string, number>;
};

function metricNumber(value: unknown) {
  return Number.parseInt(String(value || '0'), 10) || 0;
}

function safeJson(value: string) {
  try {
    return { ok: true as const, data: JSON.parse(value) };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);

  return (
    <div className="flex h-32 items-end gap-1">
      {values.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
          No traffic yet
        </div>
      ) : (
        values.map((value, index) => (
          <div
            key={`${value}-${index}`}
            className="min-w-2 flex-1 rounded-t bg-cyan-400/70"
            style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
            title={`${value} requests`}
          />
        ))
      )}
    </div>
  );
}

function VersionDistribution({
  distribution,
}: {
  distribution: Record<string, Record<string, number>>;
}) {
  const entries = Object.entries(distribution || {});

  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No accepted events yet.</p>;
  }

  return (
    <div className="space-y-4">
      {entries.map(([eventType, versions]) => {
        const total = Math.max(
          1,
          Object.values(versions).reduce((sum, value) => sum + value, 0),
        );

        return (
          <div key={eventType} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-mono text-gray-300">{eventType}</span>
              <span className="text-gray-500">{total} events</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded bg-gray-800">
              {Object.entries(versions).map(([version, count], index) => (
                <div
                  key={version}
                  className={index % 2 === 0 ? 'bg-emerald-400' : 'bg-cyan-400'}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${version}: ${count}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-gray-400">
              {Object.entries(versions).map(([version, count]) => (
                <span key={version} className="rounded bg-gray-800 px-2 py-1">
                  {version}: {count}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState<RateLimitAnalytics | null>(null);
  const [config, setConfig] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [history, setHistory] = useState<Array<{ time: string; hits: number }>>([]);
  const [eventMetrics, setEventMetrics] = useState<EventMetrics>({});
  const [schemas, setSchemas] = useState<EventSchema[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [alerts, setAlerts] = useState<SchemaAlert[]>([]);
  const [eventJson, setEventJson] = useState(JSON.stringify(DEMO_EVENT, null, 2));
  const [schemaJson, setSchemaJson] = useState(JSON.stringify(SCHEMA_DRAFT, null, 2));
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);

  const showNotification = useCallback((next: Notification) => {
    setNotification(next);
    window.setTimeout(() => setNotification(null), 3000);
  }, []);

  const fetchEventDashboard = useCallback(async () => {
    const [metricsRes, schemasRes, quarantineRes, alertsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/events/metrics`),
      fetch(`${API_BASE_URL}/api/events/schemas`),
      fetch(`${API_BASE_URL}/api/events/quarantine?status=open`),
      fetch(`${API_BASE_URL}/api/events/schemas/alerts`),
    ]);

    const [metricsData, schemasData, quarantineData, alertsData] =
      await Promise.all([
        metricsRes.json() as Promise<ApiPayload<EventMetrics>>,
        schemasRes.json() as Promise<ApiPayload<EventSchema[]>>,
        quarantineRes.json() as Promise<ApiPayload<QuarantineItem[]>>,
        alertsRes.json() as Promise<ApiPayload<SchemaAlert[]>>,
      ]);

    setEventMetrics(metricsData.data || {});
    setSchemas(schemasData.data || []);
    setQuarantine(quarantineData.data || []);
    setAlerts(alertsData.data || []);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/admin/rate-limits`)
      .then((res) => res.json())
      .then((data: ApiPayload<never>) => {
        setConfig(data.config || {});
      })
      .catch((err) => console.error('Failed to fetch config:', err));

    fetchEventDashboard().catch((err) =>
      console.error('Failed to fetch event dashboard:', err),
    );

    const ws = new WebSocket(`${API_BASE_URL.replace(/^http/, 'ws')}/ws`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as RateLimitAnalytics;
      if (data.type === 'rate-limit-analytics') {
        setAnalytics(data);
        setHistory((prev) => [
          ...prev.slice(-29),
          {
            time: new Date().toLocaleTimeString(),
            hits: Object.values(data.stats || {}).reduce(
              (acc: number, curr) => acc + metricNumber(curr.allowed),
              0,
            ),
          },
        ]);
      }
    };

    return () => ws.close();
  }, [fetchEventDashboard]);

  const blockedRequests = useMemo(
    () =>
      Object.values(analytics?.stats || {}).reduce(
        (total: number, value) => total + metricNumber(value.blocked),
        0,
      ),
    [analytics],
  );

  const handleUpdateLimit = async (endpoint: string, limit: number) => {
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/rate-limits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, limit }),
      });
      const data = (await res.json()) as ApiPayload<never>;
      if (data.success) {
        showNotification({
          type: 'success',
          message: `Updated ${endpoint} limit to ${limit}`,
        });
        setConfig({ ...config, [endpoint]: limit });
      } else {
        showNotification({
          type: 'error',
          message: data.error || 'Failed to update',
        });
      }
    } catch {
      showNotification({ type: 'error', message: 'Network error' });
    } finally {
      setIsSaving(false);
    }
  };

  const postJson = async <T,>(path: string, body: unknown): Promise<ApiPayload<T>> => {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as ApiPayload<T>;
    if (!res.ok && !data.data) {
      throw new Error(data.message || 'Request failed');
    }
    return data;
  };

  const handleValidateEvent = async () => {
    const parsed = safeJson(eventJson);
    if (!parsed.ok) {
      showNotification({ type: 'error', message: parsed.message });
      return;
    }

    try {
      const data = await postJson<ValidationResult>('/api/events/validate', parsed.data);
      if (!data.data) {
        throw new Error(data.message || 'Validation failed');
      }
      setValidationResult(data.data);
      showNotification({
        type: data.data.valid ? 'success' : 'error',
        message: data.message || 'Validation completed',
      });
      await fetchEventDashboard();
    } catch (error) {
      showNotification({
        type: 'error',
        message: error instanceof Error ? error.message : 'Validation failed',
      });
    }
  };

  const handleIngestEvent = async () => {
    const parsed = safeJson(eventJson);
    if (!parsed.ok) {
      showNotification({ type: 'error', message: parsed.message });
      return;
    }

    try {
      const data = await postJson<IngestResult>('/api/events/ingest', parsed.data);
      if (!data.data) {
        throw new Error(data.message || 'Event ingest failed');
      }
      setValidationResult(data.data.validation);
      showNotification({
        type: data.data.accepted ? 'success' : 'error',
        message: data.message || 'Event ingest completed',
      });
    } catch (error) {
      showNotification({
        type: 'error',
        message: error instanceof Error ? error.message : 'Event ingest failed',
      });
    } finally {
      await fetchEventDashboard();
    }
  };

  const handleDetectSchema = async () => {
    const parsed = safeJson(eventJson);
    if (!parsed.ok) {
      showNotification({ type: 'error', message: parsed.message });
      return;
    }

    try {
      const data = await postJson<DetectionResult>('/api/events/schemas/detect', parsed.data);
      if (!data.data) {
        throw new Error(data.message || 'Detection failed');
      }
      setDetectionResult(data.data);
      showNotification({
        type: data.data.compatible ? 'success' : 'error',
        message: data.message || 'Schema detection completed',
      });
    } catch (error) {
      showNotification({
        type: 'error',
        message: error instanceof Error ? error.message : 'Detection failed',
      });
    } finally {
      await fetchEventDashboard();
    }
  };

  const handleRegisterSchema = async () => {
    const parsed = safeJson(schemaJson);
    if (!parsed.ok) {
      showNotification({ type: 'error', message: parsed.message });
      return;
    }

    try {
      const data = await postJson<unknown>('/api/events/schemas', parsed.data);
      showNotification({
        type: 'success',
        message: data.message || 'Event schema registered',
      });
    } catch (error) {
      showNotification({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Schema registration failed',
      });
    } finally {
      await fetchEventDashboard();
    }
  };

  const handleReprocess = async (id: string) => {
    try {
      const data = await postJson<ReprocessResult>(
        `/api/events/quarantine/${id}/reprocess`,
        {},
      );
      if (!data.data) {
        throw new Error(data.message || 'Reprocess request failed');
      }
      showNotification({
        type: data.data.result.accepted ? 'success' : 'error',
        message: data.message || 'Reprocess completed',
      });
    } catch (error) {
      showNotification({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Reprocess request failed',
      });
    } finally {
      await fetchEventDashboard();
    }
  };

  const exportCSV = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Accepted Events', eventMetrics.validations?.accepted || 0],
      ['Quarantined Events', eventMetrics.validations?.quarantined || 0],
      ['Rejected Events', eventMetrics.validations?.rejected || 0],
      ['Open Quarantine', eventMetrics.quarantine?.open || 0],
      ['Breaking Alerts', eventMetrics.alerts?.breaking || 0],
      ['Blocked Requests', blockedRequests],
    ];
    const csvContent =
      'data:text/csv;charset=utf-8,' + rows.map((row) => row.join(',')).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'admin_data_quality.csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const statCards = [
    {
      label: 'Total Hits',
      value: history.reduce((a, b) => a + b.hits, 0),
      icon: Activity,
      color: 'text-cyan-400',
    },
    {
      label: 'Redis Status',
      value: analytics ? (analytics.fallback ? 'FALLBACK' : 'CONNECTED') : 'PENDING',
      icon: BarChart3,
      color: analytics?.fallback ? 'text-orange-400' : 'text-emerald-400',
    },
    {
      label: 'Accepted Events',
      value: eventMetrics.validations?.accepted || 0,
      icon: Database,
      color: 'text-emerald-400',
    },
    {
      label: 'Open Quarantine',
      value: eventMetrics.quarantine?.open || 0,
      icon: FileWarning,
      color: 'text-red-400',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <ShieldCheck className="h-8 w-8 text-emerald-400" />
            Admin Control Center
          </h1>
          <p className="mt-2 text-gray-400">
            Rate limits, event schema quality, and quarantine review.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => fetchEventDashboard()}
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 transition-colors hover:bg-gray-800"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 transition-colors hover:bg-gray-800"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {notification && (
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 ${
            notification.type === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/50 bg-red-500/10 text-red-300'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          {notification.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-400">{stat.label}</p>
                <h3 className="mt-1 text-2xl font-bold">{stat.value}</h3>
              </div>
              <stat.icon className={`${stat.color} h-6 w-6`} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6 lg:col-span-2">
          <h3 className="mb-5 text-lg font-semibold">Traffic Real-time</h3>
          <Sparkline values={history.map((item) => item.hits)} />
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
          <h3 className="mb-5 text-lg font-semibold">Event Quality</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm text-gray-400">
                <span>Validation success</span>
                <span>{percent(eventMetrics.validations?.successRate ?? 1)}</span>
              </div>
              <div className="mt-2 h-3 rounded bg-gray-800">
                <div
                  className="h-3 rounded bg-emerald-400"
                  style={{
                    width: percent(eventMetrics.validations?.successRate ?? 1),
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-lg bg-gray-800 p-3">
                <p className="text-gray-500">Schemas</p>
                <p className="mt-1 font-semibold">{eventMetrics.schemas?.versions || 0}</p>
              </div>
              <div className="rounded-lg bg-gray-800 p-3">
                <p className="text-gray-500">Alerts</p>
                <p className="mt-1 font-semibold">{eventMetrics.alerts?.total || 0}</p>
              </div>
              <div className="rounded-lg bg-gray-800 p-3">
                <p className="text-gray-500">Blocked</p>
                <p className="mt-1 font-semibold">{blockedRequests}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
          <h3 className="mb-5 flex items-center gap-2 text-lg font-semibold">
            <Settings className="h-5 w-5" /> Dynamic Rate Limits
          </h3>
          <div className="space-y-5">
            {['compile', 'invoke', 'deploy', 'global'].map((endpoint) => (
              <div key={endpoint} className="space-y-3">
                <div className="flex justify-between">
                  <span className="font-medium capitalize text-gray-300">
                    {endpoint} limit
                  </span>
                  <span className="font-bold text-cyan-300">
                    {config[endpoint] || 10} / hr
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="500"
                  value={config[endpoint] || 10}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      [endpoint]: Number.parseInt(event.target.value, 10),
                    })
                  }
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-cyan-400"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => handleUpdateLimit(endpoint, config[endpoint] || 10)}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded bg-cyan-600 px-3 py-1 text-xs transition-colors hover:bg-cyan-500 disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" /> Apply
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
          <h3 className="mb-5 text-lg font-semibold">Version Distribution</h3>
          <VersionDistribution
            distribution={eventMetrics.versionDistribution || {}}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <GitCompare className="h-5 w-5" /> Event Validation
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleValidateEvent}
                className="rounded bg-gray-800 px-3 py-2 text-sm transition-colors hover:bg-gray-700"
              >
                Validate
              </button>
              <button
                onClick={handleIngestEvent}
                className="flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm transition-colors hover:bg-emerald-500"
              >
                <UploadCloud className="h-4 w-4" /> Ingest
              </button>
              <button
                onClick={handleDetectSchema}
                className="rounded bg-cyan-600 px-3 py-2 text-sm transition-colors hover:bg-cyan-500"
              >
                Detect
              </button>
            </div>
          </div>
          <textarea
            value={eventJson}
            onChange={(event) => setEventJson(event.target.value)}
            spellCheck={false}
            className="h-80 w-full resize-none rounded-lg border border-gray-800 bg-black/40 p-4 font-mono text-sm text-gray-200 outline-none focus:border-cyan-500"
          />
          {validationResult && (
            <div className="mt-4 rounded-lg bg-gray-950 p-4 text-sm">
              <div className="flex items-center gap-2">
                {validationResult.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                )}
                <span className="font-semibold">
                  {validationResult.valid ? 'Valid event' : 'Validation errors'}
                </span>
              </div>
              <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap text-xs text-gray-400">
                {JSON.stringify(
                  validationResult.valid
                    ? validationResult.warnings
                    : validationResult.errors,
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Database className="h-5 w-5" /> Schema Registry
            </h3>
            <button
              onClick={handleRegisterSchema}
              className="flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm transition-colors hover:bg-emerald-500"
            >
              <Save className="h-4 w-4" /> Register
            </button>
          </div>
          <textarea
            value={schemaJson}
            onChange={(event) => setSchemaJson(event.target.value)}
            spellCheck={false}
            className="h-80 w-full resize-none rounded-lg border border-gray-800 bg-black/40 p-4 font-mono text-sm text-gray-200 outline-none focus:border-emerald-500"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {schemas.slice(0, 4).map((schema) => (
              <div key={`${schema.eventType}-${schema.version}`} className="rounded-lg bg-gray-950 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-gray-200">
                    {schema.eventType}
                  </span>
                  <span className="rounded bg-gray-800 px-2 py-1 text-xs text-cyan-300">
                    {schema.version}
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {schema.required?.length || 0} required fields
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
          <h3 className="mb-5 flex items-center gap-2 text-lg font-semibold">
            <FileWarning className="h-5 w-5" /> Event Quarantine
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-500">
                  <th className="pb-3 font-medium">Event</th>
                  <th className="pb-3 font-medium">Version</th>
                  <th className="pb-3 font-medium">Issue</th>
                  <th className="pb-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {quarantine.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-gray-500">
                      No open quarantine items.
                    </td>
                  </tr>
                ) : (
                  quarantine.map((item) => (
                    <tr key={item.id}>
                      <td className="py-4 font-mono text-gray-300">
                        {item.eventType}
                      </td>
                      <td className="py-4 text-gray-400">{item.schemaVersion}</td>
                      <td className="py-4 text-red-300">
                        {item.errors?.[0]?.message || 'Validation failed'}
                      </td>
                      <td className="py-4">
                        <button
                          onClick={() => handleReprocess(item.id)}
                          className="flex items-center gap-2 rounded bg-gray-800 px-3 py-1 transition-colors hover:bg-gray-700"
                        >
                          <RotateCcw className="h-3 w-3" /> Reprocess
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
          <h3 className="mb-5 flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="h-5 w-5" /> Schema Detection
          </h3>
          {detectionResult ? (
            <pre className="max-h-96 overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-300">
              {JSON.stringify(detectionResult.alert || detectionResult, null, 2)}
            </pre>
          ) : alerts.length > 0 ? (
            <div className="space-y-3">
              {alerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="rounded-lg bg-gray-950 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm text-gray-300">
                      {alert.eventType}
                    </span>
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        alert.severity === 'breaking'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">{alert.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No schema alerts.</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
        <h3 className="mb-5 flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5" /> Top Requests by IP
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-500">
                <th className="pb-3 font-medium">IP Address</th>
                <th className="pb-3 font-medium">Request Count</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {analytics?.topIps?.length ? (
                Array.from({ length: analytics.topIps.length / 2 }).map((_, index) => (
                  <tr key={analytics.topIps[index * 2]}>
                    <td className="py-4 font-mono text-gray-300">
                      {analytics.topIps[index * 2]}
                    </td>
                    <td className="py-4 font-bold">
                      {analytics.topIps[index * 2 + 1]}
                    </td>
                    <td className="flex items-center gap-2 py-4 text-emerald-400">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      Active
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-gray-500">
                    Waiting for traffic.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
