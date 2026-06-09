import type { CookieSource } from '../../shared/media';

interface CookieSourceSelectorProps {
  value: CookieSource;
  cookieFilePath: string;
  onChange: (value: CookieSource) => void;
  onChooseFile: () => void;
  onClearFile: () => void;
}

const sources: Array<{ value: CookieSource; label: string }> = [
  { value: 'none', label: 'No browser cookies' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'safari', label: 'Safari' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'edge', label: 'Edge' },
  { value: 'brave', label: 'Brave' }
];

export function CookieSourceSelector({ value, cookieFilePath, onChange, onChooseFile, onClearFile }: CookieSourceSelectorProps) {
  return (
    <section className="cookie-panel">
      <label className="field-label">
        Browser cookies
        <select value={value} onChange={(event) => onChange(event.target.value as CookieSource)} disabled={Boolean(cookieFilePath)}>
          {sources.map((source) => (
            <option key={source.value} value={source.value}>
              {source.label}
            </option>
          ))}
        </select>
      </label>
      <div className="cookie-file-row">
        <button className="secondary-button" onClick={onChooseFile}>Choose cookies.txt</button>
        <button className="secondary-button" onClick={onClearFile} disabled={!cookieFilePath}>Clear</button>
      </div>
      <span className="hint">
        {cookieFilePath
          ? `Using ${cookieFilePath}`
          : 'Use browser cookies for sign-in checks. If macOS asks for a password and stalls, export cookies.txt and choose it here.'}
      </span>
    </section>
  );
}
