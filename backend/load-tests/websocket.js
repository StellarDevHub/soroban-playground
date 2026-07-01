import ws from 'k6/ws';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

export const wsErrorRate = new Rate('ws_error_rate');

export const options = {
  scenarios: {
    websocket_500_vus: {
      executor: 'constant-vus',
      vus: Number(__ENV.K6_VUS ?? 500),
      duration: __ENV.K6_DURATION ?? '5m',
    },
  },
  thresholds: {
    ws_connecting: ['p(95)<200'],
    ws_session_duration: ['p(95)<10000'],
    ws_error_rate: ['rate<0.01'],
  },
};

const WS_URL = __ENV.WS_URL ?? 'ws://localhost:5000/ws';

export default function () {
  const response = ws.connect(WS_URL, {}, (socket) => {
    socket.on('open', () => {
      socket.setInterval(() => socket.ping(), 5000);
    });

    socket.on('message', (message) => {
      check(message, {
        'connected event received': (payload) =>
          payload.includes('"connected"'),
      });
    });

    socket.on('error', () => {
      wsErrorRate.add(1);
    });

    socket.setTimeout(() => socket.close(), 10000);
  });

  wsErrorRate.add(response && response.status >= 400);
  check(response, {
    'websocket handshake succeeded': (res) => res && res.status === 101,
  });
}
