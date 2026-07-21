import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getEvaluation,
  getEvaluationOptions,
  getEvaluations,
  getExperimentLog,
  getLeaderboard,
  getRuntimeStats,
} from './api';
import type {
  EvaluationDetail,
  EvaluationOptions,
  EvaluationSummary,
  ExperimentDetail,
  LeaderboardRow,
} from './types';

type Filters = {
  planName: string[];
  dataName: string[];
  modelName: string[];
  taskType: string[];
  reprType: string[];
  runId: string[];
};

type SelectField = keyof Filters;

const DEFAULT_FILTERS: Filters = {
  planName: [],
  dataName: [],
  modelName: [],
  taskType: [],
  reprType: [],
  runId: [],
};

const FALLBACK_METRICS = ['ndcg@10', 'ndcg@20', 'hr@10', 'hr@20', 'mrr', 'loss'];

const FILTER_FIELDS: Array<{
  key: SelectField;
  label: string;
  optionKey: keyof EvaluationOptions;
}> = [
  { key: 'planName', label: 'PLAN', optionKey: 'plan_name' },
  { key: 'dataName', label: 'DATA', optionKey: 'data_name' },
  { key: 'modelName', label: 'MODEL', optionKey: 'model_name' },
  { key: 'taskType', label: 'TASK', optionKey: 'task_type' },
  { key: 'reprType', label: 'REPR', optionKey: 'repr_type' },
  { key: 'runId', label: 'RUN', optionKey: 'run_id' },
];

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) {
    return '—';
  }
  if (seconds < 60) {
    return `${seconds.toFixed(0)}s`;
  }
  if (seconds < 3600) {
    return `${(seconds / 60).toFixed(1)}m`;
  }
  return `${(seconds / 3600).toFixed(2)}h`;
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return value.toFixed(4);
}

function displayName(evaluation: Pick<EvaluationSummary, 'name' | 'run_id' | 'signature'>) {
  return evaluation.name || evaluation.run_id || evaluation.signature.slice(0, 12);
}

function bestMetricForEvaluation(evaluation: EvaluationSummary, metric: string) {
  const values = evaluation.experiments
    .map((experiment) => experiment.performance?.[metric])
    .filter((value): value is number => typeof value === 'number');
  if (!values.length) {
    return null;
  }
  return metric === 'loss' ? Math.min(...values) : Math.max(...values);
}

function statusTone(completed: number, running: number, failed: number) {
  if (running > 0) {
    return 'running';
  }
  if (failed > 0 && completed === 0) {
    return 'failed';
  }
  if (failed > 0) {
    return 'mixed';
  }
  return 'steady';
}

function normalizeStatus(status: string) {
  if (status === 'finished') {
    return 'completed';
  }
  return status || 'unknown';
}

function MetricLines({ metrics }: { metrics: Record<string, [number, number]> | null | undefined }) {
  const entries = Object.entries(metrics || {}).slice(0, 8);
  if (!entries.length) {
    return <p className="empty-copy">No metrics.</p>;
  }
  return (
    <div className="metric-lines">
      {entries.map(([key, [mean, std]]) => (
        <div key={key} className="metric-line">
          <span>{key}</span>
          <strong>
            {mean.toFixed(4)}
            <em>±{std.toFixed(4)}</em>
          </strong>
        </div>
      ))}
    </div>
  );
}

