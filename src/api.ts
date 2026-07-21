import type {
  ApiEnvelope,
  EvaluationDetail,
  EvaluationListResponse,
  EvaluationOptions,
  LeaderboardRow,
  RuntimeStats,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function buildQuery(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    search.set(key, String(value));
  });
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

async function fetchApi<T>(path: string) {
  const response = await fetch(`${API_BASE}${path}`);
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.identifier !== 'OK') {
    throw new Error(payload.msg || `Request failed: ${response.status}`);
  }
  return payload.body;
}

export function getRuntimeStats() {
  return fetchApi<RuntimeStats>('/stats/runtime-hours');
}

export function getEvaluations(params: {
  page: number;
  pageSize: number;
  planName?: string;
  dataName?: string;
  modelName?: string;
  taskType?: string;
  reprType?: string;
  runId?: string;
}) {
  return fetchApi<EvaluationListResponse>(
    `/evaluations/${buildQuery({
      page: params.page,
      page_size: params.pageSize,
      plan_name: params.planName,
      data_name: params.dataName,
      model_name: params.modelName,
      task_type: params.taskType,
      repr_type: params.reprType,
      run_id: params.runId,
    })}`,
  );
}

export function getEvaluation(signature: string) {
  return fetchApi<EvaluationDetail>(`/evaluations/${signature}`);
}

export function getEvaluationOptions() {
  return fetchApi<EvaluationOptions>('/evaluations/options');
}

export function getLeaderboard(params: {
  metric: string;
  replicate: number;
  dataName?: string;
  modelName?: string;
  taskType?: string;
  reprType?: string;
  limit?: number;
}) {
  return fetchApi<LeaderboardRow[]>(
    `/evaluations/leaderboard${buildQuery({
      metric: params.metric,
      replicate: params.replicate,
      data_name: params.dataName,
      model_name: params.modelName,
      task_type: params.taskType,
      repr_type: params.reprType,
      limit: params.limit ?? 12,
    })}`,
  );
}

export function getExperimentLog(session: string) {
  return fetchApi<string[]>(`/experiments/log${buildQuery({ session })}`);
}
