import type { LatticeDefinition } from '@openmc-studio/schema';

interface LatticeCanvasProps {
  lattice?: LatticeDefinition;
  view: 'top' | 'section';
  selectedCell?: string;
  onSelectCell: (cell: string) => void;
}

const palette = ['#38bdf8', '#5eead4', '#fbbf24', '#a78bfa', '#fb7185', '#86efac'];

export function LatticeCanvas({ lattice, view, selectedCell, onSelectCell }: LatticeCanvasProps) {
  if (!lattice) {
    return (
      <div className="mock-canvas empty-canvas">
        <span>No lattice yet. Use geometry primitives or create a lattice.</span>
      </div>
    );
  }

  const rows = lattice.map;
  const columnCount = Math.max(...rows.map((row) => row.length));

  return (
    <div className={`lattice-canvas ${lattice.kind} ${view}`} style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(34px, 1fr))` }}>
      {rows.flatMap((row, rowIndex) =>
        Array.from({ length: columnCount }, (_, columnIndex) => {
          const cell = row[columnIndex] ?? '';
          const key = `${rowIndex}-${columnIndex}-${cell}`;
          const isSelected = selectedCell === key;
          const color = colorForCell(cell);

          return (
            <button
              key={key}
              className={isSelected ? 'lattice-cell selected' : 'lattice-cell'}
              style={{ '--cell-color': color } as React.CSSProperties}
              onClick={() => onSelectCell(key)}
              title={cell || 'empty'}
            >
              <span>{view === 'section' ? sectionLabel(cell, rowIndex) : cell || '-'}</span>
            </button>
          );
        }),
      )}
    </div>
  );
}

function colorForCell(cell: string): string {
  if (!cell) return 'rgba(148, 163, 184, 0.28)';
  let hash = 0;
  for (const character of cell) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return palette[hash % palette.length];
}

function sectionLabel(cell: string, rowIndex: number): string {
  if (!cell) return 'void';
  if (rowIndex === 0) return 'top';
  return cell.includes('reflector') ? 'refl' : 'fuel';
}
