import { useState, useRef, useEffect, useCallback } from "react";
import type { KanbanData, KanbanColumn, KanbanCard } from "@pennivo/core";
import { generateCardId } from "@pennivo/core";
import "./KanbanEditorPanel.css";

interface KanbanEditorPanelProps {
  data: KanbanData;
  anchorRect: { top: number; left: number; width: number };
  onUpdate: (data: KanbanData) => void;
  onClose: () => void;
}

export function KanbanEditorPanel({
  data,
  anchorRect,
  onUpdate,
  onClose,
}: KanbanEditorPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Track which card is expanded for editing
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  // Drag state
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Focus title on mount
  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingCardId) {
          setEditingCardId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, editingCardId]);

  // Close card editor when clicking outside the active card
  useEffect(() => {
    if (!editingCardId) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const card = target.closest(".kanban-card");
      if (!card || card.getAttribute("data-card-id") !== editingCardId) {
        setEditingCardId(null);
      }
    };
    // Use setTimeout so the current click that opened editing doesn't immediately close it
    const t = setTimeout(
      () => document.addEventListener("mousedown", handleDown),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleDown);
    };
  }, [editingCardId]);

  // --- Helpers ---

  const updateData = useCallback(
    (updater: (d: KanbanData) => KanbanData) => {
      onUpdate(updater(data));
    },
    [data, onUpdate],
  );

  const setTitle = useCallback(
    (title: string) => updateData((d) => ({ ...d, title })),
    [updateData],
  );

  const updateColumn = useCallback(
    (colId: string, updater: (c: KanbanColumn) => KanbanColumn) =>
      updateData((d) => ({
        ...d,
        columns: d.columns.map((c) => (c.id === colId ? updater(c) : c)),
      })),
    [updateData],
  );

  const updateCard = useCallback(
    (cardId: string, updater: (c: KanbanCard) => KanbanCard) =>
      updateData((d) => ({
        ...d,
        columns: d.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) => (c.id === cardId ? updater(c) : c)),
        })),
      })),
    [updateData],
  );

  const addColumn = useCallback(() => {
    const id = `col-${Date.now().toString(36)}`;
    updateData((d) => ({
      ...d,
      columns: [
        ...d.columns,
        { id, title: `Column ${d.columns.length + 1}`, cards: [] },
      ],
    }));
  }, [updateData]);

  const removeColumn = useCallback(
    (colId: string) =>
      updateData((d) => ({
        ...d,
        columns: d.columns.filter((c) => c.id !== colId),
      })),
    [updateData],
  );

  const addCard = useCallback(
    (colId: string) => {
      const cardId = generateCardId();
      updateColumn(colId, (col) => ({
        ...col,
        cards: [
          ...col.cards,
          {
            id: cardId,
            title: "New card",
            columnId: colId,
            order: col.cards.length,
          },
        ],
      }));
      setEditingCardId(cardId);
    },
    [updateColumn],
  );

  const removeCard = useCallback(
    (cardId: string) => {
      if (editingCardId === cardId) setEditingCardId(null);
      updateData((d) => ({
        ...d,
        columns: d.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((c) => c.id !== cardId),
        })),
      }));
    },
    [updateData, editingCardId],
  );

  // --- Drag and drop ---

  const handleDragStart = useCallback((e: React.DragEvent, cardId: string) => {
    setDragCardId(cardId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
    // Semi-transparent drag ghost
    const el = e.currentTarget as HTMLElement;
    el.classList.add("kanban-card--dragging");
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("kanban-card--dragging");
    setDragCardId(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(colId);
  }, []);

  const handleDragLeave = useCallback(
    (e: React.DragEvent, colId: string) => {
      // Only clear if actually leaving the column (not entering a child)
      const related = e.relatedTarget as HTMLElement | null;
      const container = e.currentTarget as HTMLElement;
      if (!related || !container.contains(related)) {
        if (dropTarget === colId) setDropTarget(null);
      }
    },
    [dropTarget],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetColId: string) => {
      e.preventDefault();
      setDropTarget(null);

      const cardId = e.dataTransfer.getData("text/plain");
      if (!cardId) return;

      // Find where the card was dropped (above which card in the target column)
      const cardsContainer = e.currentTarget as HTMLElement;
      const cardEls = Array.from(
        cardsContainer.querySelectorAll(".kanban-card"),
      );
      let insertIndex = -1; // -1 means append at end

      for (let i = 0; i < cardEls.length; i++) {
        const rect = cardEls[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          // Check if this is the dragged card itself
          const elCardId = (cardEls[i] as HTMLElement).dataset.cardId;
          if (elCardId === cardId) continue;
          insertIndex = i;
          break;
        }
      }

      updateData((d) => {
        // Remove card from source column
        let movedCard: KanbanCard | null = null;
        const newColumns = d.columns.map((col) => {
          const idx = col.cards.findIndex((c) => c.id === cardId);
          if (idx >= 0) {
            movedCard = { ...col.cards[idx], columnId: targetColId };
            return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
          }
          return col;
        });

        if (!movedCard) return d;

        // Insert card into target column
        return {
          ...d,
          columns: newColumns.map((col) => {
            if (col.id !== targetColId) return col;
            const cards = [...col.cards];
            if (insertIndex >= 0 && insertIndex <= cards.length) {
              cards.splice(insertIndex, 0, movedCard!);
            } else {
              cards.push(movedCard!);
            }
            // Re-order
            return { ...col, cards: cards.map((c, i) => ({ ...c, order: i })) };
          }),
        };
      });

      setDragCardId(null);
    },
    [updateData],
  );

  // Position panel — clamp to viewport
  const style: React.CSSProperties = (() => {
    const panelWidth = 800;
    const panelMaxHeight = Math.min(window.innerHeight - 80, 520);
    let top = anchorRect.top + 8;
    let left = anchorRect.left;

    // Center if possible
    const center = anchorRect.left + anchorRect.width / 2 - panelWidth / 2;
    if (center > 16 && center + panelWidth < window.innerWidth - 16) {
      left = center;
    } else {
      if (left + panelWidth > window.innerWidth - 16) {
        left = window.innerWidth - panelWidth - 16;
      }
      if (left < 16) left = 16;
    }

    if (top + panelMaxHeight > window.innerHeight - 16) {
      top = Math.max(16, anchorRect.top - panelMaxHeight - 8);
    }

    return { top, left, maxHeight: panelMaxHeight };
  })();

  return (
    <div className="kanban-editor" ref={panelRef} style={style}>
      {/* Header */}
      <div className="kanban-editor-header">
        <span className="kanban-editor-label">Kanban</span>
        <button className="kanban-editor-close" onClick={onClose} title="Close">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {/* Title */}
      <div className="kanban-editor-title-row">
        <input
          ref={titleRef}
          className="kanban-input kanban-input--title"
          type="text"
          placeholder="Board title"
          value={data.title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Columns */}
      <div className="kanban-editor-body">
        {data.columns.map((col) => (
          <div key={col.id} className="kanban-col">
            <div className="kanban-col-header">
              <input
                className="kanban-col-title"
                type="text"
                value={col.title}
                onChange={(e) =>
                  updateColumn(col.id, (c) => ({ ...c, title: e.target.value }))
                }
                placeholder="Column title"
              />
              <span className="kanban-col-count">{col.cards.length}</span>
              {data.columns.length > 1 && (
                <button
                  className="kanban-col-remove"
                  onClick={() => removeColumn(col.id)}
                  title="Remove column"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              )}
            </div>

            <div
              className={`kanban-col-cards${dropTarget === col.id && dragCardId ? " kanban-drop-target" : ""}`}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={(e) => handleDragLeave(e, col.id)}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {col.cards.map((card) => (
                <div
                  key={card.id}
                  className={`kanban-card${dragCardId === card.id ? " kanban-card--dragging" : ""}`}
                  draggable
                  data-card-id={card.id}
                  onDragStart={(e) => handleDragStart(e, card.id)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="kanban-card-title-row">
                    <span
                      className="kanban-card-title"
                      onClick={() =>
                        setEditingCardId(
                          editingCardId === card.id ? null : card.id,
                        )
                      }
                    >
                      {card.title}
                    </span>
                    <button
                      className="kanban-card-remove"
                      onClick={() => removeCard(card.id)}
                      title="Remove card"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <line x1="4" y1="4" x2="12" y2="12" />
                        <line x1="12" y1="4" x2="4" y2="12" />
                      </svg>
                    </button>
                  </div>

                  {card.labels &&
                    card.labels.length > 0 &&
                    editingCardId !== card.id && (
                      <div className="kanban-card-labels">
                        {card.labels.map((l) => (
                          <span key={l} className="kanban-card-label">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}

                  {card.dueDate && editingCardId !== card.id && (
                    <div className="kanban-card-due">{card.dueDate}</div>
                  )}

                  {/* Inline editor */}
                  {editingCardId === card.id && (
                    <div className="kanban-card-edit">
                      <span className="kanban-card-edit-label">Title</span>
                      <input
                        className="kanban-card-edit-input"
                        type="text"
                        value={card.title}
                        onChange={(e) =>
                          updateCard(card.id, (c) => ({
                            ...c,
                            title: e.target.value,
                          }))
                        }
                        placeholder="Card title"
                        autoFocus
                      />
                      <span className="kanban-card-edit-label">
                        Description
                      </span>
                      <input
                        className="kanban-card-edit-input"
                        type="text"
                        value={card.description || ""}
                        onChange={(e) =>
                          updateCard(card.id, (c) => ({
                            ...c,
                            description: e.target.value || undefined,
                          }))
                        }
                        placeholder="Optional description"
                      />
                      <span className="kanban-card-edit-label">
                        Labels (comma-separated)
                      </span>
                      <LabelsInput
                        labels={card.labels}
                        onChange={(labels) =>
                          updateCard(card.id, (c) => ({
                            ...c,
                            labels: labels.length > 0 ? labels : undefined,
                          }))
                        }
                      />
                      <span className="kanban-card-edit-label">Due date</span>
                      <input
                        className="kanban-card-edit-input"
                        type="date"
                        value={card.dueDate || ""}
                        onChange={(e) =>
                          updateCard(card.id, (c) => ({
                            ...c,
                            dueDate: e.target.value || undefined,
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button className="kanban-add-card" onClick={() => addCard(col.id)}>
              + Add card
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="kanban-editor-footer">
        <button className="kanban-add-col" onClick={addColumn}>
          + Add column
        </button>
        <span className="kanban-editor-hint">Drag cards between columns</span>
      </div>
    </div>
  );
}

function LabelsInput({
  labels,
  onChange,
}: {
  labels?: string[];
  onChange: (labels: string[]) => void;
}) {
  const [text, setText] = useState(labels?.join(", ") || "");

  // Sync from parent when switching cards
  useEffect(() => {
    setText(labels?.join(", ") || "");
  }, [labels?.join(",")]);

  const commit = useCallback(() => {
    const parsed = text
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    onChange(parsed);
  }, [text, onChange]);

  return (
    <input
      className="kanban-card-edit-input"
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      placeholder="e.g. design, urgent"
    />
  );
}
