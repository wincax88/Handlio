import "dotenv/config";
import { createApp } from "./app.js";
import { maintenance, processJobs } from "./jobs.js";
import { validateMailConfiguration } from "./mail.js";
if (process.env.NODE_ENV === "production") {
  if (
    !process.env.APP_ORIGIN?.startsWith("https://") ||
    (process.env.SESSION_SECRET?.length || 0) < 32
  )
    throw new Error(
      "Production requires HTTPS APP_ORIGIN and a random SESSION_SECRET.",
    );
}
validateMailConfiguration(process.env);
const app = createApp();
const port = Number(process.env.PORT || 3001);
const server = app.listen(
  port,
  process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
  () => console.log(`Handlio API listening on http://127.0.0.1:${port}`),
);
const jobs = setInterval(() => void processJobs(), 1000);
const upkeep = setInterval(() => void maintenance(), 60000);
void maintenance();
const close = () => {
  clearInterval(jobs);
  clearInterval(upkeep);
  server.close(() => process.exit(0));
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
