import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface SkillInfo {
  name: string;
  dir: string;
}

async function parseSkillName(skillMdPath: string, fallback: string): Promise<string> {
  try {
    const content = await fs.readFile(skillMdPath, 'utf-8');
    // Match name field in YAML frontmatter: name: "..." or name: '...' or name: bare
    const match = content.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (match && match[1]) return match[1].trim();
  } catch {
    // ignore read errors
  }
  return fallback;
}

async function scanDir(skillsDir: string): Promise<SkillInfo[]> {
  const results: SkillInfo[] = [];
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        await fs.access(skillMd);
        const name = await parseSkillName(skillMd, entry.name);
        results.push({ name, dir: path.join(skillsDir, entry.name) });
      } catch {
        // no SKILL.md, skip
      }
    }
  } catch {
    // directory doesn't exist, skip
  }
  return results;
}

export async function scanSkills(): Promise<SkillInfo[]> {
  const home = os.homedir();
  const seen = new Set<string>();
  const all: SkillInfo[] = [];

  function add(items: SkillInfo[]): void {
    for (const item of items) {
      if (!seen.has(item.dir)) {
        seen.add(item.dir);
        all.push(item);
      }
    }
  }

  // ~/.claude/skills/*/SKILL.md
  add(await scanDir(path.join(home, '.claude', 'skills')));

  // .claude/skills/ relative to cwd
  add(await scanDir(path.join(process.cwd(), '.claude', 'skills')));

  // ~/.claude/plugins/*/skills/*/SKILL.md
  const pluginsDir = path.join(home, '.claude', 'plugins');
  try {
    const plugins = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;
      const pluginSkillsDir = path.join(pluginsDir, plugin.name, 'skills');
      add(await scanDir(pluginSkillsDir));
    }
  } catch {
    // no plugins dir, skip
  }

  return all;
}
