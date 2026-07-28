const heartbeatMs = 30_000;
let shuttingDown = false;

console.log(JSON.stringify({ level: "info", service: "worker", message: "worker_started" }));

const heartbeat = setInterval(() => {
  console.log(JSON.stringify({ level: "debug", service: "worker", message: "worker_heartbeat" }));
}, heartbeatMs);

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  console.log(JSON.stringify({ level: "info", service: "worker", message: "worker_stopping", signal }));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
