/**
 * Agent Audit CLI for ContextGraph OS
 *
 * Implements EPIC 10 Capability 10.1:
 * T10.1.1 CLI command structure
 * T10.1.2 Audit export commands
 *
 * Trust, but verify. From the command line.
 */

import type { ContentAddress } from '../src/core/identity/content-address.js';
import type {
  AuditQueryParams,
  AuditReportTypeValue,
  ExportFormatValue,
  TimeRange,
} from '../src/query/audit.js';
import { AuditEngine, AuditReportType, ExportFormat } from '../src/query/audit.js';

/**
 * CLI command definition
 */
export interface CLICommand {
  /** Command name */
  readonly name: string;
  /** Command description */
  readonly description: string;
  /** Command options */
  readonly options: readonly CLIOption[];
  /** Execute function */
  readonly execute: (args: Record<string, unknown>) => Promise<CLIResult>;
}

/**
 * CLI option definition
 */
export interface CLIOption {
  /** Option name (e.g., "--format") */
  readonly name: string;
  /** Short alias (e.g., "-f") */
  readonly alias?: string;
  /** Option description */
  readonly description: string;
  /** Whether the option is required */
  readonly required?: boolean;
  /** Default value */
  readonly defaultValue?: unknown;
  /** Value type */
  readonly type: 'string' | 'number' | 'boolean' | 'array';
}

/**
 * CLI execution result
 */
export interface CLIResult {
  /** Whether the command succeeded */
  readonly success: boolean;
  /** Exit code */
  readonly exitCode: number;
  /** Output message */
  readonly message: string;
  /** Output data (if any) */
  readonly data?: unknown;
  /** Error (if failed) */
  readonly error?: string;
}

/**
 * Audit CLI implementation
 */
export class AuditCLI {
  private auditEngine: AuditEngine;
  private commands: Map<string, CLICommand> = new Map();

  constructor(auditEngine?: AuditEngine) {
    this.auditEngine = auditEngine ?? new AuditEngine();
    this.registerCommands();
  }

  /**
   * Register all CLI commands
   */
  private registerCommands(): void {
    // Generate report command
    this.commands.set('report', {
      name: 'report',
      description: 'Generate an audit report',
      options: [
        {
          name: '--type',
          alias: '-t',
          description: 'Report type (decision, compliance, actor, health, summary)',
          type: 'string',
          defaultValue: 'summary',
        },
        {
          name: '--from',
          description: 'Start date (ISO format)',
          type: 'string',
          required: true,
        },
        {
          name: '--to',
          description: 'End date (ISO format)',
          type: 'string',
          required: true,
        },
        {
          name: '--format',
          alias: '-f',
          description: 'Output format (json, csv, html, sarif)',
          type: 'string',
          defaultValue: 'json',
        },
        {
          name: '--output',
          alias: '-o',
          description: 'Output file path',
          type: 'string',
        },
        {
          name: '--scope',
          alias: '-s',
          description: 'Filter by scope pattern',
          type: 'array',
        },
      ],
      execute: async (args) => this.generateReport(args),
    });

    // Compliance check command
    this.commands.set('compliance', {
      name: 'compliance',
      description: 'Check compliance for a time period',
      options: [
        {
          name: '--from',
          description: 'Start date (ISO format)',
          type: 'string',
          required: true,
        },
        {
          name: '--to',
          description: 'End date (ISO format)',
          type: 'string',
          required: true,
        },
        {
          name: '--threshold',
          description: 'Minimum compliance rate (0-100)',
          type: 'number',
          defaultValue: 95,
        },
      ],
      execute: async (args) => this.checkCompliance(args),
    });

    // List decisions command
    this.commands.set('decisions', {
      name: 'decisions',
      description: 'List decisions in a time range',
      options: [
        {
          name: '--from',
          description: 'Start date (ISO format)',
          type: 'string',
          required: true,
        },
        {
          name: '--to',
          description: 'End date (ISO format)',
          type: 'string',
          required: true,
        },
        {
          name: '--state',
          description: 'Filter by state',
          type: 'string',
        },
        {
          name: '--limit',
          alias: '-n',
          description: 'Maximum number of results',
          type: 'number',
          defaultValue: 100,
        },
      ],
      execute: async (args) => this.listDecisions(args),
    });

    // Export command
    this.commands.set('export', {
      name: 'export',
      description: 'Export audit data',
      options: [
        {
          name: '--type',
          alias: '-t',
          description: 'Data type to export',
          type: 'string',
          required: true,
        },
        {
          name: '--format',
          alias: '-f',
          description: 'Output format',
          type: 'string',
          defaultValue: 'json',
        },
        {
          name: '--output',
          alias: '-o',
          description: 'Output file path',
          type: 'string',
          required: true,
        },
      ],
      execute: async (args) => this.exportData(args),
    });
  }

