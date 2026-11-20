import { currentMember } from './auth';
import { StackForm } from './components/form';
import { readForm, redirect } from './forms';
import { page } from './html';

const fields = ['primary', 'secondary', 'background'] as const;
type Palette = Record<typeof fields[number], string>;

const presets = [
  { id: 'evergreen', label: 'Evergreen (default)', colors: { primary: '#355645', secondary: '#176549', background: '#faf9f6' } },
  { id: 'slate', label: 'Blue Slate', colors: { primary: '#29476a', secondary: '#395a76', background: '#f3f6fa' } },
  { id: 'canyon', label: 'Canyon Paper', colors: { primary: '#743e33', secondary: '#745625', background: '#fbf5e9' } },
];

function parsePalette(values: URLSearchParams): Palette | null {
  const primary = values.get('primary')?.trim().toLowerCase() ?? '';
  const secondary = values.get('secondary')?.trim().toLowerCase() ?? '';
  const background = values.get('background')?.trim().toLowerCase() ?? '';
  return [primary, secondary, background].every(value => /^#[a-f0-9]{6}$/.test(value))
    ? { primary, secondary, background } : null;
}

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map(index => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readable(color: string): string {
  return contrast(color, '#000000') > contrast(color, '#ffffff') ? '#000000' : '#ffffff';
}

function contrastIssue(colors: Palette): string | undefined {
  const low = fields.slice(0, 2).filter(field => contrast(colors[field], colors.background) < 4.5);
  if (!low.length) return;
  const names = low.map(field => field === 'primary' ? 'Primary' : 'Secondary').join(' and ');
  return `${names} needs at least 4.5:1 contrast against the background. Adjust the colors before publishing.`;
}

async function publishedPalette(db: D1Database): Promise<Palette> {
  return await db.prepare('SELECT primary_color AS "primary", secondary_color AS secondary, background_color AS background FROM site_theme WHERE id = 1')
    .first<Palette>() ?? presets[0].colors;
}

function mix(color: string, other: string, amount: number): string {
  return '#' + [1, 3, 5].map(index => {
    const channel = parseInt(color.slice(index, index + 2), 16);
    const target = parseInt(other.slice(index, index + 2), 16);
    return Math.round(channel + (target - channel) * amount).toString(16).padStart(2, '0');
  }).join('');
}

function darkPalette(palette: Palette): Palette {
  const background = luminance(palette.background) <= 0.08
    ? palette.background
    : mix(palette.background, '#121513', 0.94);
  const primary = mix(palette.primary, '#ffffff', 0.55);
  const surface = mix(background, '#ffffff', 0.04);
  const secondaryTint = mix(palette.secondary, '#ffffff', 0.48);
  const secondary = contrast(secondaryTint, surface) >= 4.5 ? secondaryTint : '#ffffff';
  const wash = mix(background, secondary, 0.09);
  return { background, primary: contrast(primary, wash) >= 4.5 ? primary : '#ffffff', secondary };
}

function paletteRule(selector: string, palette: Palette): string {
  const ink = readable(palette.background);
  return `${selector} {
    color-scheme: ${ink === '#ffffff' ? 'dark' : 'light'};
    --accent: ${palette.primary};
    --secondary: ${palette.secondary};
    --canvas: ${palette.background};
    --ink: ${ink};
    --on-accent: ${readable(palette.primary)};
    --muted: color-mix(in srgb, var(--ink) 78%, var(--canvas));
    --rule: color-mix(in srgb, var(--ink) 20%, var(--canvas));
    --field-border: color-mix(in srgb, var(--ink) 52%, var(--canvas));
    --surface: color-mix(in srgb, var(--canvas) 96%, var(--ink));
    --wash: color-mix(in srgb, var(--canvas) 91%, var(--secondary));
  }`;
}

function stylesheet(palette: Palette, preview: boolean): Response {
  const dark = darkPalette(palette);
  const css = preview
    ? `${paletteRule('.theme-preview-light', palette)}\n${paletteRule('.theme-preview-dark', dark)}`
    : `${paletteRule(':root', palette)}\n@media (prefers-color-scheme: dark) { ${paletteRule(':root', dark)} }`;
  return new Response(css, { headers: {
    'Content-Type': 'text/css; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': preview ? 'private, no-store' : 'no-cache',
  } });
}

function appearancePage(colors: Palette, options: { error?: string; saved?: boolean; status?: number } = {}): Response {
  const preview = `/theme.css?${new URLSearchParams(colors)}`;
  const issue = options.error ?? contrastIssue(colors);
  return page('Appearance', (<>
    <h1>Appearance</h1>
    <nav aria-label="Color presets" class="theme-presets">
      {presets.map(preset => <a href={`/admin/appearance?preset=${preset.id}`}>{preset.label}</a>)}
    </nav>
    {options.saved && <p role="status">Colors published.</p>}
    {issue && <p role="alert">{issue}</p>}
    <StackForm action="/admin/appearance" className="theme-form">
      {fields.map(field => <label>{field.charAt(0).toUpperCase() + field.slice(1)} color
        <input name={field} value={colors[field]} pattern="#[a-fA-F0-9]{6}" maxlength={7} spellcheck={false} required />
      </label>)}
      <div class="theme-actions">
        <button name="intent" value="preview">Preview colors</button>
        <button name="intent" value="publish">Publish</button>
      </div>
    </StackForm>
    <div class="theme-preview-grid">
      <PalettePreview mode="light" />
      <PalettePreview mode="dark" />
    </div>
  </>).toString(), options.status ?? 200, preview);
}

function PalettePreview({ mode }: { mode: 'light' | 'dark' }) {
  return <section class={`theme-preview theme-preview-${mode}`} aria-labelledby={`theme-preview-${mode}`}>
    <h2 id={`theme-preview-${mode}`}>{mode === 'light' ? 'Base palette' : 'Dark mode'}</h2>
    <p class="headline">A new trail opens along the Poudre</p>
    <p class="metadata">2 points · foothillsreader · 1 hour ago</p>
    <p class="theme-preview-highlight">Secondary highlight</p>
  </section>;
}

export async function appearance(request: Request, db: D1Database, url: URL): Promise<Response | undefined> {
  if (url.pathname === '/theme.css' && ['GET', 'HEAD'].includes(request.method)) {
    if (!url.search) return stylesheet(await publishedPalette(db), false);
    const colors = parsePalette(url.searchParams);
    return colors ? stylesheet(colors, true) : new Response(null, { status: 400 });
  }
  if (url.pathname !== '/admin/appearance' || !['GET', 'HEAD', 'POST'].includes(request.method)) return;

  const member = await currentMember(request, db);
  if (!member) return redirect('/login');
  if (member.role !== 'admin') return page('Forbidden', '<h1>Access denied</h1>', 403);

  if (request.method !== 'POST') {
    const preset = presets.find(item => item.id === url.searchParams.get('preset'));
    return appearancePage(preset?.colors ?? await publishedPalette(db), { saved: url.searchParams.has('saved') });
  }

  const form = await readForm(request);
  const colors = parsePalette(form);
  if (!colors) return appearancePage(await publishedPalette(db), { error: 'Enter six-digit hex colors, such as #355645.', status: 400 });
  if (form.get('intent') === 'preview') return appearancePage(colors);
  const issue = contrastIssue(colors);
  if (issue) return appearancePage(colors, { error: issue, status: 400 });
  if (form.get('intent') !== 'publish') return appearancePage(colors, { error: 'Choose Preview colors or Publish.', status: 400 });

  const admin = "SELECT id FROM users WHERE id = ? AND state = 'active' AND role = 'admin'";
  const [write] = await db.batch([
    db.prepare(`INSERT INTO site_theme(id, primary_color, secondary_color, background_color)
      SELECT 1, ?, ?, ? FROM (${admin}) WHERE 1
      ON CONFLICT(id) DO UPDATE SET primary_color = excluded.primary_color,
      secondary_color = excluded.secondary_color, background_color = excluded.background_color`)
      .bind(colors.primary, colors.secondary, colors.background, member.id),
    db.prepare(`INSERT INTO moderation_actions(actor_id,action,target_type,target_id,reason)
      SELECT id,'publish','appearance',1,? FROM (${admin})`)
      .bind(fields.map(field => colors[field]).join(' '), member.id),
  ]);
  if (!write.meta.changes) return page('Forbidden', '<h1>Access denied</h1>', 403);
  return redirect('/admin/appearance?saved=1');
}
