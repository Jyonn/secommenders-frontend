export type ApiEnvelope<T> = {
  identifier: string;
  body: T;
  code: number;
  msg?: string;
};

export type ExperimentSummary = {
  session: string;
  seed: number;
  status: string;
  is_completed: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  performance: Record<string, number> | null;
  pid: number | null;
  phase: string;
  runtime_seconds: number | null;
  world_size: number | null;
  best_epoch: number | null;
  best_valid_metric: number | null;
};

export type EvaluationSummary = {
  signature: string;
  name: string;
  plan_name: string;
  command: string;
  data_name: string;
  model_name: string;
  task_type: string;
  repr_type: string;
  repr_source_model: string;
  repr_combine: string;
  sid_coder: string;
  hash_coder: string;
  run_id: string;
  compile_prepare_id: string;
  created_at: string;
  modified_at: string;
  comment: string;
  status_summary: {
    total: number;
    completed: number;
    running: number;
    failed: number;
  };
  experiments: ExperimentSummary[];
};

export type EvaluationListResponse = {
  evaluations: EvaluationSummary[];
  page: number;
  total_page: number;
  total: number;
};

export type ExperimentDetail = {
  signature: string;
  session: string;
  seed: number;
  status: string;
  phase: string;
  performance: Record<string, number> | null;
  meta: Record<string, unknown> | null;
  is_completed: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  pid: number | null;
  hostname: string;
  run_dir: string;
  log_path: string;
  command: string;
  error: string;
  runtime_seconds: number | null;
  world_size: number | null;
  best_epoch: number | null;
  best_valid_metric: number | null;
  main_metric: string;
  test_metric_name: string;
};

export type EvaluationDetail = Omit<EvaluationSummary, 'experiments'> & {
  configuration: Record<string, unknown> | null;
  performance_summary: Record<string, [number, number]>;
  experiments: ExperimentDetail[];
};

export type LeaderboardRow = {
  signature: string;
  name: string;
  plan_name: string;
  data_name: string;
  model_name: string;
  task_type: string;
  repr_type: string;
  run_id: string;
  metric: string;
  mean: number;
  std: number;
  replicate: number;
  performance: Record<string, [number, number]>;
};

export type RuntimeStats = {
  runtime_hours: number;
};

