-- Benchmark: RLS overhead + partition pruning on audit_log.
-- Requires the partition (…010) and RLS (…011) migrations to be applied.
SELECT ensure_audit_log_partitions(3, 3);
TRUNCATE audit_log;
INSERT INTO audit_log (tenant_id, user_id, action, endpoint, status_code, "timestamp")
SELECT 'user:' || (g % 200), g % 200, 'request', '/api/x', 200, now() - random() * interval '90 days'
FROM generate_series(1, 300000) g;
ANALYZE audit_log;

\echo === P. partition pruning: current month only ===
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT count(*) FROM audit_log
 WHERE "timestamp" >= date_trunc('month', now())
   AND "timestamp" <  date_trunc('month', now()) + interval '1 month';

\echo === A. owner, no RLS: one tenant, this month ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*) FROM audit_log
 WHERE tenant_id = 'user:5' AND "timestamp" >= date_trunc('month', now());

\echo === B. app_tenant WITH RLS: same query ===
BEGIN; SET LOCAL ROLE app_tenant; SELECT set_config('app.current_user_id', '5', true);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*) FROM audit_log
 WHERE "timestamp" >= date_trunc('month', now());
COMMIT;

\echo === C. owner: tenant only, all months ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*) FROM audit_log WHERE tenant_id = 'user:5';

\echo === D. app_tenant WITH RLS: all months ===
BEGIN; SET LOCAL ROLE app_tenant; SELECT set_config('app.current_user_id', '5', true);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*) FROM audit_log;
COMMIT;
