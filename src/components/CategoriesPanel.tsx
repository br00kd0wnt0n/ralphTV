import React from 'react';
import type { Category } from '../state/models';
import CategoryManager from './CategoryManager';
import { createCategory, updateCategory, deleteCategory } from '../api/assets';

export default function CategoriesPanel({
  categories,
  onChange,
  apiEnabled,
}: {
  categories: Category[];
  onChange: (next: Category[]) => void;
  apiEnabled: boolean;
}) {
  return (
    <div className="categories-panel">
      <CategoryManager
        categories={categories}
        onCreate={async (name, color) => {
          onChange([...categories, { id: 'pending', name, color } as any]);
          if (apiEnabled) {
            try {
              const res = await createCategory({ name, color });
              if (res?.category) onChange(categories.concat(res.category));
            } finally {
              onChange((categories || []).filter(c => c.id !== 'pending'));
            }
          }
        }}
        onUpdate={async (id, patch) => {
          onChange(categories.map(c => (c.id === id ? { ...c, ...patch } : c)));
          if (apiEnabled) { try { await updateCategory(id, patch as any); } catch {} }
        }}
        onDelete={async (id) => {
          const old = categories;
          onChange(categories.filter(c => c.id !== id));
          if (apiEnabled) { try { await deleteCategory(id); } catch { onChange(old); } }
        }}
      />
    </div>
  );
}

