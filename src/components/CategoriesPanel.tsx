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
          if (!apiEnabled) {
            onChange([...categories, { id: 'temp-' + Date.now(), name, color }]);
            return;
          }

          onChange([...categories, { id: 'pending', name, color } as any]);
          try {
            const res = await createCategory({ name, color });
            if (res?.category) {
              // Replace pending with real category
              onChange([...categories, res.category]);
            } else {
              // Remove pending if no category returned
              onChange(categories);
            }
          } catch (e) {
            // On error, revert to original (removes pending)
            onChange(categories);
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