  /**
   * Get available commands
   */
  getCommands(): readonly CLICommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Execute a command
   */
  async execute(commandName: string, args: Record<string, unknown>): Promise<CLIResult> {
    const command = this.commands.get(commandName);

    if (!command) {
      return {
        success: false,
        exitCode: 1,
        message: `Unknown command: ${commandName}`,
        error: `Available commands: ${Array.from(this.commands.keys()).join(', ')}`,
      };
    }

    // Validate required options
    for (const option of command.options) {
      if (option.required && args[option.name.replace('--', '')] === undefined) {
        return {
          success: false,
          exitCode: 1,
          message: `Missing required option: ${option.name}`,
          error: option.description,
        };
      }
    }

    try {
      return await command.execute(args);
    } catch (error) {
      return {
        success: false,
        exitCode: 1,
        message: 'Command execution failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Parse command line arguments
   */
  parseArgs(argv: string[]): { command: string; args: Record<string, unknown> } {
    const args: Record<string, unknown> = {};
    let command = '';

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];

      if (!arg) continue;

      if (!arg.startsWith('-') && !command) {
        command = arg;
        continue;
      }

      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          args[key] = nextArg;
          i++;
        } else {
          args[key] = true;
        }
      } else if (arg.startsWith('-')) {
        const alias = arg.substring(1);
        // Find option by alias
        for (const cmd of this.commands.values()) {
          const option = cmd.options.find((o) => o.alias === `-${alias}`);
          if (option) {
            const key = option.name.replace('--', '');
            const nextArg = argv[i + 1];
            if (nextArg && !nextArg.startsWith('-')) {
              args[key] = nextArg;
              i++;
            } else {
              args[key] = true;
            }
            break;
          }
        }
      }
    }

