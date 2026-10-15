import { config } from "dotenv";
config({ path: ".env.test", quiet: true });
config({ path: ".env.local", quiet: true });
if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: "test" });
