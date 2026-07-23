import type { Run } from "./api";

export function runDisplayName(
  run: Run,
  agentNames: Record<string, string>,
  kbNames: Record<string, string>
): string {
  if (run.agent_id.startsWith("knowledge:")) {
    const kbId = run.agent_id.slice("knowledge:".length);
    return kbNames[kbId] ?? run.agent_id;
  }
  if (run.agent_id === "__execute__") {
    const params = run.input_params as Record<string, string>;
    if (params.prompt) return params.prompt.slice(0, 40);
    return `api: ${params.api_key_name ?? "external"}`;
  }
  return agentNames[run.agent_id] ?? run.agent_id;
}
