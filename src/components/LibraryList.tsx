import React from 'react';
import type { Asset } from '../state/models';
import { Draggable } from 'react-beautiful-dnd';
import TagEditor from './TagEditor';

export default function LibraryList({
  assets,
  onChangeTags,
}: {
  assets: Asset[];
  onChangeTags: (assetId: string, tags: string[]) => void;
}) {
  return (
    <>
      {assets.map((asset, index) => (
        <Draggable key={asset.id} draggableId={`asset-${asset.id}`} index={index}>
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.draggableProps}
              {...provided.dragHandleProps}
              className={`content-item ${asset.type}`}
              title={asset.name}
            >
              <div>{asset.name}</div>
              <TagEditor
                tags={asset.tags || []}
                onChange={(next) => onChangeTags(asset.id, next)}
              />
            </div>
          )}
        </Draggable>
      ))}
    </>
  );
}

