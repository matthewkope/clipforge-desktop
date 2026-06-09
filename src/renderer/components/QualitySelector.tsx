import type { QualityOption } from '../../shared/media';

interface QualitySelectorProps {
  value: string;
  options: QualityOption[];
  onChange: (value: string) => void;
}

export function QualitySelector({ value, options, onChange }: QualitySelectorProps) {
  return (
    <label className="field-label">
      Quality
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
