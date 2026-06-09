import { Search } from 'lucide-react';

interface UrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

export function UrlInput({ value, onChange, onAnalyze, isAnalyzing }: UrlInputProps) {
  return (
    <section className="url-panel">
      <label htmlFor="media-url">Paste URL</label>
      <div className="url-row">
        <input
          id="media-url"
          type="url"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onAnalyze();
            }
          }}
          placeholder="https://www.youtube.com/watch?v=..."
        />
        <button onClick={onAnalyze} disabled={isAnalyzing || value.trim().length === 0}>
          <Search size={18} />
          {isAnalyzing ? 'Analyzing' : 'Analyze'}
        </button>
      </div>
    </section>
  );
}
