import { useEffect, useMemo, useState } from 'react';
import { getEvaluation, getEvaluations, getExperimentLog, getLeaderboard, getRuntimeStats } from './api';
import type { EvaluationDetail, EvaluationSummary, ExperimentDetail, LeaderboardRow } from './types';

type Filters = {
  planName: string;
  dataName: string;
  modelName: string;
  taskType: string;
  reprType: string;
  runId: string;
};

const DEFAULT_FILTERS: Filters = {
  planName: '',
  dataName: '',
  modelName: '',
  taskType: '',
  reprType: '',
  runId: '',
};

const METRIC_OPTIONS = ['hr@5', 'hr@10', 'hr@20', 'ndcg@5', 'ndcg@10', 'ndcg@20', 'loss'];

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
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

function MetricLines({ metrics }: { metrics: Record<string, [number, number]> | null | undefined }) {
  const entries = Object.entries(metrics || {}).slice(0, 6);
  if (!entries.length) {
    return <p className="empty-copy">No metric summary yet.</p>;
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

function ExperimentCard({
  experiment,
  active,
  onOpenLog,
}: {
  experiment: ExperimentDetail;
  active: boolean;
  onOpenLog: (session: string) => void;
}) {
  return (
    <article className={`experiment-card ${active ? 'active' : ''}`}>
      <div className="experiment-topline">
        <div>
          <span className={`badge badge-${experiment.status}`}>{experiment.status}</span>
          <strong>seed {experiment.seed}</strong>
        </div>
        <span>{formatDuration(experiment.runtime_seconds)}</span>
      </div>
      <p className="experiment-meta">
        phase={experiment.phase || '—'} · best_epoch={experiment.best_epoch ?? '—'} · main={experiment.main_metric || '—'}
      </p>
      <div className="metric-chip-row">
        {Object.entries(experiment.performance || {}).slice(0, 5).map(([metric, value]) => (
          <span key={metric} className="metric-chip">
            {metric}: {formatMetric(value)}
          </span>
        ))}
      </div>
      <button className="ghost-button" onClick={() => onOpenLog(experiment.session)}>
        Open log
      </button>
    </article>
  );
}

export default function App() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [metric, setMetric] = useState('ndcg@10');
  const [replicate, setReplicate] = useState(1);

  const [runtimeHours, setRuntimeHours] = useState<number | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [evaluationTotal, setEvaluationTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [selectedSignature, setSelectedSignature] = useState<string | null>(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState<EvaluationDetail | null>(null);
  const [openedLogSession, setOpenedLogSession] = useState<string | null>(null);

  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        if (!selectedSignature && evaluationList.evaluations[0]) {
          setSelectedSignature(evaluationList.evaluations[0].signature);
        }
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
  }, [filters, metric, page, pageSize, replicate, selectedSignature]);

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
          if (!openedLogSession && detail.experiments[0]) {
            setOpenedLogSession(detail.experiments[0].session);
          }
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
  }, [openedLogSession, selectedSignature]);

  const currentSnapshot = useMemo(() => {
    const completed = evaluations.reduce((sum, item) => sum + item.status_summary.completed, 0);
    const running = evaluations.reduce((sum, item) => sum + item.status_summary.running, 0);
    const failed = evaluations.reduce((sum, item) => sum + item.status_summary.failed, 0);
    return { completed, running, failed };
  }, [evaluations]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Secommenders / Experiment desk</p>
          <h1>Read the benchmark like an editor, not a logfile.</h1>
          <p className="hero-text">
            A lightweight frontend for the Secommenders backend: scan rankings, audit runs, compare seeds,
            and crack open logs without touching the database.
          </p>
        </div>
        <div className="hero-summary">
          <div className="summary-ribbon">
            <span>runtime</span>
            <strong>{runtimeHours === null ? '—' : `${runtimeHours.toFixed(1)}h`}</strong>
          </div>
          <div className="summary-ribbon">
            <span>visible evals</span>
            <strong>{evaluationTotal}</strong>
          </div>
          <div className="summary-ribbon">
            <span>running</span>
            <strong>{currentSnapshot.running}</strong>
          </div>
        </div>
      </header>

      <section className="control-strip">
        <div className="filter-grid">
          <label>
            <span>Plan</span>
            <input
              value={filters.planName}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, planName: event.target.value }));
              }}
              placeholder="basic_recifvideo"
            />
          </label>
          <label>
            <span>Data</span>
            <input
              value={filters.dataName}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, dataName: event.target.value }));
              }}
              placeholder="mind"
            />
          </label>
          <label>
            <span>Model</span>
            <input
              value={filters.modelName}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, modelName: event.target.value }));
              }}
              placeholder="llama3"
            />
          </label>
          <label>
            <span>Task</span>
            <input
              value={filters.taskType}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, taskType: event.target.value }));
              }}
              placeholder="sid"
            />
          </label>
          <label>
            <span>Repr</span>
            <input
              value={filters.reprType}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, reprType: event.target.value }));
              }}
              placeholder="sid+text"
            />
          </label>
          <label>
            <span>Run ID</span>
            <input
              value={filters.runId}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, runId: event.target.value }));
              }}
              placeholder="llama3__sid2sid"
            />
          </label>
          <label>
            <span>Metric</span>
            <select value={metric} onChange={(event) => setMetric(event.target.value)}>
              {METRIC_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Replicate</span>
            <input
              type="number"
              min={1}
              value={replicate}
              onChange={(event) => setReplicate(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
        </div>
      </section>

      {error ? <div className="error-shell">{error}</div> : null}

      <main className="workspace-grid">
        <section className="panel leaderboard-panel">
          <div className="section-head">
            <div>
              <p className="section-kicker">Leaderboard</p>
              <h2>What is actually winning</h2>
            </div>
            <span className="section-note">metric={metric}</span>
          </div>
          {loadingOverview ? (
            <div className="loading-shell">Loading leaderboard…</div>
          ) : (
            <div className="leaderboard-list">
              {leaderboard.map((row, index) => (
                <button
                  key={row.signature}
                  className={`leaderboard-entry ${selectedSignature === row.signature ? 'selected' : ''}`}
                  onClick={() => setSelectedSignature(row.signature)}
                >
                  <div className="leaderboard-rank">{String(index + 1).padStart(2, '0')}</div>
                  <div className="leaderboard-body">
                    <strong>{row.name || row.run_id || row.signature.slice(0, 10)}</strong>
                    <p>
                      {row.model_name} · {row.repr_type} → {row.task_type}
                    </p>
                  </div>
                  <div className="leaderboard-score">
                    <span>{row.metric}</span>
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
              <h2>Runs in circulation</h2>
            </div>
            <div className="inline-metrics">
              <span>completed {currentSnapshot.completed}</span>
              <span>running {currentSnapshot.running}</span>
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
                      onClick={() => {
                        setSelectedSignature(evaluation.signature);
                        setOpenedLogSession(null);
                      }}
                    >
                      <div className="evaluation-row-main">
                        <div className="evaluation-title">
                          <strong>{evaluation.name || evaluation.run_id || evaluation.signature.slice(0, 12)}</strong>
                          <p>
                            {evaluation.model_name} · {evaluation.repr_type} → {evaluation.task_type}
                          </p>
                        </div>
                        <div className="evaluation-meta">
                          <span className={`pill pill-${tone}`}>
                            {evaluation.status_summary.completed}/{evaluation.status_summary.total} done
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
                  Previous
                </button>
                <span>
                  Page {page} / {totalPages}
                </span>
                <label className="page-size">
                  <span>rows</span>
                  <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                    {[10, 20, 50].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
                  Next
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel detail-panel">
          <div className="section-head">
            <div>
              <p className="section-kicker">Evaluation detail</p>
              <h2>Explain the run, then show the evidence</h2>
            </div>
            {selectedEvaluation ? <span className="section-note">{selectedEvaluation.signature.slice(0, 12)}</span> : null}
          </div>

          {loadingDetail ? (
            <div className="loading-shell">Loading detail…</div>
          ) : !selectedEvaluation ? (
            <div className="empty-shell">Pick an evaluation from the list or leaderboard.</div>
          ) : (
            <div className="detail-stack">
              <div className="detail-hero">
                <div>
                  <h3>{selectedEvaluation.name || selectedEvaluation.run_id}</h3>
                  <p>
                    {selectedEvaluation.model_name} · {selectedEvaluation.repr_type} → {selectedEvaluation.task_type}
                  </p>
                </div>
                <div className="detail-tags">
                  {selectedEvaluation.plan_name ? <span>{selectedEvaluation.plan_name}</span> : null}
                  {selectedEvaluation.data_name ? <span>{selectedEvaluation.data_name}</span> : null}
                  {selectedEvaluation.sid_coder ? <span>sid:{selectedEvaluation.sid_coder}</span> : null}
                  {selectedEvaluation.hash_coder ? <span>hash:{selectedEvaluation.hash_coder}</span> : null}
                </div>
              </div>

              <MetricLines metrics={selectedEvaluation.performance_summary} />

              <div className="detail-columns">
                <div className="detail-block">
                  <h4>Configuration snapshot</h4>
                  <pre>{JSON.stringify(selectedEvaluation.configuration, null, 2)}</pre>
                </div>
                <div className="detail-block">
                  <h4>Command</h4>
                  <pre>{selectedEvaluation.command}</pre>
                </div>
              </div>

              <div className="experiment-grid">
                {selectedEvaluation.experiments.map((experiment) => (
                  <ExperimentCard
                    key={experiment.session}
                    experiment={experiment}
                    active={openedLogSession === experiment.session}
                    onOpenLog={setOpenedLogSession}
                  />
                ))}
              </div>

              {openedLogSession ? (
                <div className="detail-block">
                  <h4>Experiment log</h4>
                  <ExperimentLog session={openedLogSession} />
                </div>
              ) : null}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

