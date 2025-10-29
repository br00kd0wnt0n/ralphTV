import React, { useState, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

// Utility function to help with drag and drop
const reorder = (list, startIndex, endIndex) => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

function ContentScheduler() {
  // State for managing uploaded content and schedule
  const [uploadedContent, setUploadedContent] = useState([]);
  const [schedule, setSchedule] = useState({
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: []
  });

  // File upload handler
  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    const newContent = files.map(file => ({
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      file: file,
      type: file.type.startsWith('video/') ? 'video' : 
             file.type.startsWith('audio/') ? 'audio' : 'unknown'
    }));

    setUploadedContent(prev => [...prev, ...newContent]);
  };

  // Drag and drop handler
  const onDragEnd = (result) => {
    const { source, destination } = result;

    // Dropped outside a droppable area
    if (!destination) return;

    // Moving within uploaded content
    if (source.droppableId === 'uploaded-content') {
      const items = reorder(uploadedContent, source.index, destination.index);
      setUploadedContent(items);
      return;
    }

    // Moving between schedule days or within a day
    const sourceDay = source.droppableId;
    const destDay = destination.droppableId;

    // Create a copy of the current schedule
    const newSchedule = {...schedule};

    // Remove from source
    const [movedItem] = newSchedule[sourceDay].splice(source.index, 1);
    
    // Add to destination
    newSchedule[destDay].splice(destination.index, 0, movedItem);

    setSchedule(newSchedule);
  };

  return (
    <div className="content-scheduler">
      <div className="upload-section">
        <input 
          type="file" 
          accept="video/*,audio/*" 
          multiple 
          onChange={handleFileUpload}
        />
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="content-layout">
          {/* Uploaded Content Area */}
          <Droppable droppableId="uploaded-content">
            {(provided) => (
              <div 
                className="uploaded-content"
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                <h3>Uploaded Content</h3>
                {uploadedContent.map((item, index) => (
                  <Draggable key={item.id} draggableId={item.id} index={index}>
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={`content-item ${item.type}`}
                      >
                        {item.name}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          {/* Schedule Grid */}
          <div className="schedule-grid">
            {Object.entries(schedule).map(([day, content]) => (
              <Droppable key={day} droppableId={day}>
                {(provided) => (
                  <div 
                    className="schedule-day"
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                  >
                    <h4>{day}</h4>
                    {content.map((item, index) => (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`scheduled-item ${item.type}`}
                          >
                            {item.name}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}

export default ContentScheduler;
