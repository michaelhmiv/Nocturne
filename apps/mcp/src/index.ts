import { loadMcpConfig } from "./config.js";
import { installOAuthClientKeyRotationCompatibility } from "./oauth-client-compat.js";
import { createMcpServer } from "./server.js";

installOAuthClientKeyRotationCompatibility();

const config = loadMcpConfig();
const server = createMcpServer(config);

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Nocturne MCP listening",
      host: config.host,
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      apiBaseUrl: config.apiBaseUrl,
    }),
  );
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) console.error(error);
      process.exitCode = error ? 1 : 0;
    });
  });
}
