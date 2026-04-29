#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NotesAdapter } from './notesAdapter';
import { IpcClient } from './ipcClient';
import { searchNotes, SearchableNote } from '../../packages/core/src/search';

const args = parseArgs(process.argv.slice(2));
if (!args.notesDir) {
  console.error('mark-it-down-mcp: missing required --notes-dir <path>');
  console.error('usage: mark-it-down-mcp --notes-dir <path-to-globalStorage/notes> [--ipc-sock <path>]');
  process.exit(2);
}

const adapter = new NotesAdapter(args.notesDir);
const ipcClient = args.ipcSock ? new IpcClient(args.ipcSock) : undefined;

const server = new McpServer(
  { name: 'mark-it-down', version: '0.9.1' },
  {
    capabilities: { tools: {} },
    instructions:
      'Mark It Down — markdown notes from the VSCode extension. Use list_notes to discover, get_note to read, create/update/delete_note to mutate. get_active_markdown + list_open_md introspect the running VSCode editor when --ipc-sock points at a live extension; otherwise they degrade to a clear error.',
  },
);

server.registerTool(
  'list_notes',
  {
    description:
      'List notes in the Mark It Down warehouse. Optionally filter by category (exact), categoryPrefix (matches the path or anything underneath), and/or tag.',
    inputSchema: {
      category: z.string().optional().describe('Restrict to notes whose category equals this exact path'),
      categoryPrefix: z
        .string()
        .optional()
        .describe('Restrict to notes whose category equals this path or sits underneath it (e.g. "Reference" matches "Reference/Postgres")'),
      tag: z.string().optional().describe('Restrict to notes carrying this tag (lowercase)'),
    },
  },
  async ({ category, categoryPrefix, tag }) => {
    const notes = await adapter.listNotes({ category, categoryPrefix, tag });
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
    description: 'Create a new global note with optional initial content + tags.',
    inputSchema: {
      title: z.string().describe('Note title'),
      category: z.string().describe('Category, e.g. Daily / Reference / Snippet / Drafts'),
      content: z.string().optional().describe('Initial markdown content (default: "# <title>\\n\\n")'),
      tags: z.array(z.string()).optional().describe('Tags (lowercase, alphanumeric + dashes; cross-cut categories)'),
    },
  },
  async ({ title, category, content, tags }) => {
    const meta = await adapter.createNote({ title, category, content, tags });
    return {
      content: [{ type: 'text', text: JSON.stringify(meta, null, 2) }],
    };
  },
);

server.registerTool(
  'update_note',
  {
    description: 'Update a note. Any of title / category / content / tags may be patched; updatedAt bumps.',
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      category: z.string().optional(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, title, category, content, tags }) => {
    try {
      const next = await adapter.updateNote(id, { title, category, content, tags });
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
  'search_notes',
  {
    description: 'Fuzzy search across all global notes (title + category + body). Returns ranked hits with snippet + score.',
    inputSchema: {
      query: z.string().describe('Search query — words/phrases separated by whitespace'),
      limit: z.number().optional().describe('Max hits to return (default 25)'),
    },
  },
  async ({ query, limit }) => {
    const all = await adapter.listNotes();
    const searchable: SearchableNote[] = await Promise.all(
      all.map(async meta => {
        const note = await adapter.getNote(meta.id);
        return {
          id: meta.id,
          title: meta.title,
          category: meta.category,
          scope: 'global' as const,
          updatedAt: meta.updatedAt,
          body: note?.content ?? '',
        };
      }),
    );
    const hits = searchNotes(searchable, query, limit ?? 25);
    return {
      content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }],
    };
  },
);

server.registerTool(
  'get_active_markdown',
  {
    description:
      'Return the markdown currently open in the active Mark It Down editor. Requires --ipc-sock to be set + the VSCode extension to be running.',
    inputSchema: {},
  },
  async () => {
    if (!ipcClient) {
      return ipcUnavailable('get_active_markdown');
    }
    try {
      const result = await ipcClient.getActiveMarkdown();
      if (!result) {
        return {
          content: [{ type: 'text', text: 'No markdown editor is currently active.' }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return ipcError('get_active_markdown', err as Error);
    }
  },
);

server.registerTool(
  'list_open_md',
  {
    description:
      'List all open .md / .mdx tabs in the running VSCode. Requires --ipc-sock to be set + the VSCode extension to be running.',
    inputSchema: {},
  },
  async () => {
    if (!ipcClient) {
      return ipcUnavailable('list_open_md');
    }
    try {
      const result = await ipcClient.listOpenMarkdown();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return ipcError('list_open_md', err as Error);
    }
  },
);

function ipcUnavailable(tool: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `${tool} requires --ipc-sock to be set when the MCP server is launched. The Mark It Down extension passes this automatically when you run "Install MCP for Claude Desktop / Code" from a workspace where the extension is loaded.`,
      },
    ],
  };
}

function ipcError(tool: string, err: Error) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `${tool} failed to reach the VSCode extension: ${err.message}. The extension may not be running, or the socket path is stale. Try restarting VSCode.`,
      },
    ],
  };
}

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
  ipcSock?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--notes-dir' && argv[i + 1]) {
      out.notesDir = argv[i + 1];
      i++;
    } else if (argv[i] === '--ipc-sock' && argv[i + 1]) {
      out.ipcSock = argv[i + 1];
      i++;
    }
  }
  return out;
}
