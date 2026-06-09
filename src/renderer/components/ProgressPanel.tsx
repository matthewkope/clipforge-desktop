import { FolderOpen } from 'lucide-react';
import type { DownloadProgress, DownloadResult } from '../../shared/media';

interface ProgressPanelProps {
  progress: DownloadProgress;
  result: DownloadResult | null;
  saveFolder?: string;
  onOpenFolder?: (path: string) => void;
}

export function ProgressPanel({ progress, result, saveFolder, onOpenFolder }: ProgressPanelProps) {
  const percent = progress.percent ?? 0;
  const savedPath = result?.savedPath || progress.savedPath || progress.filename;
  const savedPaths = result?.savedPaths ?? (savedPath ? [savedPath] : []);

  return (
    <section className="progress-panel">
      <div className="progress-header">
        <span>Progress</span>
        <strong>{progress.percentText || (percent > 0 ? `${Math.round(percent)}%` : '--')}</strong>
      </div>
      <div className="progress-track">
        <div style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div className="progress-stats">
        <span>Speed: {progress.speed || '--'}</span>
        <span>ETA: {progress.eta || '--'}</span>
      </div>
      <p>{progress.message || 'Waiting for a download.'}</p>
      {savedPaths.length > 0 && (
        <div className="saved-files">
          {savedPaths.map((path) => (
            <span key={path} title={path}>
              {fileName(path)}
            </span>
          ))}
        </div>
      )}
      {result?.failedItems && result.failedItems.length > 0 && (
        <div className="failed-files">
          <strong>{result.failedItems.length} failed</strong>
          {result.failedItems.slice(0, 6).map((item) => (
            <span key={item.id} title={item.reason}>
              {item.label || item.id}: {item.reason}
            </span>
          ))}
        </div>
      )}
      {saveFolder && onOpenFolder && (
        <div className="result-actions">
          <button onClick={() => onOpenFolder(saveFolder)}>
            <FolderOpen size={17} />
            Open saved folder
          </button>
        </div>
      )}
    </section>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}
