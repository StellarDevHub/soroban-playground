import client from 'prom-client';

/**
 * Dedicated registry for the ledger event consumer. The /metrics route merges
 * this registry with the HTTP registry so consumer lag stays visible without
 * coupling the consumer to the Express layer.
 */
export const kafkaConsumerRegistry = new client.Registry();
kafkaConsumerRegistry.setDefaultLabels({ component: 'kafka-event-consumer' });

function register(metric) {
  kafkaConsumerRegistry.registerMetric(metric);
  return metric;
}

export const kafkaRecordsLagMax = register(
  new client.Gauge({
    name: 'soroban_kafka_records_lag_max',
    help: 'Maximum consumer lag across partitions for a topic',
    labelNames: ['topic'],
  })
);

export const kafkaRecordsLag = register(
  new client.Gauge({
    name: 'soroban_kafka_records_lag',
    help: 'Consumer lag for a topic partition',
    labelNames: ['topic', 'partition'],
  })
);

export const kafkaFetchLatencyAvg = register(
  new client.Gauge({
    name: 'soroban_kafka_fetch_latency_avg_ms',
    help: 'Rolling average time spent processing a fetched batch in milliseconds',
    labelNames: ['topic'],
  })
);

export const kafkaFetchLatency = register(
  new client.Histogram({
    name: 'soroban_kafka_fetch_latency_ms',
    help: 'Time spent processing a fetched batch in milliseconds',
    labelNames: ['topic'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
  })
);

export const kafkaEventsProcessedTotal = register(
  new client.Counter({
    name: 'soroban_kafka_events_processed_total',
    help: 'Ledger events processed by the Kafka consumer',
    labelNames: ['topic', 'partition', 'status'],
  })
);

export const kafkaConsumerErrorsTotal = register(
  new client.Counter({
    name: 'soroban_kafka_consumer_errors_total',
    help: 'Kafka consumer errors grouped by stage',
    labelNames: ['stage'],
  })
);

export const kafkaConsumerRebalancesTotal = register(
  new client.Counter({
    name: 'soroban_kafka_consumer_rebalances_total',
    help: 'Consumer group rebalance and disconnect events',
    labelNames: ['event'],
  })
);

export const kafkaCommitsTotal = register(
  new client.Counter({
    name: 'soroban_kafka_offsets_committed_total',
    help: 'Manually committed Kafka offsets',
    labelNames: ['topic', 'partition', 'status'],
  })
);

const lagByTopic = new Map();
const fetchLatencyByTopic = new Map();
const FETCH_LATENCY_WINDOW = 200;

export function updatePartitionLag(topic, partition, lag) {
  const normalizedLag = Math.max(0, Number(lag) || 0);
  const partitions = lagByTopic.get(topic) ?? new Map();
  partitions.set(String(partition), normalizedLag);
  lagByTopic.set(topic, partitions);

  kafkaRecordsLag.set({ topic, partition: String(partition) }, normalizedLag);
  kafkaRecordsLagMax.set({ topic }, Math.max(...partitions.values(), 0));
}

export function recordFetchLatency(topic, latencyMs) {
  const value = Math.max(0, Number(latencyMs) || 0);
  kafkaFetchLatency.observe({ topic }, value);

  const state = fetchLatencyByTopic.get(topic) ?? {
    sum: 0,
    count: 0,
    samples: [],
  };
  state.sum += value;
  state.count += 1;
  state.samples.push(value);
  if (state.samples.length > FETCH_LATENCY_WINDOW) {
    state.sum -= state.samples.shift();
  }
  fetchLatencyByTopic.set(topic, state);

  kafkaFetchLatencyAvg.set({ topic }, state.sum / state.samples.length);
}

export function resetKafkaConsumerMetricsState() {
  lagByTopic.clear();
  fetchLatencyByTopic.clear();
}
