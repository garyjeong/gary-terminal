import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface SlashCommand {
  name: string;
  fullCommand: string;
  description: string;
  argumentHint?: string;
  type: 'builtin' | 'skill' | 'custom' | 'plugin';
  source?: string;
}

// ---------------------------------------------------------------------------
// Builtin commands
// ---------------------------------------------------------------------------

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'add-dir', fullCommand: 'add-dir', argumentHint: '<path>', description: 'Add a working directory for file access during the current session', type: 'builtin' },
  { name: 'advisor', fullCommand: 'advisor', argumentHint: '[model|off]', description: 'Enable or disable the advisor tool (second model for guidance)', type: 'builtin' },
  { name: 'agents', fullCommand: 'agents', description: 'Manage agent configurations', type: 'builtin' },
  { name: 'background', fullCommand: 'background', argumentHint: '[prompt]', description: 'Detach session to run as a background agent and free terminal', type: 'builtin' },
  { name: 'batch', fullCommand: 'batch', argumentHint: '<instruction>', description: 'Orchestrate large-scale changes across a codebase in parallel', type: 'builtin' },
  { name: 'branch', fullCommand: 'branch', argumentHint: '[name]', description: 'Create a branch of the current conversation', type: 'builtin' },
  { name: 'btw', fullCommand: 'btw', argumentHint: '<question>', description: 'Ask a quick side question without adding to conversation history', type: 'builtin' },
  { name: 'cd', fullCommand: 'cd', argumentHint: '<path>', description: 'Move this session to a new working directory', type: 'builtin' },
  { name: 'clear', fullCommand: 'clear', argumentHint: '[name]', description: 'Start a new conversation with empty context', type: 'builtin' },
  { name: 'compact', fullCommand: 'compact', argumentHint: '[instructions]', description: 'Summarize the conversation to free up context window', type: 'builtin' },
  { name: 'config', fullCommand: 'config', argumentHint: '[key=value]', description: 'Open Settings interface or set configuration values', type: 'builtin' },
  { name: 'context', fullCommand: 'context', argumentHint: '[all]', description: 'Visualize current context usage as a colored grid', type: 'builtin' },
  { name: 'copy', fullCommand: 'copy', argumentHint: '[N]', description: 'Copy the last assistant response to clipboard', type: 'builtin' },
  { name: 'cost', fullCommand: 'cost', description: 'Alias for /usage - show session cost', type: 'builtin' },
  { name: 'debug', fullCommand: 'debug', argumentHint: '[description]', description: 'Enable debug logging and troubleshoot issues', type: 'builtin' },
  { name: 'deep-research', fullCommand: 'deep-research', argumentHint: '<question>', description: 'Fan out web searches, fetch and cross-check sources, synthesize report', type: 'builtin' },
  { name: 'diff', fullCommand: 'diff', description: 'Open interactive diff viewer showing uncommitted changes and per-turn diffs', type: 'builtin' },
  { name: 'doctor', fullCommand: 'doctor', description: 'Diagnose and verify your Claude Code installation and settings', type: 'builtin' },
  { name: 'effort', fullCommand: 'effort', argumentHint: '[level|auto]', description: 'Set the model effort level (low/medium/high/xhigh/max/auto)', type: 'builtin' },
  { name: 'exit', fullCommand: 'exit', description: 'Exit the CLI', type: 'builtin' },
  { name: 'export', fullCommand: 'export', argumentHint: '[filename]', description: 'Export the current conversation as plain text', type: 'builtin' },
  { name: 'fast', fullCommand: 'fast', argumentHint: '[on|off]', description: 'Toggle fast mode on or off', type: 'builtin' },
  { name: 'feedback', fullCommand: 'feedback', argumentHint: '[report]', description: 'Submit feedback or report a bug', type: 'builtin' },
  { name: 'focus', fullCommand: 'focus', description: 'Toggle the focus view', type: 'builtin' },
  { name: 'fork', fullCommand: 'fork', argumentHint: '<directive>', description: 'Spawn a forked subagent with a directive', type: 'builtin' },
  { name: 'goal', fullCommand: 'goal', argumentHint: '[condition|clear]', description: 'Set a goal - Claude keeps working until condition is met', type: 'builtin' },
  { name: 'help', fullCommand: 'help', description: 'Show help and available commands', type: 'builtin' },
  { name: 'hooks', fullCommand: 'hooks', description: 'View hook configurations for tool events', type: 'builtin' },
  { name: 'ide', fullCommand: 'ide', description: 'Manage IDE integrations and show status', type: 'builtin' },
  { name: 'init', fullCommand: 'init', description: 'Initialize project with a CLAUDE.md guide', type: 'builtin' },
  { name: 'insights', fullCommand: 'insights', description: 'Generate a report analyzing your Claude Code sessions', type: 'builtin' },
  { name: 'keybindings', fullCommand: 'keybindings', description: 'Open your keyboard shortcuts file', type: 'builtin' },
  { name: 'login', fullCommand: 'login', description: 'Sign in to your Anthropic account', type: 'builtin' },
  { name: 'logout', fullCommand: 'logout', description: 'Sign out from your Anthropic account', type: 'builtin' },
  { name: 'mcp', fullCommand: 'mcp', argumentHint: '[reconnect|enable|disable]', description: 'Manage MCP server connections and OAuth authentication', type: 'builtin' },
  { name: 'memory', fullCommand: 'memory', description: 'Edit CLAUDE.md memory files and manage auto-memory', type: 'builtin' },
  { name: 'model', fullCommand: 'model', argumentHint: '[model]', description: 'Switch the AI model and save as default for new sessions', type: 'builtin' },
  { name: 'permissions', fullCommand: 'permissions', description: 'Manage allow/ask/deny rules for tool permissions', type: 'builtin' },
  { name: 'plan', fullCommand: 'plan', argumentHint: '[description]', description: 'Enter plan mode before a large change', type: 'builtin' },
  { name: 'plugin', fullCommand: 'plugin', argumentHint: '[subcommand]', description: 'Manage Claude Code plugins', type: 'builtin' },
  { name: 'recap', fullCommand: 'recap', description: 'Generate a one-line summary of the current session', type: 'builtin' },
  { name: 'release-notes', fullCommand: 'release-notes', description: 'View the changelog in an interactive version picker', type: 'builtin' },
  { name: 'reload-skills', fullCommand: 'reload-skills', description: 'Re-scan skill and command directories for new or changed skills', type: 'builtin' },
  { name: 'rename', fullCommand: 'rename', argumentHint: '[name]', description: 'Rename the current session', type: 'builtin' },
  { name: 'resume', fullCommand: 'resume', argumentHint: '[session]', description: 'Resume a conversation by ID or name', type: 'builtin' },
  { name: 'review', fullCommand: 'review', argumentHint: '[PR]', description: 'Review a GitHub pull request', type: 'builtin' },
  { name: 'rewind', fullCommand: 'rewind', description: 'Rewind the conversation to a previous point', type: 'builtin' },
  { name: 'sandbox', fullCommand: 'sandbox', description: 'Toggle sandbox mode', type: 'builtin' },
  { name: 'schedule', fullCommand: 'schedule', argumentHint: '[description]', description: 'Create, update, list, or run scheduled routines', type: 'builtin' },
  { name: 'skills', fullCommand: 'skills', description: 'List available skills', type: 'builtin' },
  { name: 'status', fullCommand: 'status', description: 'Open Settings interface showing version, model, account, connectivity', type: 'builtin' },
  { name: 'tasks', fullCommand: 'tasks', description: 'View and manage everything running in the background', type: 'builtin' },
  { name: 'theme', fullCommand: 'theme', description: 'Change the color theme', type: 'builtin' },
  { name: 'ultraplan', fullCommand: 'ultraplan', argumentHint: '<prompt>', description: 'Draft a plan in an ultraplan session', type: 'builtin' },
  { name: 'usage', fullCommand: 'usage', description: 'Show session cost, plan usage limits, and activity stats', type: 'builtin' },
  { name: 'verify', fullCommand: 'verify', description: 'Confirm a code change works by running the app', type: 'builtin' },
  { name: 'voice', fullCommand: 'voice', argumentHint: '[hold|tap|off]', description: 'Toggle voice dictation mode', type: 'builtin' },
];

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

