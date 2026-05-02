import { ImportContext, ImportedNote, Importer } from '../types';

/**
 * Sample importer — exists purely to prove the loader, IPC, and renderer
 * chooser are wired correctly. It ignores `input` entirely and yields a single
 * hardcoded markdown note. Real importers (#247–#250) replace this pattern.
 */
const sample: Importer = {
  id: 'sample',
  name: 'Sample (smoke test)',
  icon: 'bx-test-tube',
  supportedFormats: ['folder'],
  description: 'Imports a single hardcoded note. Used to verify the importer pipeline.',

  async detect(_input: string): Promise<boolean> {
    return true;
  },

  async *import(_input: string, ctx: ImportContext): AsyncIterable<ImportedNote> {
    ctx.log('[sample] yielding one hardcoded note');
    const now = new Date().toISOString();
    yield {
      title: 'Hello from the sample importer',
      body: [
        '# Hello from the sample importer',
        '',
        'If you can see this note in your workspace under',
        '`Imported/sample/`, the importer plugin pipeline is working end-to-end.',
        '',
        '- Loader registered the plugin',
        '- IPC streamed the note to the renderer',
        '- Host wrote markdown + frontmatter to disk',
        '',
        `_Generated at ${now}._`,
      ].join('\n'),
      tags: ['imported', 'sample'],
      createdAt: now,
      updatedAt: now,
    };
  },
};

export default sample;
