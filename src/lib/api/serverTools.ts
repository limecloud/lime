import { safeInvoke } from "@/lib/dev-bridge";

export interface TestResult {
  success: boolean;
  status: number;
  body: string;
  time_ms: number;
  response_headers?: Record<string, string>;
}

export interface NetworkInfo {
  localhost: string;
  lan_ip: string | null;
  all_ips: string[];
}

export async function testApi(
  method: string,
  path: string,
  body: string | null,
  auth: boolean,
): Promise<TestResult> {
  return safeInvoke("test_api", { method, path, body, auth });
}

export async function getNetworkInfo(): Promise<NetworkInfo> {
  return safeInvoke("get_network_info");
}
