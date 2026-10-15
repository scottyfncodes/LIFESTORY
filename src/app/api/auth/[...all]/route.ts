import { getAuth } from "@/lib/auth";
import { configurationProblem } from "@/server/errors";

async function handle(request: Request) {
  try {
    const auth = await getAuth();
    return await auth.handler(request);
  } catch (error) {
    return configurationProblem(error);
  }
}

export const GET = handle;
export const POST = handle;
