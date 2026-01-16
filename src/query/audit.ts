/**
 * Audit Engine for ContextGraph OS
 *
 * Implements EPIC 7 Capability 7.3:
 * T7.3.1 Generate audit-ready views
 * T7.3.2 Export in standard formats
 *
 * Transparency is not optional. It's the foundation.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { Decision } from '../decision/lifecycle.js';
import type { DecisionVerdict } from '../policy/evaluator.js';
import type { Actor } from '../actor/identity.js';
import type { ApprovalRequest } from '../hitl/approval.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Audit report type
 */
export const AuditReportType = {
  /** Full decision audit */
  DECISION_AUDIT: 'DECISION_AUDIT',
  /** Policy compliance report */
  COMPLIANCE_REPORT: 'COMPLIANCE_REPORT',
  /** Actor activity report */
  ACTOR_ACTIVITY: 'ACTOR_ACTIVITY',
  /** System health report */
  SYSTEM_HEALTH: 'SYSTEM_HEALTH',
  /** Time-range summary */
  TIME_RANGE_SUMMARY: 'TIME_RANGE_SUMMARY',
  /** Custom query report */
  CUSTOM: 'CUSTOM',
} as const;

export type AuditReportTypeValue = (typeof AuditReportType)[keyof typeof AuditReportType];

/**
 * Export format
 */
export const ExportFormat = {
  /** JSON format */
  JSON: 'JSON',
  /** CSV format */
  CSV: 'CSV',
  /** PDF report */
  PDF: 'PDF',
  /** HTML report */
  HTML: 'HTML',
  /** SARIF (Static Analysis Results Interchange Format) */
  SARIF: 'SARIF',
  /** OpenTelemetry format */
  OTEL: 'OTEL',
} as const;

export type ExportFormatValue = (typeof ExportFormat)[keyof typeof ExportFormat];

/**
 * Audit report definition
 */
export interface AuditReport {
  /** Report ID */
  readonly id: ContentAddress;
  /** Report type */
  readonly type: AuditReportTypeValue;
  /** Report title */
  readonly title: string;
  /** Time range covered */
  readonly timeRange: TimeRange;
  /** When the report was generated */
  readonly generatedAt: Timestamp;
  /** Who requested the report */
  readonly requestedBy: ContentAddress;
  /** Report sections */
  readonly sections: readonly AuditSection[];
  /** Summary statistics */
  readonly summary: AuditSummary;
  /** Metadata */
  readonly metadata: AuditMetadata;
}

/**
 * Time range for audit
 */
export interface TimeRange {
  /** Start of range */
  readonly from: Timestamp;
  /** End of range */
  readonly to: Timestamp;
}

/**
 * Section of an audit report
 */
export interface AuditSection {
  /** Section title */
  readonly title: string;
  /** Section type */
  readonly type: 'decisions' | 'violations' | 'actors' | 'approvals' | 'timeline' | 'metrics';
  /** Section content */
  readonly content: AuditSectionContent;
}

/**
 * Content of an audit section
 */
export type AuditSectionContent =
  | DecisionAuditContent
  | ViolationAuditContent
  | ActorAuditContent
  | ApprovalAuditContent
  | TimelineContent
  | MetricsContent;

/**
 * Decision audit content
 */
export interface DecisionAuditContent {
  readonly type: 'decisions';
  readonly decisions: readonly DecisionAuditEntry[];
  readonly totalCount: number;
  readonly byState: Record<string, number>;
  readonly byActionType: Record<string, number>;
}

/**
 * A decision entry in the audit
 */
export interface DecisionAuditEntry {
  readonly id: ContentAddress;
  readonly actionType: string;
  readonly state: string;
  readonly proposedBy: ContentAddress;
  readonly proposedAt: Timestamp;
  readonly concludedAt?: Timestamp;
  readonly verdict?: string;
  readonly violationCount: number;
}

/**
 * Violation audit content
 */
export interface ViolationAuditContent {
  readonly type: 'violations';
  readonly violations: readonly ViolationAuditEntry[];
  readonly totalCount: number;
  readonly byPolicy: Record<ContentAddress, number>;
  readonly bySeverity: Record<string, number>;
}

/**
 * A violation entry in the audit
 */
export interface ViolationAuditEntry {
  readonly decisionId: ContentAddress;
  readonly policyId: ContentAddress;
  readonly message: string;
  readonly severity: string;
  readonly timestamp: Timestamp;
}

/**
 * Actor audit content
 */
