import { createHarness } from "@strands-agents/harness";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, ".env");
dotenv.config({ path: envPath });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentInstance: any = null;

export async function getAgent() {
  if (!agentInstance) {
    const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;

    if (!apiKey) {
      throw new Error(
        "AWS_BEARER_TOKEN_BEDROCK environment variable is not set. " +
          "Get your API key from AWS Bedrock console (https://console.aws.amazon.com/bedrock/) " +
          "and add it to your .env file in the bbna-hackmw26.client/src/api folder.",
      );
    }

    agentInstance = await createHarness({
      model: "amazon.nova-lite-v1:0",
    });
  }

  return agentInstance;
}

export async function analyzeData(data: unknown): Promise<string> {
  const agent = await getAgent();

  const prompt = `Analyze the following data and provide a concise summary with key insights:\n\n${JSON.stringify(data, null, 2)}`;

  const result = await agent.invoke(prompt);

  return result;
}
