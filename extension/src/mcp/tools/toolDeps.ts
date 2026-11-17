import type { CommandResult } from '../../types';
import type { EditStore } from '../../edits/store';
import type { StatsService } from '../../stats/service';

export interface ToolDeps {
  root: string;
  readText(absPath: string): Promise<string>;
  listFiles(glob: string, max: number): Promise<string[]>;
  store: EditStore;
  writeText(absPath: string, text: string): Promise<void>;
  runCommand(cmd: string, timeoutS: number, signal: AbortSignal): Promise<CommandResult>;
  stats: StatsService;
}
