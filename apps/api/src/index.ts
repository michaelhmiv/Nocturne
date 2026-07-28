import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT || 3001);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