export interface ActorAuditContent {
  readonly type: 'actors';
  readonly actors: readonly ActorAuditEntry[];
  readonly totalActions: number;
  readonly byActorType: Record<string, number>;
}

/**
 * An actor entry in the audit
 */
export interface ActorAuditEntry {
  readonly id: ContentAddress;
  readonly name: string;
  readonly actorType: string;
  readonly actionCount: number;
  readonly approvalCount: number;
  readonly violationCount: number;
  readonly lastActiveAt?: Timestamp;
}

/**
 * Approval audit content
 */
export interface ApprovalAuditContent {
  readonly type: 'approvals';
  readonly approvals: readonly ApprovalAuditEntry[];
  readonly totalCount: number;
  readonly byStatus: Record<string, number>;
  readonly avgResponseTimeMs: number;
}

/**
 * An approval entry in the audit
 */
export interface ApprovalAuditEntry {
  readonly id: ContentAddress;
  readonly decisionId: ContentAddress;
  readonly status: string;
  readonly requestedAt: Timestamp;
  readonly resolvedAt?: Timestamp;
  readonly responseTimeMs?: number;
  readonly decidedBy?: ContentAddress;
}

/**
 * Timeline content
 */
export interface TimelineContent {
  readonly type: 'timeline';
  readonly events: readonly TimelineEvent[];
}

/**
 * A timeline event
 */
export interface TimelineEvent {
  readonly timestamp: Timestamp;
  readonly eventType: string;
  readonly description: string;
  readonly actorId?: ContentAddress;
  readonly relatedIds: readonly ContentAddress[];
}

/**
 * Metrics content
 */
export interface MetricsContent {
  readonly type: 'metrics';
  readonly metrics: readonly AuditMetric[];
}

/**
 * An audit metric
 */
export interface AuditMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly trend?: 'up' | 'down' | 'stable';
  readonly comparison?: {
    previousValue: number;
    changePercent: number;
  };
}

/**
 * Audit summary
 */
export interface AuditSummary {
  readonly totalDecisions: number;
  readonly totalViolations: number;
  readonly complianceRate: number;
  readonly avgDecisionTimeMs: number;
  readonly escalationRate: number;
  readonly topViolatedPolicies: readonly { policyId: ContentAddress; count: number }[];
  readonly riskScore: number;
}

/**
 * Audit metadata
 */
export interface AuditMetadata {
  readonly version: string;
  readonly generatedBy: string;
  readonly filters: Record<string, unknown>;
  readonly includedScopes: readonly string[];
}

/**
 * Audit query parameters
 */
export interface AuditQueryParams {
  /** Report type */
  readonly type: AuditReportTypeValue;
  /** Time range */
  readonly timeRange: TimeRange;
  /** Scope filter */
  readonly scopes?: readonly string[];
  /** Actor filter */
  readonly actors?: readonly ContentAddress[];
  /** Include decisions */
  readonly includeDecisions?: boolean;
  /** Include violations */
  readonly includeViolations?: boolean;
  /** Include actors */
  readonly includeActors?: boolean;
  /** Include approvals */
  readonly includeApprovals?: boolean;
  /** Include timeline */
  readonly includeTimeline?: boolean;
  /** Include metrics */
  readonly includeMetrics?: boolean;
}

/**
 * Audit Engine
 *
 * Generates audit reports and exports in various formats.
 */
export class AuditEngine {
  private decisions: Map<ContentAddress, Decision> = new Map();
  private verdicts: Map<ContentAddress, DecisionVerdict> = new Map();
  private actors: Map<ContentAddress, Actor> = new Map();
  private approvals: Map<ContentAddress, ApprovalRequest> = new Map();

  /**
   * Register data for auditing
   */
  registerDecision(decision: Decision, verdict?: DecisionVerdict): void {
    this.decisions.set(decision.id, decision);
    if (verdict) {
      this.verdicts.set(decision.id, verdict);
    }
  }

  registerActor(actor: Actor): void {
    this.actors.set(actor.id, actor);
  }

  registerApproval(approval: ApprovalRequest): void {
    this.approvals.set(approval.id, approval);
  }