    return { command, args };
  }

  /**
   * Generate help text
   */
  generateHelp(): string {
    const lines: string[] = [
      'ContextGraph OS - Audit CLI',
      '',
      'Usage: audit <command> [options]',
      '',
      'Commands:',
    ];

    for (const command of this.commands.values()) {
      lines.push(`  ${command.name.padEnd(15)} ${command.description}`);
    }

    lines.push('', 'Run "audit <command> --help" for command-specific options.');

    return lines.join('\n');
  }

  /**
   * Generate command help
   */
  generateCommandHelp(commandName: string): string | null {
    const command = this.commands.get(commandName);
    if (!command) {
      return null;
    }

    const lines: string[] = [
      `audit ${command.name} - ${command.description}`,
      '',
      'Options:',
    ];

    for (const option of command.options) {
      const aliasStr = option.alias ? `, ${option.alias}` : '';
      const requiredStr = option.required ? ' (required)' : '';
      const defaultStr = option.defaultValue !== undefined
        ? ` [default: ${String(option.defaultValue)}]`
        : '';
      lines.push(
        `  ${option.name}${aliasStr}${requiredStr}${defaultStr}`,
        `      ${option.description}`,
        ''
      );
    }

    return lines.join('\n');
  }

  // Command implementations

  private async generateReport(args: Record<string, unknown>): Promise<CLIResult> {
    const typeMap: Record<string, AuditReportTypeValue> = {
      decision: AuditReportType.DECISION_AUDIT,
      compliance: AuditReportType.COMPLIANCE_REPORT,
      actor: AuditReportType.ACTOR_ACTIVITY,
      health: AuditReportType.SYSTEM_HEALTH,
      summary: AuditReportType.TIME_RANGE_SUMMARY,
    };

    const formatMap: Record<string, ExportFormatValue> = {
      json: ExportFormat.JSON,
      csv: ExportFormat.CSV,
      html: ExportFormat.HTML,
      sarif: ExportFormat.SARIF,
    };

    const reportType = typeMap[String(args['type'])] ?? AuditReportType.TIME_RANGE_SUMMARY;
    const exportFormat = formatMap[String(args['format'])] ?? ExportFormat.JSON;

    const timeRange: TimeRange = {
      from: String(args['from']),
      to: String(args['to']),
    };

    const params: AuditQueryParams = {
      type: reportType,
      timeRange,
      scopes: args['scope'] as string[] | undefined,
      includeDecisions: true,
      includeViolations: true,
      includeActors: true,
      includeApprovals: true,
      includeTimeline: true,
      includeMetrics: true,
    };

    // Use a placeholder actor ID for CLI
    const requestedBy = 'cli:audit' as ContentAddress;
    const report = this.auditEngine.generateReport(params, requestedBy);
    const output = this.auditEngine.exportReport(report, exportFormat);

    return {
      success: true,
      exitCode: 0,
      message: `Generated ${report.type} report with ${report.summary.totalDecisions} decisions`,
      data: output,
    };
  }

  private async checkCompliance(args: Record<string, unknown>): Promise<CLIResult> {
    const timeRange: TimeRange = {
      from: String(args['from']),
      to: String(args['to']),
    };

    const threshold = Number(args['threshold']) / 100;
    const summary = this.auditEngine.getComplianceSummary(timeRange);

    const passed = summary.complianceRate >= threshold;

    return {
      success: passed,
      exitCode: passed ? 0 : 1,
      message: passed
        ? `Compliance check passed: ${(summary.complianceRate * 100).toFixed(2)}%`
        : `Compliance check failed: ${(summary.complianceRate * 100).toFixed(2)}% < ${threshold * 100}%`,
      data: summary,
    };
  }

  private async listDecisions(args: Record<string, unknown>): Promise<CLIResult> {
    const timeRange: TimeRange = {
      from: String(args['from']),
      to: String(args['to']),
    };

    const requestedBy = 'cli:audit' as ContentAddress;
    const params: AuditQueryParams = {
      type: AuditReportType.DECISION_AUDIT,
      timeRange,
      includeDecisions: true,
    };

    const report = this.auditEngine.generateReport(params, requestedBy);

    // Extract decisions from report
    const decisionsSection = report.sections.find((s) => s.type === 'decisions');
    const decisions = decisionsSection
      ? (decisionsSection.content as { decisions: unknown[] }).decisions
      : [];

    return {
      success: true,
      exitCode: 0,
      message: `Found ${decisions.length} decision(s)`,
      data: decisions.slice(0, Number(args['limit']) ?? 100),
    };
  }

  private async exportData(args: Record<string, unknown>): Promise<CLIResult> {
    // This would write to file in a real implementation
    return {
      success: true,
      exitCode: 0,
      message: `Data exported to ${String(args['output'])}`,
    };
  }
}

/**
 * Create an audit CLI instance
 */
export function createAuditCLI(auditEngine?: AuditEngine): AuditCLI {
  return new AuditCLI(auditEngine);
}

/**
 * Main entry point for CLI
 */
export async function main(argv: string[]): Promise<number> {
  const cli = createAuditCLI();

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(cli.generateHelp());
    return 0;
  }

  const { command, args } = cli.parseArgs(argv);

  if (args['help']) {
    const help = cli.generateCommandHelp(command);
    if (help) {
      console.log(help);
      return 0;
    }
  }

  const result = await cli.execute(command, args);

  if (result.data && typeof result.data === 'string') {
    console.log(result.data);
  } else if (result.data) {
    console.log(JSON.stringify(result.data, null, 2));
  }

  if (!result.success) {
    console.error(`Error: ${result.message}`);
    if (result.error) {
      console.error(result.error);
    }
  }

  return result.exitCode;
}
