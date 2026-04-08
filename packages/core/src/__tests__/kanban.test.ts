import { describe, it, expect } from 'vitest';
import {
  parseKanbanMarkdown,
  kanbanDataToMarkdown,
  generateCardId,
  createDefaultKanbanData,
} from '../kanban';

// --- parseKanbanMarkdown ---

describe('parseKanbanMarkdown', () => {
  it('parses a basic kanban board with title and columns', () => {
    const input = `title: My Board
columns:
  - id: todo
    title: To Do
  - id: done
    title: Done
cards:
  - id: c1
    column: todo
    title: First task
    order: 0`;

    const result = parseKanbanMarkdown(input);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('My Board');
    expect(result!.columns).toHaveLength(2);
    expect(result!.columns[0].title).toBe('To Do');
    expect(result!.columns[0].cards).toHaveLength(1);
    expect(result!.columns[0].cards[0].title).toBe('First task');
  });

  it('returns null for empty string', () => {
    expect(parseKanbanMarkdown('')).toBeNull();
  });

  it('returns null for non-kanban input (no columns)', () => {
    expect(parseKanbanMarkdown('just some random text\nwith no structure')).toBeNull();
  });

  it('handles columns with cards', () => {
    const input = `title: Board
columns:
  - id: todo
    title: To Do
  - id: doing
    title: Doing
cards:
  - id: c1
    column: todo
    title: Task A
    order: 0
  - id: c2
    column: doing
    title: Task B
    order: 0`;

    const result = parseKanbanMarkdown(input)!;
    expect(result.columns[0].cards).toHaveLength(1);
    expect(result.columns[0].cards[0].title).toBe('Task A');
    expect(result.columns[1].cards).toHaveLength(1);
    expect(result.columns[1].cards[0].title).toBe('Task B');
  });

  it('handles cards with labels', () => {
    const input = `title: Board
columns:
  - id: todo
    title: To Do
cards:
  - id: c1
    column: todo
    title: Bug fix
    labels: bug, urgent
    order: 0`;

    const result = parseKanbanMarkdown(input)!;
    expect(result.columns[0].cards[0].labels).toEqual(['bug', 'urgent']);
  });

  it('handles cards with descriptions', () => {
    const input = `title: Board
columns:
  - id: todo
    title: To Do
cards:
  - id: c1
    column: todo
    title: Research
    description: Look into new frameworks
    order: 0`;

    const result = parseKanbanMarkdown(input)!;
    expect(result.columns[0].cards[0].description).toBe('Look into new frameworks');
  });

  it('handles empty columns (no cards)', () => {
    const input = `title: Board
columns:
  - id: todo
    title: To Do
  - id: done
    title: Done
cards:`;

    const result = parseKanbanMarkdown(input)!;
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].cards).toHaveLength(0);
    expect(result.columns[1].cards).toHaveLength(0);
  });

  it('handles cards with dueDate', () => {
    const input = `title: Board
columns:
  - id: todo
    title: To Do
cards:
  - id: c1
    column: todo
    title: Deadline task
    dueDate: 2026-04-15
    order: 0`;

    const result = parseKanbanMarkdown(input)!;
    expect(result.columns[0].cards[0].dueDate).toBe('2026-04-15');
  });

  it('sorts cards within columns by order', () => {
    const input = `title: Board
columns:
  - id: todo
    title: To Do
cards:
  - id: c2
    column: todo
    title: Second
    order: 1
  - id: c1
    column: todo
    title: First
    order: 0`;

    const result = parseKanbanMarkdown(input)!;
    expect(result.columns[0].cards[0].title).toBe('First');
    expect(result.columns[0].cards[1].title).toBe('Second');
  });

  it('puts cards in first column when their column ID is unknown', () => {
    const input = `title: Board
columns:
  - id: todo
    title: To Do
cards:
  - id: c1
    column: nonexistent
    title: Orphan
    order: 0`;

    const result = parseKanbanMarkdown(input)!;
    expect(result.columns[0].cards).toHaveLength(1);
    expect(result.columns[0].cards[0].title).toBe('Orphan');
  });
});

// --- kanbanDataToMarkdown ---

