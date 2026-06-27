
import http from 'http';
import cluster from 'cluster';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ pid: process.pid, worker: cluster.worker.id }));
});
server.listen(14321);
process.on('message', (msg) => {
  if (msg && msg.type === 'shutdown') server.close(() => process.exit(0));
});