function ExperimentLog({ session }: { session: string }) {
  const [log, setLog] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getExperimentLog(session)
      .then((lines) => {
        if (!cancelled) {
          setLog(lines);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (loading) {
    return <div className="log-panel loading-shell">Loading log…</div>;
  }
  if (error) {
    return <div className="log-panel error-shell">{error}</div>;
  }
  return <pre className="log-panel">{(log || []).join('\n') || 'No log captured.'}</pre>;
}

function ChoiceBox({
  label,
  value,
  options,
  onChange,
  multiple = true,
  compact = false,
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = new Set(value);
  const visibleOptions = options
    .filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 80);
  const summary = value.length
    ? value.length === 1
      ? value[0]
      : `${value[0]} +${value.length - 1}`
    : 'All';

  function toggleOption(option: string) {
    if (multiple) {
      onChange(selected.has(option) ? value.filter((item) => item !== option) : [...value, option]);
      return;
    }
    onChange([option]);
    setOpen(false);
  }

  return (
    <div className={compact ? 'choice-control compact' : 'choice-control'}>
      <div className="choice-label">
        <span>{label}</span>
        {multiple && value.length ? (
          <button className="choice-clear" onClick={() => onChange([])} type="button">
            clear
          </button>
        ) : null}
      </div>
      <button
        className={`choice-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{summary}</span>
        <em>{multiple ? `${value.length}/${options.length || 0}` : 'one'}</em>
      </button>
      {open ? (
        <div className="choice-popover">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            autoFocus
          />
          <div className="choice-list">
            {visibleOptions.length ? (
              visibleOptions.map((option) => (
                <button
                  key={option}
                  className={selected.has(option) ? 'choice-option selected' : 'choice-option'}
                  onClick={() => toggleOption(option)}
                  type="button"
                >
                  <span>{selected.has(option) ? '✓' : ''}</span>
                  <strong>{option}</strong>
                </button>
              ))
            ) : (
              <p className="choice-empty">No match.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Drawer({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="overlay-head">
          <span>{title}</span>
          <button className="icon-button" onClick={onClose} aria-label="Close detail">
            ×
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function Sheet({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="overlay sheet-overlay" onMouseDown={onClose}>
      <section className="sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="overlay-head">
          <span>{title}</span>
          <button className="icon-button" onClick={onClose} aria-label="Close sheet">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ExperimentCard({
  experiment,
  onOpenLog,
}: {
  experiment: ExperimentDetail;
  onOpenLog: (session: string) => void;
}) {
  const status = normalizeStatus(experiment.status);
  return (
    <article className="experiment-card">
      <div className="experiment-topline">
        <div>
          <span className={`badge badge-${status}`}>{status}</span>
          <strong>seed {experiment.seed}</strong>
        </div>
        <span>{formatDuration(experiment.runtime_seconds)}</span>
      </div>
      <p className="experiment-meta">
        phase={experiment.phase || '—'} · best_epoch={experiment.best_epoch ?? '—'} · main={experiment.main_metric || '—'}
      </p>
      <div className="metric-chip-row">
        {Object.entries(experiment.performance || {})
          .slice(0, 6)
          .map(([metric, value]) => (
            <span key={metric} className="metric-chip">
              {metric}: {formatMetric(value)}
            </span>
          ))}
      </div>
      <button className="ghost-button" onClick={() => onOpenLog(experiment.session)}>
        Log
      </button>
    </article>
  );
}

function EvaluationDrawer({
  evaluation,
  loading,
  onOpenLog,
}: {
  evaluation: EvaluationDetail | null;
  loading: boolean;
  onOpenLog: (session: string) => void;
}) {
  if (loading) {
    return <div className="loading-shell">Loading detail…</div>;
  }
  if (!evaluation) {
    return <div className="empty-shell">Pick an evaluation.</div>;
  }
  return (
    <div className="detail-stack">
      <div className="detail-hero">
        <div className="detail-hero-copy">
          <h3 className="detail-title">{displayName(evaluation)}</h3>
          <p>
            {evaluation.model_name || 'model?'} · {evaluation.repr_type || 'repr?'} → {evaluation.task_type || 'task?'}
          </p>
        </div>
        <div className="detail-tags">
          {evaluation.plan_name ? <span>{evaluation.plan_name}</span> : null}
          {evaluation.data_name ? <span>{evaluation.data_name}</span> : null}
          {evaluation.sid_coder ? <span>sid:{evaluation.sid_coder}</span> : null}
          {evaluation.hash_coder ? <span>hash:{evaluation.hash_coder}</span> : null}
        </div>
      </div>

      <MetricLines metrics={evaluation.performance_summary} />

      <div className="experiment-grid">
        {evaluation.experiments.map((experiment) => (
          <ExperimentCard key={experiment.session} experiment={experiment} onOpenLog={onOpenLog} />
        ))}
      </div>

      <div className="detail-columns">
        <details className="detail-block">
          <summary>Configuration</summary>
          <pre>{JSON.stringify(evaluation.configuration, null, 2)}</pre>
        </details>
        <details className="detail-block">
          <summary>Command</summary>
          <pre>{evaluation.command}</pre>
        </details>
      </div>
    </div>
  );
}

export default function App() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [metric, setMetric] = useState('ndcg@10');
  const [replicate, setReplicate] = useState(1);

  const [options, setOptions] = useState<EvaluationOptions | null>(null);
  const [runtimeHours, setRuntimeHours] = useState<number | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [evaluationTotal, setEvaluationTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [selectedSignature, setSelectedSignature] = useState<string | null>(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState<EvaluationDetail | null>(null);
  const [openedLogSession, setOpenedLogSession] = useState<string | null>(null);

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [logSheetOpen, setLogSheetOpen] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvaluationOptions()
      .then((payload) => {
        if (!cancelled) {
          setOptions(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingOverview(true);
    setError(null);
    Promise.all([
      getRuntimeStats(),
      getEvaluations({
        page,
        pageSize,
        planName: filters.planName,
        dataName: filters.dataName,
        modelName: filters.modelName,
        taskType: filters.taskType,
        reprType: filters.reprType,
        runId: filters.runId,
      }),
      getLeaderboard({
        metric,
        replicate,
        dataName: filters.dataName,
        modelName: filters.modelName,
        taskType: filters.taskType,
        reprType: filters.reprType,
        limit: 12,
      }),
    ])
      .then(([runtime, evaluationList, leaderboardRows]) => {
        if (cancelled) {
          return;
        }
        setRuntimeHours(runtime.runtime_hours);
        setEvaluations(evaluationList.evaluations);
        setEvaluationTotal(evaluationList.total);
        setTotalPages(evaluationList.total_page || 1);
        setLeaderboard(leaderboardRows);
        setSelectedSignature((current) => {
          if (current && evaluationList.evaluations.some((evaluation) => evaluation.signature === current)) {
            return current;
          }
          return evaluationList.evaluations[0]?.signature || null;
        });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOverview(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters, metric, page, pageSize, replicate]);

  useEffect(() => {
    if (!selectedSignature) {
      setSelectedEvaluation(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    getEvaluation(selectedSignature)
      .then((detail) => {
        if (!cancelled) {
          setSelectedEvaluation(detail);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSignature]);

  const currentSnapshot = useMemo(() => {
    const completed = evaluations.reduce((sum, item) => sum + item.status_summary.completed, 0);
    const running = evaluations.reduce((sum, item) => sum + item.status_summary.running, 0);
    const failed = evaluations.reduce((sum, item) => sum + item.status_summary.failed, 0);
    return { completed, running, failed };
  }, [evaluations]);

  const metricOptions = options?.metrics?.length ? options.metrics : FALLBACK_METRICS;
  const activeFilterCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);
  const openedExperiment = selectedEvaluation?.experiments.find((experiment) => experiment.session === openedLogSession);

  function optionValues(field: keyof EvaluationOptions) {
    const values = options?.[field];
    return Array.isArray(values) ? values : [];
  }

  function updateFilter(key: SelectField, value: string[]) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function removeFilterValue(key: SelectField, value: string) {
    updateFilter(
      key,
      filters[key].filter((item) => item !== value),
    );
  }

  function openEvaluation(signature: string) {
    setSelectedSignature(signature);
    setDetailDrawerOpen(true);
  }

  function openLog(session: string) {
    setOpenedLogSession(session);
    setLogSheetOpen(true);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Secommenders</p>
          <h1>Experiment Workbench</h1>
        </div>
        <div className="summary-deck">
          <div>
            <span>runtime</span>
            <strong>{runtimeHours === null ? '—' : `${runtimeHours.toFixed(1)}h`}</strong>
          </div>
          <div>
            <span>evals</span>
            <strong>{evaluationTotal}</strong>
          </div>
          <div>
            <span>running</span>
            <strong>{currentSnapshot.running}</strong>
          </div>
        </div>
      </header>

      <section className="command-bar">
        <ChoiceBox
          compact
          label="DATA"
          value={filters.dataName}
          options={optionValues('data_name')}
          onChange={(value) => updateFilter('dataName', value)}
        />
        <ChoiceBox
          compact
          label="MODEL"
          value={filters.modelName}
          options={optionValues('model_name')}
          onChange={(value) => updateFilter('modelName', value)}
        />
        <ChoiceBox
          compact
          label="TASK"
          value={filters.taskType}
          options={optionValues('task_type')}
          onChange={(value) => updateFilter('taskType', value)}
        />
        <ChoiceBox
          compact
          label="REPR"
          value={filters.reprType}
          options={optionValues('repr_type')}
          onChange={(value) => updateFilter('reprType', value)}
        />
        <ChoiceBox
          compact
          multiple={false}
          label="METRIC"
          value={[metric]}
          options={metricOptions}
          onChange={(value) => setMetric(value[0] || FALLBACK_METRICS[0])}
        />
        <button className="primary-button" onClick={() => setFilterSheetOpen(true)}>
          Filters {activeFilterCount ? <span>{activeFilterCount}</span> : null}
        </button>
      </section>

      {activeFilterCount ? (
        <div className="active-filters">
          {FILTER_FIELDS.flatMap((field) =>
            filters[field.key].map((value) => (
              <button key={`${field.key}:${value}`} onClick={() => removeFilterValue(field.key, value)}>
                <span>{field.label}</span>
                {value}
              </button>
            )),
          )}
        </div>
      ) : null}

      {error ? <div className="error-shell">{error}</div> : null}

      <main className="workspace-grid">
        <section className="panel leaderboard-panel">
          <div className="section-head">
            <div>
              <p className="section-kicker">Leaderboard</p>
              <h2>{metric}</h2>
            </div>
            <span className="section-note">replicate ≥ {replicate}</span>
          </div>
          {loadingOverview ? (
            <div className="loading-shell">Loading leaderboard…</div>
          ) : (
            <div className="leaderboard-list">
              {leaderboard.map((row, index) => (
                <button
                  key={row.signature}
                  className={`leaderboard-entry ${selectedSignature === row.signature ? 'selected' : ''}`}
                  onClick={() => openEvaluation(row.signature)}
                >
                  <div className="leaderboard-rank">{String(index + 1).padStart(2, '0')}</div>
                  <div className="leaderboard-body">
                    <strong>{row.name || row.run_id || row.signature.slice(0, 10)}</strong>
                    <p>
                      {row.data_name} · {row.model_name} · {row.repr_type} → {row.task_type}
                    </p>
                  </div>
                  <div className="leaderboard-score">
                    <strong>{row.mean.toFixed(4)}</strong>
                    <em>±{row.std.toFixed(4)}</em>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel evaluations-panel">
          <div className="section-head">
            <div>
              <p className="section-kicker">Evaluations</p>
              <h2>{evaluationTotal} runs</h2>
            </div>
            <div className="inline-metrics">
              <span>completed {currentSnapshot.completed}</span>
              <span>failed {currentSnapshot.failed}</span>
            </div>
          </div>
          {loadingOverview ? (
            <div className="loading-shell">Loading evaluations…</div>
          ) : (
            <>
              <div className="evaluation-table">
                {evaluations.map((evaluation) => {
                  const tone = statusTone(
                    evaluation.status_summary.completed,
                    evaluation.status_summary.running,
                    evaluation.status_summary.failed,
                  );
                  return (
                    <button
                      key={evaluation.signature}
                      className={`evaluation-row ${selectedSignature === evaluation.signature ? 'selected' : ''}`}
                      onClick={() => openEvaluation(evaluation.signature)}
                    >
                      <div className="evaluation-row-main">
                        <div className="evaluation-title">
                          <strong>{displayName(evaluation)}</strong>
                          <p>
                            {evaluation.data_name} · {evaluation.model_name} · {evaluation.repr_type} →{' '}
                            {evaluation.task_type}
                          </p>
                        </div>
                        <div className="evaluation-meta">
                          <span className={`pill pill-${tone}`}>
                            {evaluation.status_summary.completed}/{evaluation.status_summary.total}
                          </span>
                          <span>{metric}: {formatMetric(bestMetricForEvaluation(evaluation, metric))}</span>
                          <span>{formatDate(evaluation.modified_at)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="pagination-bar">
                <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Prev
                </button>
                <span>
                  {page} / {totalPages}
                </span>
                <div className="page-size">
                  <ChoiceBox
                    compact
                    multiple={false}
                    label="ROWS"
                    value={[String(pageSize)]}
                    options={['10', '20', '50', '100']}
                    onChange={(value) => setPageSize(Number(value[0] || 20))}
                  />
                </div>
                <button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      </main>

      <Drawer open={detailDrawerOpen} title="Evaluation" onClose={() => setDetailDrawerOpen(false)}>
        <EvaluationDrawer evaluation={selectedEvaluation} loading={loadingDetail} onOpenLog={openLog} />
      </Drawer>

      <Sheet open={filterSheetOpen} title="Filters" onClose={() => setFilterSheetOpen(false)}>
        <div className="filter-sheet-grid">
          {FILTER_FIELDS.map((field) => (
            <ChoiceBox
              key={field.key}
              label={field.label}
              value={filters[field.key]}
              options={optionValues(field.optionKey)}
              onChange={(value) => updateFilter(field.key, value)}
            />
          ))}
          <ChoiceBox
            multiple={false}
            label="METRIC"
            value={[metric]}
            options={metricOptions}
            onChange={(value) => setMetric(value[0] || FALLBACK_METRICS[0])}
          />
          <label className="choice-control">
            <span>REPLICATE</span>
            <input
              type="number"
              min={1}
              value={replicate}
              onChange={(event) => setReplicate(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
        </div>
        <div className="sheet-actions">
          <button
            className="ghost-button"
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              setPage(1);
            }}
          >
            Clear
          </button>
          <button className="primary-button" onClick={() => setFilterSheetOpen(false)}>
            Apply
          </button>
        </div>
      </Sheet>

      <Sheet
        open={logSheetOpen && Boolean(openedLogSession)}
        title={openedExperiment ? `seed ${openedExperiment.seed} · ${normalizeStatus(openedExperiment.status)}` : 'Log'}
        onClose={() => setLogSheetOpen(false)}
      >
        {openedLogSession ? <ExperimentLog session={openedLogSession} /> : null}
      </Sheet>
    </div>
  );
}
