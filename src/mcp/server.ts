#!/usr/bin/env node
/* eslint-disable no-console */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NotesAdapter } from './notesAdapter';

const args = parseArgs(process.argv.slice(2));
if (!args.notesDir) {
  console.error('mark-it-down-mcp: missing required --notes-dir <path>');
  console.error('usage: mark-it-down-mcp --notes-dir <path-to-globalStorage/notes>');
  process.exit(2);
}

const adapter = new NotesAdapter(args.notesDir);

const server = new McpServer(
  { name: 'mark-it-down', version: '0.9.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'Mark It Down — markdown notes from the VSCode extension. Use list_notes to discover, get_note to read, create/update/delete_note to mutate. Active-editor introspection (get_active_markdown / list_open_md) requires the extension to be running and is not available in this transport.',
  },
);

server.registerTool(
  'list_notes',
  {
    description: 'List notes in the Mark It Down warehouse. Optionally filter by category.',
    inputSchema: {
      category: z.string().optional().describe('Restrict to notes in this category'),
    },
  },
  async ({ category }) => {
    const notes = await adapter.listNotes({ category });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(notes, null, 2),
        },
      ],
    };
  },
);

server.registerTool(
  'get_note',
  {
    description: 'Read a single note by id. Returns metadata + full markdown content.',
    inputSchema: { id: z.string().describe('Note id') },
  },
  async ({ id }) => {
    const note = await adapter.getNote(id);
    if (!note) {
      return {
        isError: true,
        content: [{ type: 'text', text: `note ${id} not found` }],
      };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(note.meta, null, 2) },
        { type: 'text', text: note.content },
      ],
    };
  },
);

server.registerTool(
  'create_note',
  {
    description: 'Create a new global note with optional initial content.',
    inputSchema: {
      title: z.string().describe('Note title'),
      category: z.string().describe('Category, e.g. Daily / Reference / Snippet / Drafts'),
      content: z.string().optional().describe('Initial markdown content (default: "# <title>\\n\\n")'),
    },
  },
  async ({ title, category, content }) => {
    const meta = await adapter.createNote({ title, category, content });
    return {
      content: [{ type: 'text', text: JSON.stringify(meta, null, 2) }],
    };
  },
);

server.registerTool(
  'update_note',
  {
    description: 'Update a note. Any of title / category / content may be patched; updatedAt bumps.',
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      category: z.string().optional(),
      content: z.string().optional(),
    },
  },
  async ({ id, title, category, content }) => {
    try {
      const next = await adapter.updateNote(id, { title, category, content });
      return { content: [{ type: 'text', text: JSON.stringify(next, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: (err as Error).message }],
      };
    }
  },
);

server.registerTool(
  'delete_note',
  {
    description: 'Permanently delete a note (no soft-delete or trash).',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const removed = await adapter.deleteNote(id);
    if (!removed) {
      return {
        isError: true,
        content: [{ type: 'text', text: `note ${id} not found` }],
      };
    }
    return { content: [{ type: 'text', text: `deleted ${removed.id} (${removed.title})` }] };
  },
);

server.registerTool(
  'get_active_markdown',
  {
    description:
      'Return the markdown currently open in the active Mark It Down editor. ' +
      'Requires the VSCode extension to be running with IPC enabled (not yet implemented in v0.9).',
    inputSchema: {},
  },
  async () => ({
    isError: true,
    content: [
      {
        type: 'text',
        text: 'get_active_markdown requires extension IPC — not available in v0.9 stdio mode. Use list_notes / get_note for warehouse access instead.',
      },
    ],
  }),
);

server.registerTool(
  'list_open_md',
  {
    description:
      'List all open .md tabs in the running VSCode. ' +
      'Requires the VSCode extension to be running with IPC enabled (not yet implemented in v0.9).',
    inputSchema: {},
  },
  async () => ({
    isError: true,
    content: [
      {
        type: 'text',
        text: 'list_open_md requires extension IPC — not available in v0.9 stdio mode.',
      },
    ],
  }),
);

const transport = new StdioServerTransport();
server.connect(transport).then(
  () => {
    console.error('mark-it-down-mcp: ready (notes-dir=%s)', args.notesDir);
  },
  err => {
    console.error('mark-it-down-mcp: failed to start', err);
    process.exit(1);
  },
);

interface CliArgs {
  notesDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--notes-dir' && argv[i + 1]) {
      out.notesDir = argv[i + 1];
      i++;
    }
  }
  return out;
}