  /**
   * Generate an audit report
   */
  generateReport(params: AuditQueryParams, requestedBy: ContentAddress): AuditReport {
    const generatedAt = new Date().toISOString();
    const sections: AuditSection[] = [];

    // Filter data by time range
    const filteredDecisions = this.filterDecisionsByTimeRange(params.timeRange);
    const filteredApprovals = this.filterApprovalsByTimeRange(params.timeRange);

    // Build sections based on params
    if (params.includeDecisions !== false) {
      sections.push(this.buildDecisionsSection(filteredDecisions));
    }

    if (params.includeViolations !== false) {
      sections.push(this.buildViolationsSection(filteredDecisions));
    }

    if (params.includeActors !== false) {
      sections.push(this.buildActorsSection(filteredDecisions));
    }

    if (params.includeApprovals !== false) {
      sections.push(this.buildApprovalsSection(filteredApprovals));
    }

    if (params.includeTimeline) {
      sections.push(this.buildTimelineSection(filteredDecisions, filteredApprovals));
    }

    if (params.includeMetrics) {
      sections.push(this.buildMetricsSection(filteredDecisions, filteredApprovals));
    }

    // Build summary
    const summary = this.buildSummary(filteredDecisions);

    // Build metadata
    const metadata: AuditMetadata = {
      version: '1.0',
      generatedBy: 'ContextGraph OS Audit Engine',
      filters: {
        timeRange: params.timeRange,
        scopes: params.scopes,
        actors: params.actors,
      },
      includedScopes: params.scopes ?? ['*'],
    };

    // Generate report ID
    const reportData = { type: params.type, timeRange: params.timeRange, generatedAt };
    const id = computeContentAddress(reportData);

    return {
      id,
      type: params.type,
      title: this.generateReportTitle(params),
      timeRange: params.timeRange,
      generatedAt,
      requestedBy,
      sections,
      summary,
      metadata,
    };
  }

  /**
   * Export report in specified format
   */
  exportReport(report: AuditReport, format: ExportFormatValue): string {
    switch (format) {
      case ExportFormat.JSON:
        return this.exportToJSON(report);
      case ExportFormat.CSV:
        return this.exportToCSV(report);
      case ExportFormat.HTML:
        return this.exportToHTML(report);
      case ExportFormat.SARIF:
        return this.exportToSARIF(report);
      default:
        return this.exportToJSON(report);
    }
  }

  /**
   * Get compliance summary for a time period
   */
  getComplianceSummary(timeRange: TimeRange): {
    totalDecisions: number;
    compliantDecisions: number;
    complianceRate: number;
    violationsByPolicy: Record<ContentAddress, number>;
  } {
    const decisions = this.filterDecisionsByTimeRange(timeRange);

    let compliantDecisions = 0;
    const violationsByPolicy: Record<ContentAddress, number> = {};

    for (const decision of decisions) {
      const verdict = this.verdicts.get(decision.id);
      if (!verdict || verdict.violations.length === 0) {
        compliantDecisions++;
      } else {
        for (const v of verdict.violations) {
          violationsByPolicy[v.policyId] = (violationsByPolicy[v.policyId] ?? 0) + 1;
        }
      }
    }

    return {
      totalDecisions: decisions.length,
      compliantDecisions,
      complianceRate: decisions.length > 0 ? compliantDecisions / decisions.length : 1,
      violationsByPolicy,
    };
  }

  // Private helper methods

  private filterDecisionsByTimeRange(timeRange: TimeRange): Decision[] {
    return Array.from(this.decisions.values()).filter((d) => {
      const timestamp = d.proposedAt;
      return timestamp >= timeRange.from && timestamp <= timeRange.to;
    });
  }

  private filterApprovalsByTimeRange(timeRange: TimeRange): ApprovalRequest[] {
    return Array.from(this.approvals.values()).filter((a) => {
      return a.createdAt >= timeRange.from && a.createdAt <= timeRange.to;
    });
  }

  private buildDecisionsSection(decisions: Decision[]): AuditSection {
    const byState: Record<string, number> = {};
    const byActionType: Record<string, number> = {};
    const entries: DecisionAuditEntry[] = [];

    for (const decision of decisions) {
      byState[decision.state] = (byState[decision.state] ?? 0) + 1;
      byActionType[decision.action.type] = (byActionType[decision.action.type] ?? 0) + 1;

      const verdict = this.verdicts.get(decision.id);

      entries.push({
        id: decision.id,
        actionType: decision.action.type,
        state: decision.state,
        proposedBy: decision.proposedBy,
        proposedAt: decision.proposedAt,
        concludedAt: decision.concludedAt,
        verdict: verdict?.result,
        violationCount: verdict?.violations.length ?? 0,
      });
    }

    const content: DecisionAuditContent = {
      type: 'decisions',
      decisions: entries,
      totalCount: decisions.length,
      byState,
      byActionType,
    };

    return {
      title: 'Decision Audit',
      type: 'decisions',
      content,
    };
  }

