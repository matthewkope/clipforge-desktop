import { useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, Image as ImageIcon, ListX, Play, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { DownloadHistoryEntry, DownloadProgress, DownloadQueueState, DownloadResult } from '../../shared/media';
import { ProgressPanel } from './ProgressPanel';

interface DownloadsPanelProps {
  progress: DownloadProgress;
  result: DownloadResult | null;
  saveFolder?: string;
  queue: DownloadQueueState;
  history: DownloadHistoryEntry[];
  onCancelAll: () => void;
  onRedownload: (entry: DownloadHistoryEntry) => void;
  onRemoveEntry: (id: string) => void;
  onClearHistory: () => void;
  onOpenPath: (path: string) => void;
  onShowInFolder: (path: string) => void;
}

const statusLabels: Record<DownloadHistoryEntry['status'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  finished: 'Finished',
  error: 'Failed',
  cancelled: 'Cancelled'
};

export function DownloadsPanel({
  progress,
  result,
  saveFolder,
  queue,
  history,
  onCancelAll,
  onRedownload,
  onRemoveEntry,
  onClearHistory,
  onOpenPath,
  onShowInFolder
}: DownloadsPanelProps) {
  const hasActivity = Boolean(queue.activeDownloadId) || queue.pendingCount > 0;
  const covers = useDownloadCovers(history);
  const [historyQuery, setHistoryQuery] = useState('');
  const filteredHistory = useMemo(() => filterHistory(history, historyQuery), [history, historyQuery]);

  return (
    <section className="workspace single-column">
      <div className="settings-panel">
        <div className="panel-heading">
          <Download size={22} />
          <div>
            <h2>Downloads</h2>
            <p>
              {queue.activeDownloadId
                ? `Downloading now${queue.pendingCount > 0 ? ` · ${queue.pendingCount} queued` : ''}`
                : queue.pendingCount > 0
                  ? `${queue.pendingCount} download${queue.pendingCount === 1 ? '' : 's'} queued`
                  : 'No active downloads.'}
            </p>
          </div>
        </div>

        {hasActivity && (
          <>
            <ProgressPanel progress={progress} result={result} saveFolder={saveFolder} onOpenFolder={onOpenPath} />
            <div className="action-row">
              <button className="secondary-button" onClick={onCancelAll}>
                <ListX size={16} />
                Cancel all
              </button>
            </div>
          </>
        )}

        <section className="pinterest-settings">
          <div className="panel-heading">
            <Download size={20} />
            <div>
              <h2>History</h2>
              <p>Every download — manual, extension clips, batches, galleries, and watch syncs — lands here.</p>
            </div>
          </div>

          {history.length > 0 && (
            <label className="field-label history-search">
              <span className="visually-hidden">Search history</span>
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={historyQuery}
                placeholder="Search history (title, URL, format, source, status)"
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
            </label>
          )}

          {history.length === 0 && <p className="hint">Nothing downloaded yet.</p>}
          {history.length > 0 && filteredHistory.length === 0 && <p className="hint">No matches.</p>}

          {filteredHistory.map((entry) => (
            <div key={entry.id} className="history-entry">
              <div className="history-entry-main">
                {(covers[entry.id] ?? entry.thumbnail) ? (
                  <img
                    className="history-cover"
                    src={covers[entry.id] ?? entry.thumbnail}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="history-cover history-cover-placeholder" aria-hidden="true">
                    <ImageIcon size={18} />
                  </div>
                )}
                <span className={`history-status ${entry.status}`}>{statusLabels[entry.status]}</span>
                <div className="history-entry-text">
                  <strong>{entry.title || fileName(entry.savedPaths[0]) || entry.url}</strong>
                  <span className="history-entry-url" title={entry.url}>
                    {entry.url}
                  </span>
                  <span className="hint">
                    {entry.label} · {sourceLabel(entry.source)} · {new Date(entry.createdAt).toLocaleString()}
                    {entry.savedPaths.length > 1 ? ` · ${entry.savedPaths.length} files` : ''}
                  </span>
                  {entry.error && <span className="hint history-error">{entry.error}</span>}
                </div>
              </div>
              <div className="history-entry-actions">
                {entry.savedPaths[0] && entry.status === 'finished' && (
                  <>
                    <button className="icon-button" title="Open file" onClick={() => onOpenPath(entry.savedPaths[0])}>
                      <Play size={16} />
                    </button>
                    <button className="icon-button" title="Show in Finder" onClick={() => onShowInFolder(entry.savedPaths[0])}>
                      <FolderOpen size={16} />
                    </button>
                  </>
                )}
                {(entry.status === 'finished' || entry.status === 'error' || entry.status === 'cancelled') && (
                  <>
                    <button className="icon-button" title="Download again" onClick={() => onRedownload(entry)}>
                      <RefreshCw size={16} />
                    </button>
                    <button className="icon-button" title="Remove from history" onClick={() => onRemoveEntry(entry.id)}>
                      <X size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {history.some((entry) => entry.status !== 'queued' && entry.status !== 'downloading') && (
            <div className="action-row">
              <button className="secondary-button" onClick={onClearHistory}>
                <Trash2 size={16} />
                Clear history
              </button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

// Case-insensitive substring match over the fields a user is likely to
// remember: title, URL, format label, source, and status.
function filterHistory(history: DownloadHistoryEntry[], query: string): DownloadHistoryEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return history;
  }
  return history.filter((entry) =>
    [
      entry.title ?? '',
      entry.url,
      entry.label,
      entry.source,
      sourceLabel(entry.source),
      entry.status,
      statusLabels[entry.status]
    ].some((field) => field.toLowerCase().includes(needle))
  );
}

function sourceLabel(source: DownloadHistoryEntry['source']): string {
  const labels: Record<DownloadHistoryEntry['source'], string> = {
    app: 'App',
    extension: 'Extension clip',
    batch: 'Batch',
    watch: 'Watch sync',
    gallery: 'Gallery'
  };
  return labels[source];
}

function fileName(path?: string): string | undefined {
  return path?.split(/[\\/]/).at(-1);
}

// Generate cover thumbnails from the downloaded files themselves (image decode
// or a video frame grab in the main process). This works for finished local
// files regardless of whether a remote thumbnail was captured at analyze time.
function useDownloadCovers(history: DownloadHistoryEntry[]): Record<string, string> {
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window.clipForge.getDownloadCover !== 'function') {
      return;
    }
    let cancelled = false;
    const pending = history.filter(
      (entry) => entry.status === 'finished' && entry.savedPaths[0] && !covers[entry.id]
    );

    void Promise.all(
      pending.map(async (entry) => {
        try {
          const cover = await window.clipForge.getDownloadCover(entry.savedPaths[0]);
          return cover ? ([entry.id, cover] as const) : null;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const next = results.filter((entry): entry is readonly [string, string] => entry !== null);
      if (next.length > 0) {
        setCovers((previous) => ({ ...previous, ...Object.fromEntries(next) }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [history]);

  return covers;
}
