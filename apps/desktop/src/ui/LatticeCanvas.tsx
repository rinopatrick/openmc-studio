import type { LatticeDefinition } from '@openmc-studio/schema';
import type { CSSProperties } from 'react';

interface LatticeCanvasProps {
  lattice?: LatticeDefinition;
  view: 'top' | 'section';
  selectedCell?: string;
  onSelectCell: (cell: string) => void;
}

const materialStyles: Record<string, { color: string; label: string }> = {
  fuel: { color: '#f59e0b', label: 'Fuel' },
  assembly: { color: '#f59e0b', label: 'Assembly' },
  reflector: { color: '#60a5fa', label: 'Reflector' },
  moderator: { color: '#38bdf8', label: 'Moderator' },
  water: { color: '#38bdf8', label: 'Water' },
  graphite: { color: '#94a3b8', label: 'Graphite' },
  experiment: { color: '#a78bfa', label: 'Experiment' },
  control: { color: '#ef4444', label: 'Control' },
  region: { color: '#5eead4', label: 'Region' },
};

export function LatticeCanvas({ lattice, view, selectedCell, onSelectCell }: LatticeCanvasProps) {
  if (!lattice) {
    return (
      <div className="mock-canvas empty-canvas">
        <span>No lattice yet. Use geometry primitives or create a lattice.</span>
      </div>
    );
  }

  const rows = normalizedRows(lattice);

  return (
    <div className={`reactor-canvas ${lattice.kind} ${view}`} aria-label={`${lattice.name} ${view} reactor view`}>
      <div className={view === 'top' ? 'reactor-vessel top-vessel' : 'reactor-vessel section-vessel'}>
        {view === 'top' ? (
          <CoreMap rows={rows} lattice={lattice} selectedCell={selectedCell} onSelectCell={onSelectCell} />
        ) : (
          <SectionMap rows={rows} selectedCell={selectedCell} onSelectCell={onSelectCell} />
        )}
      </div>
      <Legend rows={rows} />
    </div>
  );
}

function CoreMap({
  rows,
  lattice,
  selectedCell,
  onSelectCell,
}: {
  rows: string[][];
  lattice: LatticeDefinition;
  selectedCell?: string;
  onSelectCell: (cell: string) => void;
}) {
  const columnCount = Math.max(...rows.map((row) => row.length));

  return (
    <div className={`core-map ${lattice.kind}`} style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(42px, 1fr))` }}>
      {rows.flatMap((row, rowIndex) =>
        Array.from({ length: columnCount }, (_, columnIndex) => {
          const cell = row[columnIndex] ?? '';
          const key = `${rowIndex}-${columnIndex}-${cell || 'void'}`;
          const style = styleForCell(cell);
          const isSelected = selectedCell === key;

          return (
            <button
              key={key}
              className={isSelected ? 'lattice-cell selected' : 'lattice-cell'}
              style={{ '--cell-color': style.color } as CSSProperties}
              onClick={() => onSelectCell(key)}
              title={cell || 'void'}
            >
              <span className="cell-dot" />
              <span>{shortLabel(cell)}</span>
            </button>
          );
        }),
      )}
    </div>
  );
}

function SectionMap({ rows, selectedCell, onSelectCell }: { rows: string[][]; selectedCell?: string; onSelectCell: (cell: string) => void }) {
  const cells = rows.flat().filter(Boolean);
  const fuelCount = cells.filter((cell) => /fuel|assembly/.test(cell)).length || 1;
  const reflectorCount = cells.filter((cell) => /reflector|graphite|region/.test(cell)).length || 1;
  const sectionRows = [
    { id: 'upper-plenum', label: 'Upper plenum', cell: 'moderator', height: 18 },
    { id: 'control-bank', label: 'Control rods', cell: 'control', height: 16 },
    { id: 'active-core', label: `${fuelCount} fuel zones`, cell: 'fuel', height: 42 },
    { id: 'radial-reflector', label: `${reflectorCount} reflector zones`, cell: 'reflector', height: 22 },
    { id: 'lower-plenum', label: 'Lower plenum', cell: 'moderator', height: 18 },
  ];

  return (
    <div className="section-stack">
      {sectionRows.map((row, index) => {
        const key = `${index}-section-${row.id}`;
        const style = styleForCell(row.cell);
        return (
          <button
            key={row.id}
            className={selectedCell === key ? 'section-layer selected' : 'section-layer'}
            style={{ '--cell-color': style.color, '--layer-height': `${row.height}%` } as CSSProperties}
            onClick={() => onSelectCell(key)}
          >
            <span>{row.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Legend({ rows }: { rows: string[][] }) {
  const labels = Array.from(new Set(rows.flat().filter(Boolean).map((cell) => styleForCell(cell).label)));

  return (
    <div className="reactor-legend">
      {labels.map((label) => {
        const sample = rows.flat().find((cell) => styleForCell(cell).label === label) ?? label;
        return (
          <span key={label} style={{ '--cell-color': styleForCell(sample).color } as CSSProperties}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

function normalizedRows(lattice: LatticeDefinition): string[][] {
  if (lattice.map.length > 3) return lattice.map;
  if (lattice.kind === 'hex') {
    return [
      ['', 'reflector', 'reflector', 'reflector', ''],
      ['reflector', 'fuel', 'fuel', 'fuel', 'reflector'],
      ['reflector', 'fuel', 'control', 'fuel', 'reflector'],
      ['reflector', 'fuel', 'fuel', 'fuel', 'reflector'],
      ['', 'reflector', 'reflector', 'reflector', ''],
    ];
  }
  if (lattice.kind === 'irregular') {
    return [
      ['', 'reflector', 'region-a', 'reflector', ''],
      ['reflector', 'fuel-zone', 'fuel-zone', 'experiment', 'reflector'],
      ['region-b', 'fuel-zone', 'control', 'fuel-zone', 'region-c'],
      ['reflector', 'fuel-zone', 'fuel-zone', 'moderator', 'reflector'],
      ['', 'reflector', 'region-c', 'reflector', ''],
    ];
  }
  return [
    ['reflector', 'reflector', 'reflector', 'reflector', 'reflector'],
    ['reflector', 'assembly-a', 'assembly-a', 'assembly-b', 'reflector'],
    ['reflector', 'assembly-a', 'control', 'assembly-a', 'reflector'],
    ['reflector', 'assembly-b', 'assembly-a', 'assembly-a', 'reflector'],
    ['reflector', 'reflector', 'reflector', 'reflector', 'reflector'],
  ];
}

function styleForCell(cell: string): { color: string; label: string } {
  if (!cell) return { color: 'rgba(15, 23, 42, 0.72)', label: 'Void' };
  const key = Object.keys(materialStyles).find((candidate) => cell.includes(candidate));
  return key ? materialStyles[key] : { color: '#5eead4', label: 'Region' };
}

function shortLabel(cell: string): string {
  if (!cell) return '';
  if (cell.includes('control')) return 'CR';
  if (cell.includes('reflector')) return 'R';
  if (cell.includes('assembly')) return 'A';
  if (cell.includes('fuel')) return 'F';
  if (cell.includes('experiment')) return 'X';
  if (cell.includes('moderator')) return 'M';
  return cell.slice(0, 1).toUpperCase();
}