  private buildViolationsSection(decisions: Decision[]): AuditSection {
    const byPolicy: Record<ContentAddress, number> = {};
    const bySeverity: Record<string, number> = {};
    const entries: ViolationAuditEntry[] = [];

    for (const decision of decisions) {
      const verdict = this.verdicts.get(decision.id);
      if (!verdict) continue;

      for (const v of verdict.violations) {
        byPolicy[v.policyId] = (byPolicy[v.policyId] ?? 0) + 1;
        bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;

        entries.push({
          decisionId: decision.id,
          policyId: v.policyId,
          message: v.message,
          severity: v.severity,
          timestamp: verdict.evaluatedAt,
        });
      }
    }

    const content: ViolationAuditContent = {
      type: 'violations',
      violations: entries,
      totalCount: entries.length,
      byPolicy,
      bySeverity,
    };

    return {
      title: 'Policy Violations',
      type: 'violations',
      content,
    };
  }

  private buildActorsSection(decisions: Decision[]): AuditSection {
    const actorStats: Map<ContentAddress, {
      actionCount: number;
      approvalCount: number;
      violationCount: number;
    }> = new Map();

    const byActorType: Record<string, number> = {};

    for (const decision of decisions) {
      const stats = actorStats.get(decision.proposedBy) ?? {
        actionCount: 0,
        approvalCount: 0,
        violationCount: 0,
      };
      stats.actionCount++;

      const verdict = this.verdicts.get(decision.id);
      if (verdict) {
        stats.violationCount += verdict.violations.length;
      }

      actorStats.set(decision.proposedBy, stats);
    }

    const entries: ActorAuditEntry[] = [];
    let totalActions = 0;

    for (const [actorId, stats] of actorStats) {
      const actor = this.actors.get(actorId);
      totalActions += stats.actionCount;

      if (actor) {
        byActorType[actor.type] = (byActorType[actor.type] ?? 0) + 1;
      }

      entries.push({
        id: actorId,
        name: actor?.name ?? 'Unknown',
        actorType: actor?.type ?? 'UNKNOWN',
        actionCount: stats.actionCount,
        approvalCount: stats.approvalCount,
        violationCount: stats.violationCount,
        lastActiveAt: actor?.lastActiveAt,
      });
    }

    const content: ActorAuditContent = {
      type: 'actors',
      actors: entries,
      totalActions,
      byActorType,
    };

    return {
      title: 'Actor Activity',
      type: 'actors',
      content,
    };
  }

  private buildApprovalsSection(approvals: ApprovalRequest[]): AuditSection {
    const byStatus: Record<string, number> = {};
    const entries: ApprovalAuditEntry[] = [];
    let totalResponseTime = 0;
    let respondedCount = 0;

    for (const approval of approvals) {
      byStatus[approval.status] = (byStatus[approval.status] ?? 0) + 1;

      let responseTimeMs: number | undefined;
      if (approval.outcome) {
        const created = new Date(approval.createdAt).getTime();
        const decided = new Date(approval.outcome.decidedAt).getTime();
        responseTimeMs = decided - created;
        totalResponseTime += responseTimeMs;
        respondedCount++;
      }

      entries.push({
        id: approval.id,
        decisionId: approval.decisionId,
        status: approval.status,
        requestedAt: approval.createdAt,
        resolvedAt: approval.outcome?.decidedAt,
        responseTimeMs,
        decidedBy: approval.outcome?.decidedBy,
      });
    }

    const content: ApprovalAuditContent = {
      type: 'approvals',
      approvals: entries,
      totalCount: approvals.length,
      byStatus,
      avgResponseTimeMs: respondedCount > 0 ? totalResponseTime / respondedCount : 0,
    };

    return {
      title: 'Approval Workflow',
      type: 'approvals',
      content,
    };
  }

