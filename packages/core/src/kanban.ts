// --- Kanban Board Data Model ---

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  columnId: string;
  labels?: string[];
  dueDate?: string; // "YYYY-MM-DD"
  order: number;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

export interface KanbanData {
  title: string;
  columns: KanbanColumn[];
}

// --- ID Generation ---

let cardCounter = 0;

export function generateCardId(): string {
  return `card-${Date.now().toString(36)}-${(++cardCounter).toString(36)}`;
}

// --- Default Data ---

export function createDefaultKanbanData(): KanbanData {
  return {
    title: "Project Board",
    columns: [
      {
        id: "todo",
        title: "To Do",
        cards: [
          {
            id: generateCardId(),
            title: "First task",
            columnId: "todo",
            order: 0,
          },
          {
            id: generateCardId(),
            title: "Second task",
            columnId: "todo",
            order: 1,
          },
        ],
      },
      {
        id: "in-progress",
        title: "In Progress",
        cards: [
          {
            id: generateCardId(),
            title: "Current work",
            columnId: "in-progress",
            order: 0,
          },
        ],
      },
      {
        id: "done",
        title: "Done",
        cards: [],
      },
    ],
  };
}

// --- Parser: kanban code block text → KanbanData ---

export function parseKanbanMarkdown(code: string): KanbanData | null {
  const lines = code.split("\n");

  const data: KanbanData = { title: "", columns: [] };
  const cards: KanbanCard[] = [];

  let section: "root" | "columns" | "cards" = "root";
  let currentColumn: Partial<KanbanColumn> | null = null;
  let currentCard: Partial<KanbanCard> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Top-level keys (non-indented lines only)
    const isTopLevel = !line.startsWith(" ") && !line.startsWith("\t");

    if (isTopLevel && /^title:\s*/.test(trimmed)) {
      data.title = trimmed.replace(/^title:\s*/, "");
      section = "root";
      continue;
    }

    if (isTopLevel && trimmed === "columns:") {
      section = "columns";
      // Flush any pending column
      if (currentColumn?.id) {
        data.columns.push({
          id: currentColumn.id,
          title: currentColumn.title || currentColumn.id,
          cards: [],
        });
      }
      currentColumn = null;
      continue;
    }

    if (isTopLevel && trimmed === "cards:") {
      // Flush last column
      if (currentColumn?.id) {
        data.columns.push({
          id: currentColumn.id,
          title: currentColumn.title || currentColumn.id,
          cards: [],
        });
        currentColumn = null;
      }
      // Flush last card
      if (currentCard?.id) {
        cards.push(finalizeCard(currentCard));
      }
      currentCard = null;
      section = "cards";
      continue;
    }

    if (section === "columns") {
      // New column item: "  - id: xxx"
      const itemIdMatch = trimmed.match(/^- id:\s*(.+)/);
      if (itemIdMatch) {
        // Flush previous column
        if (currentColumn?.id) {
          data.columns.push({
            id: currentColumn.id,
            title: currentColumn.title || currentColumn.id,
            cards: [],
          });
        }
        currentColumn = { id: itemIdMatch[1].trim() };
        continue;
      }

      // Column title: "    title: xxx"
      const titleMatch = trimmed.match(/^title:\s*(.+)/);
      if (titleMatch && currentColumn) {
        currentColumn.title = titleMatch[1].trim();
        continue;
      }
    }

    if (section === "cards") {
      // New card item: "  - id: xxx"
      const itemIdMatch = trimmed.match(/^- id:\s*(.+)/);
      if (itemIdMatch) {
        // Flush previous card
        if (currentCard?.id) {
          cards.push(finalizeCard(currentCard));
        }
        currentCard = { id: itemIdMatch[1].trim() };
        continue;
      }

      if (currentCard) {
        const colMatch = trimmed.match(/^column:\s*(.+)/);
        if (colMatch) {
          currentCard.columnId = colMatch[1].trim();
          continue;
        }

        const titleMatch = trimmed.match(/^title:\s*(.+)/);
        if (titleMatch) {
          currentCard.title = titleMatch[1].trim();
          continue;
        }

        const descMatch = trimmed.match(/^description:\s*(.+)/);
        if (descMatch) {
          currentCard.description = descMatch[1].trim();
          continue;
        }

        const labelsMatch = trimmed.match(/^labels:\s*(.+)/);
        if (labelsMatch) {
          currentCard.labels = labelsMatch[1]
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean);
          continue;
        }

        const dueMatch = trimmed.match(/^dueDate:\s*(.+)/);
        if (dueMatch) {
          currentCard.dueDate = dueMatch[1].trim();
          continue;
        }

        const orderMatch = trimmed.match(/^order:\s*(.+)/);
        if (orderMatch) {
          currentCard.order = parseInt(orderMatch[1], 10);
          continue;
        }
      }
    }
  }

  // Flush remaining
  if (currentColumn?.id) {
    data.columns.push({
      id: currentColumn.id,
      title: currentColumn.title || currentColumn.id,
      cards: [],
    });
  }
  if (currentCard?.id) {
    cards.push(finalizeCard(currentCard));
  }

  if (data.columns.length === 0) return null;

  // Distribute cards into columns
  for (const card of cards) {
    const col = data.columns.find((c) => c.id === card.columnId);
    if (col) {
      col.cards.push(card);
    } else if (data.columns.length > 0) {
      // Fallback: put in first column
      card.columnId = data.columns[0].id;
      data.columns[0].cards.push(card);
    }
  }

  // Sort cards within each column by order
  for (const col of data.columns) {
    col.cards.sort((a, b) => a.order - b.order);
  }

  return data;
}

function finalizeCard(partial: Partial<KanbanCard>): KanbanCard {
  return {
    id: partial.id || generateCardId(),
    title: partial.title || "Untitled",
    description: partial.description,
    columnId: partial.columnId || "",
    labels: partial.labels,
    dueDate: partial.dueDate,
    order: partial.order ?? 0,
  };
}

// --- Serializer: KanbanData → kanban code block text ---

export function kanbanDataToMarkdown(data: KanbanData): string {
  const lines: string[] = [];

  lines.push(`title: ${data.title || "Board"}`);
  lines.push("columns:");

  for (const col of data.columns) {
    lines.push(`  - id: ${col.id}`);
    lines.push(`    title: ${col.title}`);
  }

  lines.push("cards:");

  for (const col of data.columns) {
    for (let i = 0; i < col.cards.length; i++) {
      const card = col.cards[i];
      lines.push(`  - id: ${card.id}`);
      lines.push(`    column: ${col.id}`);
      lines.push(`    title: ${card.title}`);
      if (card.description) lines.push(`    description: ${card.description}`);
      if (card.labels && card.labels.length > 0)
        lines.push(`    labels: ${card.labels.join(", ")}`);
      if (card.dueDate) lines.push(`    dueDate: ${card.dueDate}`);
    }
  }

  return lines.join("\n");
}
