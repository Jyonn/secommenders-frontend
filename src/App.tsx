import { useEffect, useMemo, useRef, useState } from 'react';
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
];

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

function formatEpoch(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return Math.round(value).toString();
}

function compactEvaluationTitle(evaluation: EvaluationDetail) {
  return [evaluation.data_name, evaluation.model_name, `${evaluation.repr_type || '?'}→${evaluation.task_type || '?'}`]
    .filter(Boolean)
    .join(' · ');
}

function normalizeStatus(status: string) {
  if (status === 'finished') {
    return 'completed';
  }
  return status || 'unknown';
}

function isDisplayMetric(key: string) {
  const lower = key.toLowerCase();
  if (lower.startsWith('beam_') || lower.includes('beam_width') || lower.includes('unique_items')) {
    return false;
  }
  return /@\d+$/.test(lower) || ['loss', 'mrr'].includes(lower) || lower.endsWith('_acc') || lower.endsWith('acc');
}

function performanceFromEvaluation(evaluation: EvaluationDetail) {
  return evaluation.experiments.find((experiment) => experiment.is_completed && experiment.performance)?.performance || null;
}

function MetricMatrix({ performance }: { performance: Record<string, number> | null | undefined }) {
  const metricEntries = Object.entries(performance || {}).filter(([key, value]) => {
    return typeof value === 'number' && isDisplayMetric(key);
  });
  if (!metricEntries.length) {
    return <p className="empty-copy">No metrics.</p>;
  }
  const matrix = new Map<string, Map<string, number>>();
  const scalarEntries: Array<[string, number]> = [];
  metricEntries.forEach(([key, value]) => {
    const match = key.toLowerCase().match(/^(.+)@(\d+)$/);
    if (!match) {
      scalarEntries.push([key, value]);
      return;
    }
    const [, name, k] = match;
    if (!matrix.has(name)) {
      matrix.set(name, new Map());
    }
    matrix.get(name)?.set(k, value);
  });
  const metricNames = Array.from(matrix.keys()).sort();
  const topKs = Array.from(new Set(metricNames.flatMap((name) => Array.from(matrix.get(name)?.keys() || [])))).sort(
    (left, right) => Number(left) - Number(right),
  );
  return (
    <div className="metric-board">
      {metricNames.length ? (
        <table className="metric-matrix">
          <thead>
            <tr>
              <th>metric</th>
              {topKs.map((k) => (
                <th key={k}>@{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricNames.map((name) => (
              <tr key={name}>
                <th>{name}</th>
                {topKs.map((k) => (
                  <td key={k}>{formatMetric(matrix.get(name)?.get(k))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {scalarEntries.length ? (
        <div className="metric-scalars">
          {scalarEntries.map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{formatMetric(value)}</strong>
            </div>
          ))}
        </div>
      ) : null}
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
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className={compact ? 'choice-control compact' : 'choice-control'}>
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
          .filter(([metric, value]) => typeof value === 'number' && isDisplayMetric(metric))
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

function EvaluationDetailPanel({
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
          <h3 className="detail-title">{compactEvaluationTitle(evaluation)}</h3>
          <dl className="detail-meta-list">
            {evaluation.run_id ? (
              <>
                <dt>run id</dt>
                <dd>{evaluation.run_id}</dd>
              </>
            ) : null}
            <dt>signature</dt>
            <dd>{evaluation.signature}</dd>
            {evaluation.plan_name ? (
              <>
                <dt>plan</dt>
                <dd>{evaluation.plan_name}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div className="detail-tags">
          {evaluation.repr_source_model ? <span>source:{evaluation.repr_source_model}</span> : null}
          {evaluation.repr_combine ? <span>combine:{evaluation.repr_combine}</span> : null}
          {evaluation.sid_coder ? <span>sid:{evaluation.sid_coder}</span> : null}
          {evaluation.hash_coder ? <span>hash:{evaluation.hash_coder}</span> : null}
        </div>
      </div>

      <MetricMatrix performance={performanceFromEvaluation(evaluation)} />

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
  const [metric, setMetric] = useState('ndcg@10');
  const [replicate, setReplicate] = useState(1);

  const [options, setOptions] = useState<EvaluationOptions | null>(null);
  const [runtimeHours, setRuntimeHours] = useState<number | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [evaluationTotal, setEvaluationTotal] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [selectedSignature, setSelectedSignature] = useState<string | null>(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState<EvaluationDetail | null>(null);
  const [openedLogSession, setOpenedLogSession] = useState<string | null>(null);

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
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
        page: 1,
        pageSize: 100,
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
        setLeaderboard(leaderboardRows);
        setSelectedSignature((current) => {
          const visibleSignatures = new Set([
            ...leaderboardRows.map((row) => row.signature),
            ...evaluationList.evaluations.map((evaluation) => evaluation.signature),
          ]);
          if (current && visibleSignatures.has(current)) {
            return current;
          }
          return leaderboardRows[0]?.signature || evaluationList.evaluations[0]?.signature || null;
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
  }, [filters, metric, replicate]);

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
          ) : leaderboard.length ? (
            <div className="leaderboard-list">
              {leaderboard.map((row, index) => (
                <button
                  key={row.signature}
                  className={`leaderboard-entry ${selectedSignature === row.signature ? 'selected' : ''}`}
                  onClick={() => openEvaluation(row.signature)}
                >
                  <div className="leaderboard-rank">{String(index + 1).padStart(2, '0')}</div>
                  <div className="leaderboard-body">
                    <strong>{[row.plan_name, row.data_name].filter(Boolean).join(' · ')}</strong>
                    <p>
                      {row.model_name} · {row.repr_type} → {row.task_type} · epoch {formatEpoch(row.avg_epoch)}
                    </p>
                  </div>
                  <div className="leaderboard-score">
                    <strong>{row.mean.toFixed(4)}</strong>
                    <em>±{row.std.toFixed(4)}</em>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-shell">No leaderboard rows for this filter.</div>
          )}
        </section>

        <section className="panel detail-panel">
          <div className="section-head">
            <div>
              <p className="section-kicker">Evaluation</p>
              <h2>{selectedEvaluation ? 'Detail' : 'No selection'}</h2>
            </div>
          </div>
          <EvaluationDetailPanel
            evaluation={selectedEvaluation}
            loading={loadingDetail || loadingOverview}
            onOpenLog={openLog}
          />
        </section>
      </main>

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