  private buildTimelineSection(
    decisions: Decision[],
    approvals: ApprovalRequest[]
  ): AuditSection {
    const events: TimelineEvent[] = [];

    for (const decision of decisions) {
      events.push({
        timestamp: decision.proposedAt,
        eventType: 'decision_proposed',
        description: `Decision proposed: ${decision.action.type}`,
        actorId: decision.proposedBy,
        relatedIds: [decision.id],
      });

      if (decision.concludedAt) {
        events.push({
          timestamp: decision.concludedAt,
          eventType: `decision_${decision.state.toLowerCase()}`,
          description: `Decision ${decision.state.toLowerCase()}: ${decision.action.type}`,
          actorId: decision.proposedBy,
          relatedIds: [decision.id],
        });
      }
    }

    for (const approval of approvals) {
      events.push({
        timestamp: approval.createdAt,
        eventType: 'approval_requested',
        description: `Approval requested: ${approval.reason}`,
        relatedIds: [approval.id, approval.decisionId],
      });

      if (approval.outcome) {
        events.push({
          timestamp: approval.outcome.decidedAt,
          eventType: `approval_${approval.outcome.decision}`,
          description: `Approval ${approval.outcome.decision}`,
          actorId: approval.outcome.decidedBy,
          relatedIds: [approval.id, approval.decisionId],
        });
      }
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const content: TimelineContent = {
      type: 'timeline',
      events,
    };

    return {
      title: 'Event Timeline',
      type: 'timeline',
      content,
    };
  }

  private buildMetricsSection(
    decisions: Decision[],
    approvals: ApprovalRequest[]
  ): AuditSection {
    const metrics: AuditMetric[] = [];

    // Decision metrics
    metrics.push({
      name: 'Total Decisions',
      value: decisions.length,
      unit: 'count',
    });

    const committedCount = decisions.filter((d) => d.state === 'COMMITTED').length;
    metrics.push({
      name: 'Committed Decisions',
      value: committedCount,
      unit: 'count',
    });

    metrics.push({
      name: 'Commit Rate',
      value: decisions.length > 0 ? (committedCount / decisions.length) * 100 : 0,
      unit: 'percent',
    });

    // Violation metrics
    let totalViolations = 0;
    for (const decision of decisions) {
      const verdict = this.verdicts.get(decision.id);
      if (verdict) {
        totalViolations += verdict.violations.length;
      }
    }

    metrics.push({
      name: 'Total Violations',
      value: totalViolations,
      unit: 'count',
    });

    // Approval metrics
    metrics.push({
      name: 'Total Approvals',
      value: approvals.length,
      unit: 'count',
    });

    const approvedCount = approvals.filter((a) => a.status === 'APPROVED').length;
    metrics.push({
      name: 'Approval Rate',
      value: approvals.length > 0 ? (approvedCount / approvals.length) * 100 : 0,
      unit: 'percent',
    });

    const content: MetricsContent = {
      type: 'metrics',
      metrics,
    };

    return {
      title: 'Key Metrics',
      type: 'metrics',
      content,
    };
  }

  private buildSummary(decisions: Decision[]): AuditSummary {
    let totalViolations = 0;
    let compliantCount = 0;
    let escalatedCount = 0;
    const violationsByPolicy: Map<ContentAddress, number> = new Map();

    for (const decision of decisions) {
      const verdict = this.verdicts.get(decision.id);
      if (!verdict || verdict.violations.length === 0) {
        compliantCount++;
      } else {
        totalViolations += verdict.violations.length;
        for (const v of verdict.violations) {
          violationsByPolicy.set(v.policyId, (violationsByPolicy.get(v.policyId) ?? 0) + 1);
        }
      }

      if (verdict?.result === 'ESCALATE') {
        escalatedCount++;
      }
    }

    // Get top violated policies
    const topViolatedPolicies = Array.from(violationsByPolicy.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([policyId, count]) => ({ policyId, count }));

    // Calculate risk score (0-100)
    const complianceRate = decisions.length > 0 ? compliantCount / decisions.length : 1;
    const riskScore = Math.round((1 - complianceRate) * 100);

    return {
      totalDecisions: decisions.length,
      totalViolations,
      complianceRate,
      avgDecisionTimeMs: 0, // Would need timestamp analysis
      escalationRate: decisions.length > 0 ? escalatedCount / decisions.length : 0,
      topViolatedPolicies,
      riskScore,
    };
  }

  private generateReportTitle(params: AuditQueryParams): string {
    const typeLabels: Record<AuditReportTypeValue, string> = {
      DECISION_AUDIT: 'Decision Audit Report',
      COMPLIANCE_REPORT: 'Compliance Report',
      ACTOR_ACTIVITY: 'Actor Activity Report',
      SYSTEM_HEALTH: 'System Health Report',
      TIME_RANGE_SUMMARY: 'Summary Report',
      CUSTOM: 'Custom Audit Report',
    };

    const fromDate = params.timeRange.from.split('T')[0];
    const toDate = params.timeRange.to.split('T')[0];

    return `${typeLabels[params.type]} (${fromDate} to ${toDate})`;
  }

  private exportToJSON(report: AuditReport): string {
    return JSON.stringify(report, null, 2);
  }

  private exportToCSV(report: AuditReport): string {
    const lines: string[] = [];

    // Header
    lines.push(`"Report","${report.title}"`);
    lines.push(`"Generated","${report.generatedAt}"`);
    lines.push(`"Time Range","${report.timeRange.from} to ${report.timeRange.to}"`);
    lines.push('');

    // Summary
    lines.push('"Summary"');
    lines.push(`"Total Decisions","${report.summary.totalDecisions}"`);
    lines.push(`"Total Violations","${report.summary.totalViolations}"`);
    lines.push(`"Compliance Rate","${(report.summary.complianceRate * 100).toFixed(2)}%"`);
    lines.push(`"Risk Score","${report.summary.riskScore}"`);
    lines.push('');

    // Decisions section
    for (const section of report.sections) {
      if (section.type === 'decisions') {
        const content = section.content as DecisionAuditContent;
        lines.push('"Decisions"');
        lines.push('"ID","Action Type","State","Proposed By","Proposed At","Violations"');
        for (const d of content.decisions) {
          lines.push(
            `"${d.id}","${d.actionType}","${d.state}","${d.proposedBy}","${d.proposedAt}","${d.violationCount}"`
          );
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private exportToHTML(report: AuditReport): string {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${report.title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 1px solid #ccc; padding-bottom: 10px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f4f4f4; }
    .summary { background: #f9f9f9; padding: 20px; border-radius: 8px; }
    .metric { display: inline-block; margin: 10px 20px; }
    .metric-value { font-size: 24px; font-weight: bold; color: #333; }
    .metric-label { font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <h1>${report.title}</h1>
  <p>Generated: ${report.generatedAt}</p>
  <p>Time Range: ${report.timeRange.from} to ${report.timeRange.to}</p>

  <div class="summary">
    <h2>Summary</h2>
    <div class="metric">
      <div class="metric-value">${report.summary.totalDecisions}</div>
      <div class="metric-label">Total Decisions</div>
    </div>
    <div class="metric">
      <div class="metric-value">${report.summary.totalViolations}</div>
      <div class="metric-label">Total Violations</div>
    </div>
    <div class="metric">
      <div class="metric-value">${(report.summary.complianceRate * 100).toFixed(1)}%</div>
      <div class="metric-label">Compliance Rate</div>
    </div>
    <div class="metric">
      <div class="metric-value">${report.summary.riskScore}</div>
      <div class="metric-label">Risk Score</div>
    </div>
  </div>

  ${report.sections.map((section) => this.renderHTMLSection(section)).join('\n')}
</body>
</html>`;
    return html;
  }

  private renderHTMLSection(section: AuditSection): string {
    let content = `<h2>${section.title}</h2>`;

    if (section.type === 'decisions') {
      const data = section.content as DecisionAuditContent;
      content += `<table>
        <tr><th>ID</th><th>Action</th><th>State</th><th>Proposed At</th><th>Violations</th></tr>
        ${data.decisions.slice(0, 20).map((d) => `
          <tr>
            <td>${d.id.substring(0, 12)}...</td>
            <td>${d.actionType}</td>
            <td>${d.state}</td>
            <td>${d.proposedAt}</td>
            <td>${d.violationCount}</td>
          </tr>
        `).join('')}
      </table>`;
    }

    return content;
  }

  private exportToSARIF(report: AuditReport): string {
    // SARIF format for static analysis tools
    const sarif = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [{
        tool: {
          driver: {
            name: 'ContextGraph OS',
            version: '0.1.0',
            informationUri: 'https://github.com/contextgraph-os',
          },
        },
        results: this.buildSARIFResults(report),
      }],
    };

    return JSON.stringify(sarif, null, 2);
  }

  private buildSARIFResults(report: AuditReport): object[] {
    const results: object[] = [];

    for (const section of report.sections) {
      if (section.type === 'violations') {
        const content = section.content as ViolationAuditContent;
        for (const v of content.violations) {
          results.push({
            ruleId: v.policyId,
            level: v.severity === 'critical' ? 'error' : v.severity === 'warning' ? 'warning' : 'note',
            message: { text: v.message },
            locations: [{
              physicalLocation: {
                artifactLocation: { uri: `decision/${v.decisionId}` },
              },
            }],
          });
        }
      }
    }

    return results;
  }
}

/**
 * Create an audit engine
 */
export function createAuditEngine(): AuditEngine {
  return new AuditEngine();
}
