import React, { useMemo, useState } from 'react';
import type { Category } from '../state/models';
import { makeId } from '../state/schedule';

export default function CategoryManager({
  categories,
  onChange,
}: {
  categories: Category[];
  onChange: (next: Category[]) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8e8e8e');
  const existingNames = useMemo(() => new Set(categories.map(c => c.name.toLowerCase())), [categories]);

  const add = () => {
    const n = name.trim();
    if (!n || existingNames.has(n.toLowerCase())) return;
    onChange([...categories, { id: makeId(), name: n, color }]);
    setName('');
  };

  const update = (id: string, patch: Partial<Category>) => {
    onChange(categories.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const remove = (id: string) => onChange(categories.filter(c => c.id !== id));

  return (
    <div>
      <h3>Categories</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input placeholder="New category name" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <button onClick={add}>Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {categories.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: c.color }} />
            <input value={c.name} onChange={e => update(c.id, { name: e.target.value })} style={{ flex: 1 }} />
            <input type="color" value={c.color} onChange={e => update(c.id, { color: e.target.value })} />
            <button onClick={() => remove(c.id)} title="Delete">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