interface Frontmatter {
  description?: string;
  argumentHint?: string;
  userInvocable?: boolean;
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return {};

  const block = match[1];
  const result: Frontmatter = {};

  // description
  const descMatch = block.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  if (descMatch && descMatch[1]) result.description = descMatch[1].trim();

  // argument-hint
  const hintMatch = block.match(/^argument-hint:\s*["']?(.+?)["']?\s*$/m);
  if (hintMatch && hintMatch[1]) result.argumentHint = hintMatch[1].trim();

  // user-invocable
  const invokableMatch = block.match(/^user-invocable:\s*(true|false)\s*$/m);
  if (invokableMatch && invokableMatch[1]) {
    result.userInvocable = invokableMatch[1] === 'true';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scanner helpers
// ---------------------------------------------------------------------------

async function scanSkillDir(
  skillsDir: string,
  type: 'skill' | 'plugin',
  seen: Set<string>,
  results: SlashCommand[],
  namePrefix = '',
): Promise<void> {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMd, 'utf-8');
        const fm = parseFrontmatter(content);
        // Skip if explicitly non-invocable
        if (fm.userInvocable === false) continue;

        const commandName = namePrefix ? `${namePrefix}:${entry.name}` : entry.name;
        const key = `skill:${skillMd}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          name: commandName,
          fullCommand: commandName,
          description: fm.description ?? `Skill: ${entry.name}`,
          argumentHint: fm.argumentHint,
          type,
          source: skillMd,
        });
      } catch {
        // no SKILL.md or unreadable, skip
      }
    }
  } catch {
    // directory doesn't exist, skip
  }
}

async function scanCommandsDir(
  commandsDir: string,
  seen: Set<string>,
  results: SlashCommand[],
): Promise<void> {
  try {
    const entries = await fs.readdir(commandsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (!entry.name.endsWith('.md')) continue;
      const commandName = entry.name.slice(0, -3); // strip .md
      const filePath = path.join(commandsDir, entry.name);
      const key = `command:${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const fm = parseFrontmatter(content);
        if (fm.userInvocable === false) continue;

        results.push({
          name: commandName,
          fullCommand: commandName,
          description: fm.description ?? `Custom command: ${commandName}`,
          argumentHint: fm.argumentHint,
          type: 'custom',
          source: filePath,
        });
      } catch {
        // unreadable, skip
      }
    }
  } catch {
    // directory doesn't exist, skip
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function enumerateSlashCommands(cwd?: string): Promise<SlashCommand[]> {
  const home = os.homedir();
  const seen = new Set<string>();
  const customs: SlashCommand[] = [];

  // ~/.claude/skills/<n>/SKILL.md
  await scanSkillDir(path.join(home, '.claude', 'skills'), 'skill', seen, customs);

  // ~/.claude/commands/<n>.md
  await scanCommandsDir(path.join(home, '.claude', 'commands'), seen, customs);

  // <cwd>/.claude/skills/<n>/SKILL.md
  if (cwd) {
    await scanSkillDir(path.join(cwd, '.claude', 'skills'), 'skill', seen, customs);
  }

  // <cwd>/.claude/commands/<n>.md
  if (cwd) {
    await scanCommandsDir(path.join(cwd, '.claude', 'commands'), seen, customs);
  }

  // ~/.claude/plugins/*/skills/*/SKILL.md  (type='plugin', name='plugin:skillname')
  const pluginsDir = path.join(home, '.claude', 'plugins');
  try {
    const plugins = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;
      const pluginSkillsDir = path.join(pluginsDir, plugin.name, 'skills');
      await scanSkillDir(pluginSkillsDir, 'plugin', seen, customs, 'plugin');
    }
  } catch {
    // no plugins dir, skip
  }

  return [...BUILTIN_COMMANDS, ...customs];
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands.slice(0, 8);

  const q = query.toLowerCase();

  // Prefix match first
  const prefixMatches = commands.filter((c) => c.name.toLowerCase().startsWith(q));

  // Then substring (not already in prefix)
  const prefixNames = new Set(prefixMatches.map((c) => c.name));
  const substringMatches = commands.filter(
    (c) => !prefixNames.has(c.name) && c.name.toLowerCase().includes(q),
  );

  const combined = [...prefixMatches, ...substringMatches];
  return combined.slice(0, 8);
}