describe('kanbanDataToMarkdown', () => {
  it('serializes KanbanData back to markdown format', () => {
    const data = {
      title: 'Test Board',
      columns: [
        {
          id: 'todo',
          title: 'To Do',
          cards: [
            { id: 'c1', title: 'Task 1', columnId: 'todo', order: 0 },
          ],
        },
        {
          id: 'done',
          title: 'Done',
          cards: [],
        },
      ],
    };
    const output = kanbanDataToMarkdown(data);
    expect(output).toContain('title: Test Board');
    expect(output).toContain('columns:');
    expect(output).toContain('- id: todo');
    expect(output).toContain('title: To Do');
    expect(output).toContain('cards:');
    expect(output).toContain('- id: c1');
    expect(output).toContain('title: Task 1');
  });

  it('includes title: line when title exists', () => {
    const data = {
      title: 'My Board',
      columns: [{ id: 'col', title: 'Column', cards: [] }],
    };
    expect(kanbanDataToMarkdown(data)).toContain('title: My Board');
  });

  it('uses fallback title when title is empty', () => {
    const data = {
      title: '',
      columns: [{ id: 'col', title: 'Column', cards: [] }],
    };
    expect(kanbanDataToMarkdown(data)).toContain('title: Board');
  });

  it('serializes card labels', () => {
    const data = {
      title: 'Board',
      columns: [{
        id: 'col',
        title: 'Column',
        cards: [{
          id: 'c1',
          title: 'Task',
          columnId: 'col',
          labels: ['bug', 'urgent'],
          order: 0,
        }],
      }],
    };
    const output = kanbanDataToMarkdown(data);
    expect(output).toContain('labels: bug, urgent');
  });

  it('serializes card descriptions', () => {
    const data = {
      title: 'Board',
      columns: [{
        id: 'col',
        title: 'Column',
        cards: [{
          id: 'c1',
          title: 'Task',
          columnId: 'col',
          description: 'Do the thing',
          order: 0,
        }],
      }],
    };
    const output = kanbanDataToMarkdown(data);
    expect(output).toContain('description: Do the thing');
  });
});

// --- Roundtrip ---

describe('Roundtrip: parse → serialize → parse', () => {
  it('parse kanban markdown, serialize it, parse again — result matches', () => {
    const input = `title: Test Board
columns:
  - id: todo
    title: To Do
  - id: doing
    title: In Progress
  - id: done
    title: Done
cards:
  - id: c1
    column: todo
    title: Research
    description: Look into options
    labels: research
    order: 0
  - id: c2
    column: doing
    title: Implementation
    order: 0`;

    const first = parseKanbanMarkdown(input)!;
    const serialized = kanbanDataToMarkdown(first);
    const second = parseKanbanMarkdown(serialized)!;

    expect(second.title).toBe(first.title);
    expect(second.columns).toHaveLength(first.columns.length);

    for (let i = 0; i < first.columns.length; i++) {
      expect(second.columns[i].id).toBe(first.columns[i].id);
      expect(second.columns[i].title).toBe(first.columns[i].title);
      expect(second.columns[i].cards).toHaveLength(first.columns[i].cards.length);
    }
  });
});

// --- generateCardId ---

describe('generateCardId', () => {
  it('returns a non-empty string', () => {
    expect(generateCardId().length).toBeGreaterThan(0);
  });

  it('two consecutive calls return different IDs', () => {
    const id1 = generateCardId();
    const id2 = generateCardId();
    expect(id1).not.toBe(id2);
  });
});

// --- createDefaultKanbanData ---

describe('createDefaultKanbanData', () => {
  it('returns an object with columns', () => {
    const data = createDefaultKanbanData();
    expect(data.columns.length).toBeGreaterThanOrEqual(2);
  });

  it('has todo, in-progress, done columns', () => {
    const data = createDefaultKanbanData();
    const ids = data.columns.map(c => c.id);
    expect(ids).toContain('todo');
    expect(ids).toContain('in-progress');
    expect(ids).toContain('done');
  });

  it('at least one column has cards', () => {
    const data = createDefaultKanbanData();
    const totalCards = data.columns.reduce((sum, col) => sum + col.cards.length, 0);
    expect(totalCards).toBeGreaterThan(0);
  });
});
