import type { ExportMode, RobustFailurePolicy } from './export-constants';

export interface ExportOptions {
  exportMode?: ExportMode;
  failurePolicy?: RobustFailurePolicy;
}

export interface RobustNormalizeStats {
  ringsRemoved: number;
  inputPolygons: number;
  outputPolygons: number;
}

export interface MeshTopologyReport {
  openEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  valid: boolean;
}

export type RobustExportStage = 'normalize' | 'extrude' | 'validate' | 'remanifold';

export interface RobustExportDiagnostic {
  objectId: string;
  objectName: string;
  colorHex?: string;
  stage: RobustExportStage;
  message: string;
  topology?: MeshTopologyReport;
}

export interface RobustExportReport {
  mode: ExportMode;
  exportedCount: number;
  skipped: RobustExportDiagnostic[];
}

export class RobustExportError extends Error {
  readonly diagnostics: RobustExportDiagnostic[];

  constructor(message: string, diagnostics: RobustExportDiagnostic[] = []) {
    super(message);
    this.name = 'RobustExportError';
    this.diagnostics = diagnostics;
  }
}
